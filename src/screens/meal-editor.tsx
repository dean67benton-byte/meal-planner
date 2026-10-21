import { useMemo, useState } from 'preact/hooks';
import { api } from '../lib/api';
import { short, today } from '../lib/dates';
import { readyOn } from '../lib/planner';
import { useStore } from '../lib/store';
import type { Cook, Ingredient, Meal, MealDraft } from '../lib/types';
import { go } from '../router';
import { Icon } from '../icons';
import { Seg } from '../ui';

// The Ideas screen hands a draft over before opening #/meals/new.
let pendingDraft: MealDraft | null = null;
export const openDraft = (d: MealDraft) => {
  pendingDraft = d;
  go('/meals/new');
};

type Form = Omit<MealDraft, 'servings' | 'prep_min' | 'cook_min'> & {
  id?: string;
  servings: string;
  prep_min: string;
  cook_min: string;
  repeat_days: string;
  archived?: number;
};

const toForm = (m: Partial<Meal> | MealDraft): Form => ({
  id: 'id' in m ? m.id : undefined,
  name: m.name ?? '',
  category: m.category ?? 'Dinner',
  protein: m.protein ?? '',
  cook: (m.cook as Cook) ?? 'Either',
  servings: m.servings?.toString() ?? '',
  prep_min: m.prep_min?.toString() ?? '',
  cook_min: m.cook_min?.toString() ?? '',
  repeat_days: 'repeat_days' in m ? (m.repeat_days?.toString() ?? '') : '',
  recipe: m.recipe ?? '',
  notes: m.notes ?? '',
  source: m.source ?? 'manual',
  archived: 'archived' in m ? m.archived : 0,
  ingredients: m.ingredients?.length ? m.ingredients.map((i) => ({ ...i })) : [{ name: '', qty: null, unit: 'each' }],
});

export function MealEditor({ id }: { id: string }) {
  const store = useStore();
  const s = store.state!;
  const existing = s.meals.find((m) => m.id === id);
  const [form, setForm] = useState<Form>(() => {
    if (existing) return toForm(existing);
    const d = pendingDraft;
    pendingDraft = null;
    return toForm(d ?? { cook: 'Either', category: 'Dinner' });
  });
  const [editing, setEditing] = useState(!existing);
  const [saving, setSaving] = useState(false);
  const names = useMemo(() => [...new Set(s.pantry.map((p) => p.name))], [s.pantry]);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setIng = (i: number, patch: Partial<Ingredient>) =>
    set('ingredients', form.ingredients.map((x, n) => (n === i ? { ...x, ...patch } : x)));

  if (id !== 'new' && !existing) return <div class="empty">That meal isn't here anymore. <a href="#/meals">Back to meals</a></div>;

  const save = async (patch: Partial<Form> = {}) => {
    const f = { ...form, ...patch };
    if (!f.name.trim()) return store.toast('Give the meal a name');
    setSaving(true);
    let newId = f.id;
    const ok = await store.run(async () => {
      const r = await api.saveMeal({
        ...f,
        servings: f.servings ? Number(f.servings) : null,
        prep_min: f.prep_min ? Number(f.prep_min) : null,
        cook_min: f.cook_min ? Number(f.cook_min) : null,
        repeat_days: f.repeat_days ? Number(f.repeat_days) : null,
        ingredients: f.ingredients.filter((i) => i.name.trim()),
      } as Partial<Meal>);
      newId = r.id;
    });
    setSaving(false);
    if (!ok) return;
    store.toast(patch.archived ? 'Archived' : patch.archived === 0 ? 'Restored' : 'Saved');
    if (patch.archived) go('/meals');
    else if (!f.id) go(`/meals/${newId}`);
    else setEditing(false);
  };

  if (existing && !editing) return <MealView meal={existing} onEdit={() => setEditing(true)} onArchive={(a) => save({ archived: a })} />;

  return (
    <form class="editor" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <header class="top">
        <button type="button" class="ghost" onClick={() => (existing ? setEditing(false) : history.back())}>Cancel</button>
        <h1 class="top-title">{existing ? 'Edit meal' : 'New meal'}</h1>
        <button class="btn primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      </header>

      <label class="field">
        <span>Meal name</span>
        <input required value={form.name} onInput={(e) => set('name', e.currentTarget.value)} placeholder="e.g. Chicken fajitas" autoFocus={!existing} />
      </label>

      <div class="field">
        <span>Who cooks it?</span>
        <Seg label="Who cooks" value={form.cook} options={['Dean', 'Kinley', 'Either'] as const} onChange={(v) => set('cook', v)} />
      </div>

      <div class="field">
        <span>Category</span>
        <Seg label="Category" value={form.category} options={s.settings.categories} onChange={(v) => set('category', v)} />
      </div>

      <label class="field">
        <span>Protein</span>
        <select value={form.protein} onChange={(e) => set('protein', e.currentTarget.value)}>
          <option value="">Pick one</option>
          {s.settings.proteins.map((p) => <option key={p}>{p}</option>)}
        </select>
      </label>

      <div class="grid3">
        <label class="field"><span>Prep min</span><input inputMode="numeric" value={form.prep_min} onInput={(e) => set('prep_min', e.currentTarget.value)} /></label>
        <label class="field"><span>Cook min</span><input inputMode="numeric" value={form.cook_min} onInput={(e) => set('cook_min', e.currentTarget.value)} /></label>
        <label class="field"><span>Servings</span><input inputMode="numeric" value={form.servings} onInput={(e) => set('servings', e.currentTarget.value)} /></label>
      </div>

      <fieldset class="field">
        <legend>Ingredients</legend>
        <datalist id="ingredient-names">{names.map((n) => <option key={n} value={n} />)}</datalist>
        {form.ingredients.map((ing, i) => (
          <div class="ing-row" key={i}>
            <input class="ing-qty" inputMode="decimal" placeholder="Qty" aria-label="Quantity" value={ing.qty ?? ''} onInput={(e) => setIng(i, { qty: e.currentTarget.value === '' ? null : Number(e.currentTarget.value) })} />
            <select class="ing-unit" aria-label="Unit" value={ing.unit} onChange={(e) => setIng(i, { unit: e.currentTarget.value })}>
              {[...new Set([...s.settings.units, ing.unit])].map((u) => <option key={u}>{u}</option>)}
            </select>
            <input class="ing-name" list="ingredient-names" placeholder="Ingredient" aria-label="Ingredient" value={ing.name} onInput={(e) => setIng(i, { name: e.currentTarget.value })} />
            <button type="button" class="icon" aria-label="Remove ingredient" onClick={() => set('ingredients', form.ingredients.filter((_, n) => n !== i))}><Icon name="trash" size={18} /></button>
          </div>
        ))}
        <button type="button" class="btn" onClick={() => set('ingredients', [...form.ingredients, { name: '', qty: null, unit: 'each' }])}>
          <Icon name="plus" size={18} /> Ingredient
        </button>
        <p class="small muted">Use the same name and unit across meals so the grocery list can add them up.</p>
      </fieldset>

      <label class="field">
        <span>Recipe link or steps</span>
        <textarea rows={5} value={form.recipe} onInput={(e) => set('recipe', e.currentTarget.value)} placeholder="Paste a link, or type the steps" />
      </label>
      <label class="field">
        <span>Notes</span>
        <textarea rows={2} value={form.notes} onInput={(e) => set('notes', e.currentTarget.value)} />
      </label>
      <label class="field">
        <span>Days before it can repeat</span>
        <input inputMode="numeric" value={form.repeat_days} placeholder={`Default ${s.settings.repeat_days}`} onInput={(e) => set('repeat_days', e.currentTarget.value)} />
      </label>
      <button class="btn primary wide" disabled={saving}>{saving ? 'Saving…' : 'Save meal'}</button>
    </form>
  );
}

