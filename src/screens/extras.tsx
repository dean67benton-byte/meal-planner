// Sides on each dinner, and the week's snack list, both shown on the Week screen.
import { useEffect, useState } from 'preact/hooks';
import { api } from '../lib/api';
import { money } from '../lib/grocery';
import {
  activeSides, addSide, addSnack, rerollSide, rerollSnack, salePrice, snackItems, snackPrice, totalMinutes,
} from '../lib/planner';
import { useStore } from '../lib/store';
import { itemKey, type AppState, type KrogerPrice, type Meal, type PantryItem, type SidePick, type Slot, type SnackPick } from '../lib/types';
import { Icon } from '../icons';
import { Sheet } from '../ui';

const learn = (meal: string | null, side: string, change: { kept?: number; skipped?: number }) => {
  if (meal) api.sidePair(meal, side, change).catch(() => {});
};

export function SidesBlock({ slot }: { slot: Slot }) {
  const store = useStore();
  const s = store.state!;
  const [picking, setPicking] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const byId = new Map(s.meals.map((m) => [m.id, m]));
  const hasSides = activeSides(s.meals).length > 0;
  const setSides = (sides: SidePick[]) => store.saveSlots(s.slots.map((x) => (x.slot === slot.slot ? { ...x, sides } : x)));

  const apply = (r: { slots: Slot[]; note: string | null }) => {
    if (r.slots === s.slots) return store.toast(r.note ?? 'No side to add');
    const before = new Set(slot.sides.map((x) => x.id));
    const added = r.slots.find((x) => x.slot === slot.slot)!.sides.find((x) => !before.has(x.id));
    if (added) setNotes((n) => ({ ...n, [added.id]: r.note ?? '' }));
    store.saveSlots(r.slots);
  };
  const toggleLock = (i: number) => {
    const x = slot.sides[i];
    learn(slot.meal_id, x.id, { kept: x.locked ? -1 : 1 });
    setSides(slot.sides.map((y, n) => (n === i ? { ...y, locked: y.locked ? 0 : 1 } : y)));
  };
  const reroll = (i: number) => {
    learn(slot.meal_id, slot.sides[i].id, { skipped: 1 });
    apply(rerollSide(s, s.slots, slot.slot, i));
  };

  return (
    <div class="sides">
      {slot.sides.map((x, i) => {
        const side = byId.get(x.id);
        const note = notes[x.id];
        return (
          <div key={x.id} class={`side ${x.locked ? 'locked' : ''}`}>
            <a class="side-name" href={`#/meals/${x.id}`}>
              <b>{side?.name ?? 'Deleted side'}</b>
              {note && !x.locked && <span class="small muted">{note}</span>}
            </a>
            <button class={`btn tiny ${x.locked ? '' : 'primary'}`} onClick={() => toggleLock(i)}>{x.locked ? 'Unlock' : 'Lock'}</button>
            {!x.locked && (
              <>
                <button class="icon" aria-label={`Reroll ${side?.name ?? 'side'}`} onClick={() => reroll(i)}><Icon name="reroll" size={18} /></button>
                <button class="icon" aria-label={`Remove ${side?.name ?? 'side'}`} onClick={() => setSides(slot.sides.filter((_, n) => n !== i))}><Icon name="x" size={18} /></button>
              </>
            )}
          </div>
        );
      })}
      {!slot.eaten_date && (
        <div class="row gap-sm">
          <button class="btn tiny" disabled={!hasSides} onClick={() => apply(addSide(s, s.slots, slot.slot))}><Icon name="plus" size={16} /> Add side</button>
          <button class="btn tiny" disabled={!hasSides} onClick={() => setPicking(true)}><Icon name="search" size={16} /> Pick side</button>
          {!hasSides && <a class="small" href="#/ideas">Get some sides</a>}
        </div>
      )}
      {picking && (
        <SidePickSheet
          slot={slot}
          onClose={() => setPicking(false)}
          onPick={(m) => {
            setPicking(false);
            learn(slot.meal_id, m.id, { kept: 1 });
            setSides([...slot.sides, { id: m.id, locked: 1, skipped: [] }]);
          }}
        />
      )}
    </div>
  );
}

