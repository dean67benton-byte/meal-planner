import { useState } from 'preact/hooks';
import { api } from '../lib/api';
import { money } from '../lib/grocery';
import { useStore } from '../lib/store';
import { itemKey, type PantryItem } from '../lib/types';
import { Icon } from '../icons';
import { Sheet } from '../ui';
import { ItemSheet } from './grocery';

export function PantryScreen() {
  const store = useStore();
  const s = store.state!;
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<PantryItem | null>(null);
  const [adding, setAdding] = useState(false);
  const used = new Set(s.meals.flatMap((m) => m.ingredients.map((i) => itemKey(i.name, i.unit))));
  const list = s.pantry.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <header class="top">
        <a class="ghost" href="#/groceries">Back</a>
        <h1 class="top-title">Prices & pantry</h1>
        <button class="btn" onClick={() => setAdding(true)}><Icon name="plus" size={18} /> Add</button>
      </header>
      <p class="small muted">Every ingredient once, with its price per unit and how much you have. Ingredients are added here automatically when you save a meal.</p>
      <input class="search" type="search" placeholder="Search ingredients" value={q} onInput={(e) => setQ(e.currentTarget.value)} />
      <ul class="glist">
        {list.map((p) => (
          <li key={p.key}>
            <button class="gline" onClick={() => setEditing(p)}>
              <span><b>{p.name}</b> <span class="qty">per {p.unit}</span></span>
              <span class="small muted">
                {[p.price != null ? money(p.price) : 'no price', p.store, p.staple ? (p.restock ? 'staple · restock' : 'staple') : '', p.on_hand ? `have ${p.on_hand}` : '', p.kroger_upc ? 'Kroger matched' : '']
                  .filter(Boolean).join(' · ')}
              </span>
            </button>
            {!used.has(p.key) && (
              <button class="icon" aria-label={`Delete ${p.name}`} onClick={() => store.run(() => api.deletePantry(p.key))}><Icon name="trash" size={18} /></button>
            )}
          </li>
        ))}
      </ul>
      {!s.pantry.length && <div class="empty">Nothing here yet. Save a meal with ingredients and they'll appear.</div>}
      {editing && <ItemSheet line={{ key: editing.key, name: editing.name, unit: editing.unit, item: editing }} onClose={() => setEditing(null)} />}
      {adding && <AddSheet onClose={() => setAdding(false)} />}
    </>
  );
}

function AddSheet({ onClose }: { onClose: () => void }) {
  const store = useStore();
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('each');
  return (
    <Sheet title="Add ingredient" onClose={onClose}>
      <label class="field"><span>Name</span><input value={name} onInput={(e) => setName(e.currentTarget.value)} autoFocus /></label>
      <label class="field">
        <span>Unit</span>
        <select value={unit} onChange={(e) => setUnit(e.currentTarget.value)}>{store.state!.settings.units.map((u) => <option key={u}>{u}</option>)}</select>
      </label>
      <button class="btn primary wide" disabled={!name.trim()} onClick={() => { onClose(); store.run(() => api.savePantry({ name, unit })); }}>Add</button>
    </Sheet>
  );
}
