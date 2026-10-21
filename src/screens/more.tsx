import { useEffect, useState } from 'preact/hooks';
import { api, getKey, getWho, setWho } from '../lib/api';
import { short, today } from '../lib/dates';
import { fillWeek } from '../lib/planner';
import { useStore } from '../lib/store';
import type { KrogerStatus, Slot, SlotConfig } from '../lib/types';
import { Icon } from '../icons';
import { CookBadge, Seg } from '../ui';

export function MoreScreen({ query }: { query: URLSearchParams }) {
  const store = useStore();
  const [who, setWhoState] = useState(getWho() ?? 'Dean');
  const link = `${location.origin}/#/join/${getKey()}`;

  useEffect(() => {
    const msg = query.get('kroger');
    if (msg) {
      store.toast(msg === 'connected' ? 'Kroger connected' : msg);
      history.replaceState(null, '', location.pathname + '#/more');
    }
  }, []);

  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: 'Our meal planner', url: link });
      else {
        await navigator.clipboard.writeText(link);
        store.toast('Link copied');
      }
    } catch {
      /* share sheet closed */
    }
  };

  return (
    <>
      <header class="top"><h1 class="top-title">More</h1></header>

      <section class="card">
        <h2>This device</h2>
        <Seg label="Who's using this device" value={who} options={store.state!.settings.cooks} onChange={(w) => { setWho(w); setWhoState(w); }} />
      </section>

      <section class="card">
        <h2>Household link</h2>
        <p class="small">Anyone with this link can see and change your plan, so only share it with each other. Open it once on each phone or computer.</p>
        <button class="btn primary" onClick={share}><Icon name="link" size={18} /> Share or copy link</button>
        <p class="small muted">On iPhone, open the link in Safari, then Share ▸ Add to Home Screen to use it like an app.</p>
      </section>

      <KrogerSection />
      <HistorySection />
      <SettingsSection />

      <section class="card small">
        <h2>Optional features</h2>
        <p>Claude ideas and reel recipes: <b>{store.state!.features.ai ? 'on' : 'off'}</b>. Kroger cart: <b>{store.state!.features.kroger ? 'on' : 'off'}</b>.</p>
        <p class="muted">Setup steps are in the README on GitHub.</p>
      </section>
    </>
  );
}

function KrogerSection() {
  const store = useStore();
  const [status, setStatus] = useState<KrogerStatus | null>(null);
  const [zip, setZip] = useState('');
  const [stores, setStores] = useState<{ id: string; name: string }[] | null>(null);
  const load = () => api.kroger.status().then(setStatus).catch(() => {});
  useEffect(() => {
    if (store.state!.features.kroger) load();
  }, []);
  if (!store.state!.features.kroger) return null;

  const connect = async () => {
    try {
      location.href = (await api.kroger.start()).url;
    } catch (e) {
      store.toast(e instanceof Error ? e.message : 'Could not start Kroger sign-in');
    }
  };
  const find = async () => {
    try {
      setStores(await api.kroger.locations(zip));
    } catch (e) {
      store.toast(e instanceof Error ? e.message : 'Store search failed');
    }
  };

  return (
    <section class="card">
      <h2>Kroger</h2>
      {!status ? <p class="muted">Checking…</p> : (
        <>
          <p class="small">
            Account: <b>{status.connected ? 'connected' : 'not connected'}</b>
            {status.location_name && <><br />Store: {status.location_name}</>}
          </p>
          <div class="row gap wrap">
            {status.connected ? (
              <button class="btn" onClick={() => api.kroger.disconnect().then(load)}>Disconnect</button>
            ) : (
              <button class="btn primary" onClick={connect}>Connect Kroger account</button>
            )}
          </div>
          <form class="row gap" onSubmit={(e) => { e.preventDefault(); find(); }}>
            <input inputMode="numeric" maxLength={5} placeholder="ZIP for your store" value={zip} onInput={(e) => setZip(e.currentTarget.value)} />
            <button class="btn">Find stores</button>
          </form>
          {stores && (
            <ul class="list">
              {stores.map((st) => (
                <li key={st.id}>
                  <button class="list-item" onClick={async () => { await api.kroger.setLocation(st.id, st.name); setStores(null); load(); }}>{st.name}</button>
                </li>
              ))}
            </ul>
          )}
          <p class="small muted">Picking your store shows its prices when you match products.</p>
        </>
      )}
    </section>
  );
}