function SidePickSheet({ slot, onClose, onPick }: { slot: Slot; onClose: () => void; onPick: (m: Meal) => void }) {
  const s = useStore().state!;
  const [q, setQ] = useState('');
  const meal = s.meals.find((m) => m.id === slot.meal_id);
  const kept = new Map(s.side_pairs.filter((p) => p.meal_id === slot.meal_id).map((p) => [p.side_id, p.kept]));
  const on = new Set(slot.sides.map((x) => x.id));
  const list = activeSides(s.meals)
    .filter((m) => m.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (kept.get(b.id) ?? 0) - (kept.get(a.id) ?? 0) || a.name.localeCompare(b.name));
  return (
    <Sheet title={`Side for ${meal?.name ?? slot.label}`} onClose={onClose}>
      <input class="search" type="search" placeholder="Search sides" value={q} onInput={(e) => setQ(e.currentTarget.value)} />
      <ul class="list">
        {list.map((m) => (
          <li key={m.id}>
            <button class="list-item" disabled={on.has(m.id)} onClick={() => onPick(m)}>
              <span class="meal-name">{m.name}</span>
              <span class="meta">
                {[
                  totalMinutes(m) ? `${totalMinutes(m)} min` : '',
                  m.ingredients.length ? `${m.ingredients.length} ingredients` : '',
                  kept.get(m.id) ? `had with this ${kept.get(m.id)}×` : '',
                  on.has(m.id) ? 'already on this dinner' : '',
                ].filter(Boolean).join(' · ')}
              </span>
            </button>
          </li>
        ))}
        {!list.length && <li class="muted">No sides match. <a href="#/meals/new">Add one</a> with category "Side".</li>}
      </ul>
    </Sheet>
  );
}

// Kroger prices for matched snacks, shared across screens and refreshed when the matched set changes.
let priceCache: { key: string; data: Record<string, KrogerPrice> } | null = null;

export function useSnackPrices(s: AppState) {
  const upcs = s.features.kroger
    ? [...new Set(snackItems(s.pantry).filter((p) => p.store === 'Kroger' && p.kroger_upc).map((p) => p.kroger_upc!))].sort()
    : [];
  const key = upcs.join(',');
  const [prices, setPrices] = useState<Record<string, KrogerPrice>>(priceCache?.key === key ? priceCache.data : {});
  useEffect(() => {
    if (!key) return;
    if (priceCache?.key === key) return setPrices(priceCache.data);
    api.kroger.prices(upcs).then((list) => {
      const data = Object.fromEntries(list.map((p) => [p.upc, p]));
      priceCache = { key, data };
      setPrices(data);
    }).catch(() => {});
  }, [key]);
  return prices;
}

