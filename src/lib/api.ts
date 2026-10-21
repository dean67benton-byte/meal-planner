import type {
  AppState, KrogerDeal, KrogerPrice, KrogerProduct, KrogerStatus, Meal, MealDraft, PantryItem, Slot, SnackPick,
} from './types';

const KEY = 'household-key';
const WHO = 'who-am-i';

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string | null) => {
  try {
    v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v);
  } catch {
    /* private mode: the key lives only for this visit */
  }
};

let memoryKey: string | null = read(KEY);
export const getKey = () => memoryKey;
export const setKey = (k: string | null) => {
  memoryKey = k;
  write(KEY, k);
};
export const getWho = () => read(WHO);
export const setWho = (w: string) => write(WHO, w);

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function call<T>(method: string, path: string, data?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { 'x-household-key': memoryKey ?? '', ...(data !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: data !== undefined ? JSON.stringify(data) : undefined,
  });
  const out = await res.json().catch(() => ({ error: `Request failed (${res.status})` }));
  if (!res.ok) throw new ApiError(res.status, (out as { error?: string }).error ?? `Request failed (${res.status})`);
  return out as T;
}

export const api = {
  state: (week: string) => call<AppState>('GET', `/state?week=${week}`),
  saveMeal: (m: Partial<Meal> | MealDraft) => call<{ id: string }>('POST', '/meals', m),
  savePantry: (p: Partial<PantryItem>) => call('PUT', '/pantry', p),
  deletePantry: (key: string) => call('DELETE', `/pantry/${encodeURIComponent(key)}`),
  initWeek: (week: string, slots: Partial<Slot>[]) => call('POST', `/weeks/${week}/init`, slots),
  saveSlots: (week: string, slots: Slot[]) => call('PUT', `/weeks/${week}/slots`, slots),
  saveSnacks: (week: string, snacks: SnackPick[]) => call('PUT', `/weeks/${week}/snacks`, snacks),
  sidePair: (meal_id: string, side_id: string, change: { kept?: number; skipped?: number }) =>
    call('POST', '/side-pairs', { meal_id, side_id, ...change }),
  deleteSlot: (week: string, slot: number) => call('DELETE', `/weeks/${week}/slots/${slot}`),
  eaten: (week: string, slot: number, date: string | null) =>
    call('POST', `/weeks/${week}/slots/${slot}/eaten`, { date, by: getWho() }),
  addHistory: (date: string, meal_id: string) => call('POST', '/history', { date, meal_id, by: getWho() }),
  deleteHistory: (id: number) => call('DELETE', `/history/${id}`),
  check: (week_of: string, key: string, bought: boolean) => call('PUT', '/checks', { week_of, key, bought }),
  setting: (key: string, value: unknown) => call('PUT', '/settings', { key, value }),
  aiIdeas: (request: string, opts: { useOnHand?: boolean; useDeals?: boolean } = {}) =>
    call<{ meals: MealDraft[] }>('POST', '/ai/ideas', { request, count: 5, ...opts }),
  aiReel: (url: string, caption: string) => call<{ meal: MealDraft }>('POST', '/ai/reel', { url, caption }),
  kroger: {
    status: () => call<KrogerStatus>('GET', '/kroger/status'),
    start: () => call<{ url: string }>('POST', '/kroger/start'),
    disconnect: () => call('POST', '/kroger/disconnect'),
    locations: (zip: string) => call<{ id: string; name: string }[]>('GET', `/kroger/locations?zip=${zip}`),
    setLocation: (id: string, name: string) => call('PUT', '/kroger/location', { id, name }),
    deals: () => call<KrogerDeal[]>('GET', '/kroger/deals'),
    prices: (upcs: string[]) => call<KrogerPrice[]>('GET', `/kroger/prices?upcs=${upcs.join(',')}`),
    products: (term: string) => call<KrogerProduct[]>('GET', `/kroger/products?term=${encodeURIComponent(term)}`),
    cart: (items: { upc: string; quantity: number }[]) => call<{ added: number }>('POST', '/kroger/cart', { items }),
  },
};
