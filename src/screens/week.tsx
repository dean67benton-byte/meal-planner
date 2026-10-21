import { useMemo, useState } from 'preact/hooks';
import { api } from '../lib/api';
import { addDays, short, today } from '../lib/dates';
import { assignCook, cookSplit, fillWeek, reroll, slotWarning, totalMinutes } from '../lib/planner';
import { useStore } from '../lib/store';
import type { Meal, Slot } from '../lib/types';
import { go } from '../router';
import { Icon } from '../icons';
import { CookBadge, Sheet, cookClass } from '../ui';

export function WeekScreen() {
  const store = useStore();
  const s = store.state!;
  const [picking, setPicking] = useState<Slot | null>(null);
  const [eating, setEating] = useState<Slot | null>(null);
  const byId = useMemo(() => new Map(s.meals.map((m) => [m.id, m])), [s.meals]);
  const split = cookSplit(s.slots, s.settings.cooks);
  const lockedCount = s.slots.filter((x) => x.locked).length;
  const update = (slotNo: number, patch: Partial<Slot>) =>
    store.saveSlots(s.slots.map((x) => (x.slot === slotNo ? { ...x, ...patch } : x)));

  const lockAll = () => store.saveSlots(s.slots.map((x) => (x.meal_id ? { ...x, locked: 1 } : x)));
  const refreshAll = () => store.saveSlots(fillWeek(s, s.week_of, s.slots.map((x) => ({ ...x, skipped: [] })), true));
  const toggleCook = (x: Slot) => {
    const cooks = s.settings.cooks;
    update(x.slot, { cook: cooks[(cooks.indexOf(x.cook ?? '') + 1) % cooks.length] });
  };

  return (
    <>
      <header class="top">
        <button class="icon" aria-label="Previous week" onClick={() => store.setWeek(addDays(store.week, -7))}><Icon name="chevL" /></button>
        <div class="top-title">
          <h1>Week of {short(s.week_of)}</h1>
          <p class="muted">
            {lockedCount}/{s.slots.length} locked in
            {s.settings.cooks.map((c) => <span key={c}> · <span class={cookClass(c)}>{c} {split[c] ?? 0}</span></span>)}
          </p>
        </div>
        <button class="icon" aria-label="Next week" onClick={() => store.setWeek(addDays(store.week, 7))}><Icon name="chevR" /></button>
      </header>

      {!s.meals.length && (
        <div class="callout">
          <b>Your meal library is empty.</b> Add a few meals or grab some from Ideas and suggestions will fill in here.
          <div class="row gap">
            <a class="btn primary" href="#/ideas">Browse ideas</a>
            <a class="btn" href="#/meals/new">Add a meal</a>
          </div>
        </div>
      )}

      <div class="slots">
        {s.slots.map((x) => {
          const meal = x.meal_id ? byId.get(x.meal_id) : undefined;
          const warn = slotWarning(s, s.week_of, s.slots, x);
          return (
            <article key={x.slot} class={`slot card ${x.locked ? 'locked' : ''} ${x.eaten_date ? 'eaten' : ''}`}>
              <div class="slot-head">
                <span class="slot-label">{x.label}</span>
                {meal && (
                  <button class="chip-btn" onClick={() => toggleCook(x)} aria-label={`Cook: ${x.cook ?? 'nobody'}. Tap to switch.`}>
                    <Icon name="chef" size={14} /> <CookBadge cook={x.cook} />
                  </button>
                )}
              </div>
              {meal ? (
                <button class="slot-meal" onClick={() => go(`/meals/${meal.id}`)}>
                  <span class="meal-name">{meal.name}</span>
                  <MealMeta meal={meal} last={s.last_eaten[meal.id]} />
                </button>
              ) : (
                <p class="slot-meal muted">No meal yet</p>
              )}
              {warn && <p class="warn">{warn}</p>}
              <div class="slot-actions">
                {x.locked ? (
                  <>
                    <button class={`btn ${x.eaten_date ? 'done' : 'primary'}`} onClick={() => (x.eaten_date ? store.run(() => api.eaten(s.week_of, x.slot, null)) : setEating(x))}>
                      <Icon name="check" size={18} /> {x.eaten_date ? `Eaten ${short(x.eaten_date)}` : 'Mark eaten'}
                    </button>
                    {!x.eaten_date && (
                      <button class="btn" onClick={() => update(x.slot, { locked: 0 })}><Icon name="unlock" size={18} /> Unlock</button>
                    )}
                  </>
                ) : (
                  <>
                    <button class="btn primary" disabled={!meal} onClick={() => update(x.slot, { locked: 1 })}><Icon name="lock" size={18} /> Lock in</button>
                    <button class="btn" disabled={!s.meals.length} onClick={() => store.saveSlots(reroll(s, s.week_of, s.slots, x.slot))}><Icon name="reroll" size={18} /> Reroll</button>
                    <button class="btn" disabled={!s.meals.length} onClick={() => setPicking(x)}><Icon name="search" size={18} /> Pick</button>
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {s.slots.some((x) => !x.locked && x.meal_id) && (
        <div class="row gap center">
          <button class="btn" onClick={lockAll}><Icon name="lock" size={18} /> Lock all</button>
          <button class="btn" onClick={refreshAll}><Icon name="reroll" size={18} /> Fresh suggestions</button>
        </div>
      )}
      {lockedCount > 0 && (
        <p class="center muted small">
          <a href="#/groceries">Grocery list for locked meals →</a>
        </p>
      )}

      {picking && (
        <PickSheet
          slot={picking}
          onClose={() => setPicking(null)}
          onPick={(m) => {
            const working = s.slots.map((y) => (y.slot === picking.slot ? { ...y, meal_id: null } : y));
            update(picking.slot, { meal_id: m.id, locked: 1, cook: assignCook(m, working, picking.slot, s.settings.cooks) });
            setPicking(null);
          }}
        />
      )}
      {eating && <EatenSheet slot={eating} onClose={() => setEating(null)} />}
    </>
  );
}

export function MealMeta({ meal, last }: { meal: Meal; last?: string }) {
  const mins = totalMinutes(meal);
  return (
    <span class="meta">
      {[
        meal.protein,
        meal.prep_min != null ? `${meal.prep_min} min prep` : mins ? `${mins} min` : '',
        meal.ingredients.length ? `${meal.ingredients.length} ingredients` : '',
        last ? `last ${short(last)}` : 'never made',
      ].filter(Boolean).join(' · ')}
    </span>
  );
}

function PickSheet({ slot, onClose, onPick }: { slot: Slot; onClose: () => void; onPick: (m: Meal) => void }) {
  const s = useStore().state!;
  const [q, setQ] = useState('');
  const used = new Set(s.slots.filter((x) => x.slot !== slot.slot).map((x) => x.meal_id));
  const list = s.meals
    .filter((m) => !m.archived && m.category === slot.category && m.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    <Sheet title={`Pick for ${slot.label}`} onClose={onClose}>
      <input class="search" type="search" placeholder="Search meals" value={q} onInput={(e) => setQ(e.currentTarget.value)} />
      <ul class="list">
        {list.map((m) => (
          <li key={m.id}>
            <button class="list-item" disabled={used.has(m.id)} onClick={() => onPick(m)}>
              <span class="meal-name">{m.name}</span>
              <span class="row gap-sm"><CookBadge cook={m.cook} /> <MealMeta meal={m} last={s.last_eaten[m.id]} /></span>
              {used.has(m.id) && <span class="muted small">Already this week</span>}
            </button>
          </li>
        ))}
        {!list.length && <li class="muted">No {slot.category.toLowerCase()} meals match.</li>}
      </ul>
    </Sheet>
  );
}

function EatenSheet({ slot, onClose }: { slot: Slot; onClose: () => void }) {
  const store = useStore();
  const [date, setDate] = useState(today());
  return (
    <Sheet title="When did you eat it?" onClose={onClose}>
      <label class="field">
        <span>Date</span>
        <input type="date" value={date} onInput={(e) => setDate(e.currentTarget.value)} />
      </label>
      <button
        class="btn primary wide"
        onClick={async () => {
          onClose();
          if (await store.run(() => api.eaten(store.state!.week_of, slot.slot, date))) store.toast('Saved to history');
        }}
      >
        Save
      </button>
    </Sheet>
  );
}