export function SnacksSection() {
  const store = useStore();
  const s = store.state!;
  const prices = useSnackPrices(s);
  const [picking, setPicking] = useState(false);
  const byKey = new Map(s.pantry.map((p) => [p.key, p]));
  const items = snackItems(s.pantry);
  const save = (snacks: SnackPick[]) => store.run(() => api.saveSnacks(s.week_of, snacks), (st) => ({ ...st, snacks }));
  const patch = (i: number, p: Partial<SnackPick>) => save(s.snacks.map((x, n) => (n === i ? { ...x, ...p } : x)));

  const total = s.snacks.reduce((sum, x) => sum + (snackPrice(byKey.get(x.key), prices) ?? 0) * x.qty, 0);
  const missing = s.snacks.filter((x) => snackPrice(byKey.get(x.key), prices) == null).length;
  const prev = s.prev_snacks.filter((x) => byKey.get(x.key)?.snack);
  const add = () => {
    const next = addSnack(s, prices);
    next ? save(next) : store.toast(items.length ? 'Every snack is already on the list' : 'Add some snacks first');
  };
  const reroll = (i: number) => {
    const next = rerollSnack(s, i, prices);
    next ? save(next) : store.toast('No other snacks to pick from');
  };

  return (
    <section class="snacks">
      <div class="row between">
        <h2>Snacks</h2>
        {s.snacks.length > 0 && <span class="small">About <b>{money(total)}</b></span>}
      </div>
      {!s.snacks.length && <p class="small muted">Optional. Add a few for the week, or leave it empty.</p>}
      {s.snacks.length > 0 && (
        <ul class="glist">
          {s.snacks.map((x, i) => {
            const item = byKey.get(x.key);
            const sale = salePrice(item, prices);
            const price = snackPrice(item, prices);
            return (
              <li key={x.key} class={x.locked ? 'locked' : ''}>
                <div class="gline">
                  <span><b>{item?.name ?? 'Removed snack'}</b> {sale != null && <span class="sale">On sale</span>}</span>
                  <span class="small muted">
                    {[
                      item?.store,
                      price != null ? `${money(price)}${item?.unit ? ` / ${item.unit}` : ''}` : 'no price',
                      sale != null && item?.price != null && item.price > sale ? `usually ${money(item.price)}` : '',
                      x.locked ? 'locked' : '',
                    ].filter(Boolean).join(' · ')}
                  </span>
                </div>
                <div class="snack-actions">
                  <span class="stepper">
                    <button class="icon" aria-label="One fewer" disabled={x.qty <= 1} onClick={() => patch(i, { qty: x.qty - 1 })}><Icon name="minus" size={16} /></button>
                    <span>{x.qty}</span>
                    <button class="icon" aria-label="One more" onClick={() => patch(i, { qty: x.qty + 1 })}><Icon name="plus" size={16} /></button>
                  </span>
                  <button class={`btn tiny ${x.locked ? '' : 'primary'}`} onClick={() => patch(i, { locked: x.locked ? 0 : 1 })}>{x.locked ? 'Unlock' : 'Lock'}</button>
                  {!x.locked && (
                    <>
                      <button class="icon" aria-label={`Reroll ${item?.name ?? 'snack'}`} onClick={() => reroll(i)}><Icon name="reroll" size={18} /></button>
                      <button class="icon" aria-label={`Remove ${item?.name ?? 'snack'}`} onClick={() => save(s.snacks.filter((_, n) => n !== i))}><Icon name="x" size={18} /></button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div class="row gap-sm">
        <button class="btn" onClick={add}><Icon name="plus" size={18} /> Add snack</button>
        <button class="btn" onClick={() => setPicking(true)}><Icon name="search" size={18} /> Pick</button>
        {!s.snacks.length && prev.length > 0 && (
          <button class="btn" onClick={() => save(prev.map((x) => ({ ...x, locked: 1, skipped: [] })))}>Same as last week</button>
        )}
        {s.snacks.some((x) => !x.locked) && (
          <button class="btn" onClick={() => save(s.snacks.map((x) => ({ ...x, locked: 1 })))}><Icon name="lock" size={18} /> Lock all</button>
        )}
      </div>
      {missing > 0 && <p class="small muted">{missing} {missing === 1 ? 'snack has' : 'snacks have'} no price, so the total is low.</p>}
      <p class="small"><a href="#/snacks">Manage snacks →</a></p>
      {picking && (
        <SnackPickSheet
          prices={prices}
          onClose={() => setPicking(false)}
          onPick={(key) => {
            setPicking(false);
            save([...s.snacks, { key, qty: 1, locked: 1, skipped: [] }]);
          }}
        />
      )}
    </section>
  );
}

function SnackPickSheet({ prices, onClose, onPick }: { prices: Record<string, KrogerPrice>; onClose: () => void; onPick: (key: string) => void }) {
  const store = useStore();
  const s = store.state!;
  const [q, setQ] = useState('');
  const on = new Set(s.snacks.map((x) => x.key));
  const list = snackItems(s.pantry)
    .filter((p) => p.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (salePrice(b, prices) ? 1 : 0) - (salePrice(a, prices) ? 1 : 0) || a.name.localeCompare(b.name));
  const addNew = async () => {
    const key = await saveSnackItem(store.run, s.pantry, { name: q.trim(), unit: 'each' });
    if (key) onPick(key);
  };
  return (
    <Sheet title="Pick a snack" onClose={onClose}>
      <input class="search" type="search" placeholder="Search or type a new snack" value={q} onInput={(e) => setQ(e.currentTarget.value)} />
      <ul class="list">
        {list.map((p) => (
          <li key={p.key}>
            <button class="list-item" disabled={on.has(p.key)} onClick={() => onPick(p.key)}>
              <span class="meal-name">{p.name} {salePrice(p, prices) != null && <span class="sale">On sale</span>}</span>
              <span class="meta">
                {[p.store, snackPrice(p, prices) != null ? money(snackPrice(p, prices)!) : 'no price', on.has(p.key) ? 'already on the list' : ''].filter(Boolean).join(' · ')}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {q.trim() && !list.some((p) => p.name.toLowerCase() === q.trim().toLowerCase()) && (
        <button class="btn wide" onClick={addNew}><Icon name="plus" size={18} /> Add "{q.trim()}" as a new snack</button>
      )}
    </Sheet>
  );
}

/** Save a snack, keeping what the pantry already knows about that product. Returns its key. */
export async function saveSnackItem(
  run: (fn: () => Promise<unknown>) => Promise<boolean>,
  pantry: PantryItem[],
  p: Partial<PantryItem> & { name: string; unit: string },
) {
  const key = p.key ?? itemKey(p.name, p.unit);
  const existing = pantry.find((x) => x.key === key);
  const ok = await run(() => api.savePantry({ ...(existing ?? {}), ...p, key, snack: 1 }));
  return ok ? key : null;
}
