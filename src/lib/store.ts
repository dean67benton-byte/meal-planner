import { createContext } from 'preact';
import { useCallback, useContext, useEffect, useRef, useState } from 'preact/hooks';
import { api, ApiError, getKey } from './api';
import { defaultWeek } from './dates';
import { fillWeek } from './planner';
import type { AppState, Slot } from './types';

export interface Store {
  state: AppState | null;
  error: string | null;
  needsKey: boolean;
  week: string;
  setWeek: (w: string) => void;
  refresh: () => Promise<void>;
  /** Run a change against the API, then reload so both phones agree. */
  run: (fn: () => Promise<unknown>, optimistic?: (s: AppState) => AppState) => Promise<boolean>;
  saveSlots: (slots: Slot[]) => Promise<boolean>;
  toast: (msg: string) => void;
  toastMsg: string | null;
}

export const StoreContext = createContext<Store>(null as unknown as Store);
export const useStore = () => useContext(StoreContext);

export function useStoreState(): Store {
  const [week, setWeek] = useState(defaultWeek());
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsKey, setNeedsKey] = useState(false);
  const [toastMsg, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number>();
  const weekRef = useRef(week);
  weekRef.current = week;

  const toast = useCallback((msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3500);
  }, []);

  const refresh = useCallback(async () => {
    const w = weekRef.current;
    if (!getKey()) return setNeedsKey(true);
    try {
      let s = await api.state(w);
      // First visit to a week: create its slots with fresh suggestions.
      if (!s.slots.length && s.settings.slots.length) {
        const blank: Slot[] = s.settings.slots.map((c, i) => ({
          ...c, week_of: w, slot: i, meal_id: null, locked: 0, cook: null, skipped: [], eaten_date: null,
        }));
        await api.initWeek(w, fillWeek(s, w, blank));
        s = await api.state(w);
      } else if (s.slots.some((x) => !x.meal_id && !x.locked && !x.eaten_date)) {
        // Empty slots get a suggestion as soon as there's a meal that fits.
        const filled = fillWeek(s, w, s.slots);
        if (filled.some((x, i) => x.meal_id !== s.slots[i].meal_id)) {
          await api.saveSlots(w, filled);
          s = await api.state(w);
        }
      }
      if (weekRef.current !== w) return;
      setState(s);
      setError(null);
      setNeedsKey(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setNeedsKey(true);
      else setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    setState((s) => (s && s.week_of !== week ? null : s));
    refresh();
  }, [week, refresh]);

  // Pick up the other phone's changes when this one comes back to the app, and every minute while open.
  useEffect(() => {
    const onVis = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVis);
    const t = setInterval(onVis, 60_000);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      clearInterval(t);
    };
  }, [refresh]);

  const run = useCallback(
    async (fn: () => Promise<unknown>, optimistic?: (s: AppState) => AppState) => {
      if (optimistic) setState((s) => (s ? optimistic(s) : s));
      try {
        await fn();
        await refresh();
        return true;
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Something went wrong');
        await refresh();
        return false;
      }
    },
    [refresh, toast],
  );

  const saveSlots = useCallback(
    (slots: Slot[]) => run(() => api.saveSlots(weekRef.current, slots), (s) => ({ ...s, slots })),
    [run],
  );

  return { state, error, needsKey, week, setWeek, refresh, run, saveSlots, toast, toastMsg };
}
