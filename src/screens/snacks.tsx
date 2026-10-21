import { useState } from 'preact/hooks';
import { api } from '../lib/api';
import { money } from '../lib/grocery';
import { salePrice, snackItems } from '../lib/planner';
import { useStore } from '../lib/store';
import { itemKey, type PantryItem } from '../lib/types';
import { Icon } from '../icons';
import { Sheet } from '../ui';
import { saveSnackItem, useSnackPrices } from './extras';
import { MatchSheet } from './grocery';

export function SnacksScreen() {
  const store = useStore();
  const s = store.state!;
  const prices = useSnackPrices(s);
  const [editing, setEditing] = useState<PantryItem | 'new' | null>(null);
  const [matching, setMatching] = useState<PantryItem | null>(null);
  const items = snackItems(s.pantry).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <header class="top">
        <a class="ghost" href="#/week">Back</a>
        <h1 class="top-title">Snacks</h1>
        <button class="btn" onClick={() => setEditing('new')}><Icon name="plus" size={18} /> Add</button>
      </header>
      <p class="small muted">
        The snacks you buy. Suggestions put Kroger sales first, then the ones you pick most. Snacks set to Costco go on the grocery list under Costco and stay out of the Kroger cart.
      </p>
      <ul class="glist">
        {items.map((p) => {
          const sale = salePrice(p, prices);
          return (
            <li key={p.key}>
              <button class="gline" onClick={() => setEditing(p)}>
                <span><b>{p.name}</b> <span class="qty">per {p.unit}</span> {sale != null && <span class="sale">On sale {money(sale)}</span>}</span>
                <span class="small muted">
                  {[p.price != null ? money(p.price) : 'no price', p.store, p.kroger_desc ?? '', s.snack_counts[p.key] ? `picked ${s.snack_counts[p.key]}×` : '']
                    .filter(Boolean).join(' · ')}
                </span>
              </button>
              {s.features.kroger && p.store === 'Kroger' && (
                <button class="btn tiny" onClick={() => setMatching(p)}>{p.kroger_upc ? 'Change' : 'Match'}</button>
              )}
            </li>
          );
        })}
      </ul>
      {!items.length && <div class="empty">No snacks yet. Tap Add.</div>}
      {s.features.kroger && items.some((p) => p.store === 'Kroger' && !p.kroger_upc) && (
        <p class="small muted">Match snacks to a Kroger product to see when they're on sale and to send them to your cart.</p>
      )}
      {editing && <SnackSheet item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {matching && <MatchSheet line={{ key: matching.key, name: matching.name, unit: matching.unit, item: matching }} onClose={() => setMatching(null)} />}
    </>
  );
}

function SnackSheet({ item, onClose }: { item: PantryItem | null; onClose: () => void }) {
  const store = useStore();
  const s = store.state!;
  const [name, setName] = useState(item?.name ?? '');
  const [unit, setUnit] = useState(item?.unit ?? 'bag');
  const [price, setPrice] = useState(item?.price?.toString() ?? '');
  const [where, setWhere] = useState(item?.store ?? 'Kroger');
  const usedInMeals = !!item && s.meals.some((m) => m.ingredients.some((i) => itemKey(i.name, i.unit) === item.key));

  const save = async () => {
    onClose();
    await saveSnackItem(store.run, s.pantry, {
      key: item?.key,
      name: name.trim(),
      unit,
      price: price === '' ? null : Number(price),
      store: where,
    });
  };
  const remove = async () => {
    onClose();
    // An ingredient that meals use stays in the pantry; it just stops being a snack.
    await store.run(() => (usedInMeals ? api.savePantry({ ...item!, snack: 0 }) : api.deletePantry(item!.key)));
  };

  return (
    <Sheet title={item ? item.name : 'New snack'} onClose={onClose}>
      <label class="field"><span>Name</span><input value={name} onInput={(e) => setName(e.currentTarget.value)} placeholder="e.g. Cheez-It" autoFocus={!item} /></label>
      <div class="grid2">
        <label class="field">
          <span>Comes as</span>
          <select value={unit} disabled={!!item} onChange={(e) => setUnit(e.currentTarget.value)}>{[...new Set([...s.settings.units, unit])].map((u) => <option key={u}>{u}</option>)}</select>
        </label>
        <label class="field"><span>Price per {unit}</span><input inputMode="decimal" value={price} placeholder="$" onInput={(e) => setPrice(e.currentTarget.value)} /></label>
      </div>
      <label class="field">
        <span>Buy at</span>
        <select value={where} onChange={(e) => setWhere(e.currentTarget.value)}>{s.settings.stores.map((x) => <option key={x}>{x}</option>)}</select>
      </label>
      <button class="btn primary wide" disabled={!name.trim()} onClick={save}>Save</button>
      {item && <button class="btn wide" onClick={remove}><Icon name="trash" size={18} /> Remove from snacks</button>}
    </Sheet>
  );
}