const URL_RE = /(https?:\/\/[^\s]+)/g;

function MealView({ meal, onEdit, onArchive }: { meal: Meal; onEdit: () => void; onArchive: (a: number) => void }) {
  const store = useStore();
  const s = store.state!;
  const last = s.last_eaten[meal.id];
  const wait = readyOn(meal, s, s.week_of);
  const times = s.history.filter((h) => h.meal_id === meal.id).length;
  return (
    <div class="view">
      <header class="top">
        <button class="ghost" onClick={() => history.back()}>Back</button>
        <span />
        <button class="btn" onClick={onEdit}>Edit</button>
      </header>
      <h1>{meal.name}</h1>
      <p class="muted">
        {[meal.category, meal.protein, `${meal.cook === 'Either' ? 'Either of you' : meal.cook} cooks`].filter(Boolean).join(' · ')}
      </p>
      <p class="muted small">
        {[
          meal.prep_min != null && `${meal.prep_min} min prep`,
          meal.cook_min != null && `${meal.cook_min} min cook`,
          meal.servings && `serves ${meal.servings}`,
        ].filter(Boolean).join(' · ')}
      </p>
      <p class="small">
        {last ? `Last made ${short(last)} (${times}×).` : 'Never made yet.'} {wait ? `Ready again ${short(wait)}.` : 'Ready to plan.'}
      </p>

      <h2>Ingredients</h2>
      {meal.ingredients.length ? (
        <ul class="ings">
          {meal.ingredients.map((i, n) => (
            <li key={n}><b>{i.qty ?? ''} {i.unit}</b> {i.name}</li>
          ))}
        </ul>
      ) : (
        <p class="muted">None yet. <button class="link" onClick={onEdit}>Add them</button> so they show on the grocery list.</p>
      )}

      {meal.recipe && (
        <>
          <h2>Recipe</h2>
          <p class="pre">
            {meal.recipe.split(URL_RE).map((part, n) => (n % 2 ? <a key={n} href={part} target="_blank" rel="noopener">{part}</a> : part))}
          </p>
        </>
      )}
      {meal.notes && (
        <>
          <h2>Notes</h2>
          <p class="pre">{meal.notes.split(URL_RE).map((part, n) => (n % 2 ? <a key={n} href={part} target="_blank" rel="noopener">{part}</a> : part))}</p>
        </>
      )}

      <div class="row gap wrap">
        <button class="btn" onClick={() => store.run(() => api.addHistory(today(), meal.id)).then((ok) => ok && store.toast('Logged for today'))}>
          Ate it today
        </button>
        <button class="btn" onClick={() => onArchive(meal.archived ? 0 : 1)}>{meal.archived ? 'Restore' : 'Archive'}</button>
      </div>
    </div>
  );
}