function HistorySection() {
  const store = useStore();
  const s = store.state!;
  const [mealId, setMealId] = useState('');
  const [date, setDate] = useState(today());
  const [all, setAll] = useState(false);
  const rows = all ? s.history : s.history.slice(0, 10);
  return (
    <section class="card">
      <h2>Meal history</h2>
      <form class="hist-add" onSubmit={(e) => {
        e.preventDefault();
        if (mealId) store.run(() => api.addHistory(date, mealId)).then(() => setMealId(''));
      }}>
        <select value={mealId} onChange={(e) => setMealId(e.currentTarget.value)} aria-label="Meal">
          <option value="">Log a meal…</option>
          {s.meals.filter((m) => !m.archived).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <input type="date" value={date} onInput={(e) => setDate(e.currentTarget.value)} aria-label="Date" />
        <button class="btn" disabled={!mealId}>Add</button>
      </form>
      <ul class="glist">
        {rows.map((h) => (
          <li key={h.id}>
            <span class="gline">
              <span><b>{h.meal_name}</b></span>
              <span class="small muted">{short(h.date)}{h.cook ? <> · <CookBadge cook={h.cook} /></> : ''}{h.added_by ? ` · logged by ${h.added_by}` : ''}</span>
            </span>
            <button class="icon" aria-label={`Delete ${h.meal_name} on ${h.date}`} onClick={() => store.run(() => api.deleteHistory(h.id))}><Icon name="trash" size={18} /></button>
          </li>
        ))}
        {!s.history.length && <li class="muted small">Nothing yet. Tick "Mark eaten" on the Week tab.</li>}
      </ul>
      {s.history.length > 10 && <button class="link" onClick={() => setAll(!all)}>{all ? 'Show less' : `Show all ${s.history.length}`}</button>}
    </section>
  );
}

function SettingsSection() {
  const store = useStore();
  const s = store.state!;
  const [repeat, setRepeat] = useState(String(s.settings.repeat_days));
  const [slots, setSlots] = useState<SlotConfig[]>(s.settings.slots);
  const [proteins, setProteins] = useState(s.settings.proteins.join(', '));
  const [stores, setStores] = useState(s.settings.stores.join(', '));
  const list = (v: string) => v.split(',').map((x) => x.trim()).filter(Boolean);

  const save = async () => {
    const ok = await store.run(async () => {
      await api.setting('repeat_days', Math.max(0, Number(repeat) || 0));
      await api.setting('slots', slots.filter((x) => x.label.trim()));
      await api.setting('proteins', list(proteins));
      await api.setting('stores', list(stores));
    });
    if (ok) store.toast('Settings saved');
  };

  // Make this week's slots match the settings: keep meals in slots that still exist, add new ones with suggestions.
  const applyToWeek = async () => {
    const cfg = slots.filter((x) => x.label.trim());
    const cur = s.slots;
    const next: Slot[] = cfg.map((c, i) => {
      const old = cur.find((x) => x.slot === i);
      return old ? { ...old, ...c } : { ...c, week_of: s.week_of, slot: i, meal_id: null, locked: 0, cook: null, skipped: [], eaten_date: null };
    });
    const extra = cur.filter((x) => x.slot >= cfg.length);
    await store.run(async () => {
      await api.saveSlots(s.week_of, fillWeek(s, s.week_of, next));
      for (const x of extra) await api.deleteSlot(s.week_of, x.slot);
    });
    store.toast('This week updated');
  };

  return (
    <section class="card">
      <h2>Settings</h2>
      <label class="field">
        <span>Days before a meal can repeat</span>
        <input inputMode="numeric" value={repeat} onInput={(e) => setRepeat(e.currentTarget.value)} />
      </label>
      <fieldset class="field">
        <legend>Meals each week</legend>
        {slots.map((x, i) => (
          <div class="row gap" key={i}>
            <input value={x.label} aria-label="Slot name" onInput={(e) => setSlots(slots.map((y, n) => (n === i ? { ...y, label: e.currentTarget.value } : y)))} />
            <select value={x.category} aria-label="Category" onChange={(e) => setSlots(slots.map((y, n) => (n === i ? { ...y, category: e.currentTarget.value } : y)))}>
              {s.settings.categories.map((c) => <option key={c}>{c}</option>)}
            </select>
            <button type="button" class="icon" aria-label="Remove slot" onClick={() => setSlots(slots.filter((_, n) => n !== i))}><Icon name="trash" size={18} /></button>
          </div>
        ))}
        <button type="button" class="btn" onClick={() => setSlots([...slots, { label: `Dinner ${slots.filter((x) => x.category === 'Dinner').length + 1}`, category: 'Dinner' }])}>
          <Icon name="plus" size={18} /> Slot
        </button>
        <p class="small muted">New weeks use these. <button type="button" class="link" onClick={applyToWeek}>Apply to this week too</button></p>
      </fieldset>
      <label class="field"><span>Proteins (comma separated)</span><input value={proteins} onInput={(e) => setProteins(e.currentTarget.value)} /></label>
      <label class="field"><span>Stores (comma separated)</span><input value={stores} onInput={(e) => setStores(e.currentTarget.value)} /></label>
      <button class="btn primary wide" onClick={save}>Save settings</button>
    </section>
  );
}
