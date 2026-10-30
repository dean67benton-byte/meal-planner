import { useMemo, useState } from 'preact/hooks';
import { api } from '../lib/api';
import { addDays, short, today } from '../lib/dates';
import { mealCost, money } from '../lib/grocery';
import {
  OPTIONAL_SLOTS, addDinner, addOptionalSlot, optionalLabel, assignCook, cookSplit, dinners, fillWeek, isNew, isOptional, keepLockedSides,
  removableDinner, reroll, slotLabel, slotWarning, totalMinutes,
} from '../lib/planner';
import { useStore } from '../lib/store';
import type { KrogerPrice, Meal, PantryItem, Slot } from '../lib/types';
import { Icon } from '../icons';
import { CookBadge, NewBadge, Sheet, cookClass } from '../ui';
import { SidesBlock, SnacksSection, useKrogerPrices } from './extras';

export function WeekScreen() {
  const store = useStore();
  const s = store.state!;
  const [picking, setPicking] = useState<Slot | null>(null);
  const [eating, setEating] = useState<Slot | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const byId = useMemo(() => new Map(s.meals.map((m) => [m.id, m])), [s.meals]);
  const pantry = useMemo(() => new Map(s.pantry.map((p) => [p.key, p])), [s.pantry]);
  const prices = useKrogerPrices(s);
  const dinnerCount = dinners(s.slots).length;
  const removeDinner = () => {
    const x = removableDinner(s.slots);
    if (!x) return store.toast(dinnerCount > 1 ? 'Unlock a dinner to remove it' : 'A week needs at least one dinner');
    store.run(() => api.deleteSlot(s.week_of, x.slot), (st) => ({ ...st, slots: st.slots.filter((y) => y.slot !== x.slot) }));
  };
  const split = cookSplit(s.slots, s.settings.cooks);
  const lockedCount = s.slots.filter((x) => x.locked).length;
  const unlockedCount = s.slots.filter((x) => !x.locked && x.meal_id).length;
  // Each dinner's estimated price with its sides, and the week's total.
  const costs = new Map(
    s.slots.filter((x) => x.meal_id && byId.has(x.meal_id) && !isOptional(x)).map((x) => [x.slot, dinnerCost(byId.get(x.meal_id!)!, x, byId, pantry, prices)]),
  );
  const weekCost = [...costs.values()].reduce((sum, c) => sum + c.cost, 0);
  const missingPrices = [...costs.values()].reduce((sum, c) => sum + c.missing, 0);
  const missingOptional = OPTIONAL_SLOTS.filter((c) => !s.slots.some((x) => x.category === c));
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
            {lockedCount} of {s.slots.length} locked{weekCost > 0 && <> · about <b>{money(weekCost)}</b></>}
            {s.settings.cooks.map((c) => <span key={c}> · <span class={cookClass(c)}>{c} {split[c] ?? 0}</span></span>)}
          </p>
        </div>
        <button class="icon" aria-label="Next week" onClick={() => store.setWeek(addDays(store.week, 7))}><Icon name="chevR" /></button>
      </header>

      {missingPrices > 0 && (
        <p class="small muted price-note">
          {missingPrices} {missingPrices === 1 ? 'ingredient has' : 'ingredients have'} no price yet, so totals run low. <a href="#/pantry">Add prices</a>
        </p>
      )}

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
          const isOpen = open === x.slot || !meal;
          const cost = meal && !isOptional(x) ? costs.get(x.slot) : undefined;
          const sideNames = x.sides.map((y) => byId.get(y.id)?.name).filter(Boolean);
          return (
            <article key={x.slot} class={`slot card ${x.locked ? 'locked' : ''} ${x.eaten_date ? 'eaten' : ''}`}>
              <div class="slot-row">
                <button class="slot-sum" aria-expanded={isOpen} disabled={!meal} onClick={() => setOpen(isOpen ? null : x.slot)}>
                  <span class="slot-label">{slotLabel(s.slots, x)}</span>
                  <span class="meal-name">{meal ? meal.name : 'No meal yet'} {meal && isNew(meal, s) && <NewBadge />}</span>
                  {meal && (
                    <span class="meta">
                      {[
                        !isOptional(x) ? x.cook ?? 'Either' : '',
                        cost && cost.cost > 0 ? `${cost.missing ? 'at least ' : 'about '}${money(cost.cost)}` : '',
                        meal.prep_min != null ? `${meal.prep_min} min prep` : '',
                        sideNames.length ? `+ ${sideNames.join(', ')}` : '',
                        x.eaten_date ? `eaten ${short(x.eaten_date)}` : '',
                      ].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </button>
                {meal && !x.locked && (
                  <button class="icon" aria-label={`Reroll ${meal.name}`} onClick={() => store.saveSlots(reroll(s, s.week_of, s.slots, x.slot))}><Icon name="reroll" /></button>
                )}
                {meal && !x.eaten_date && (
                  <button
                    class={`lock-btn ${x.locked ? 'on' : ''}`}
                    aria-label={x.locked ? `Unlock ${meal.name}` : `Lock in ${meal.name}`}
                    aria-pressed={!!x.locked}
                    onClick={() => update(x.slot, { locked: x.locked ? 0 : 1 })}
                  >
                    <Icon name="lock" size={18} />{!x.locked && <span>Lock</span>}
                  </button>
                )}
                {x.eaten_date && <span class="icon done-mark" aria-label="Eaten"><Icon name="check" /></span>}
              </div>
              {isOpen && (
                <div class="slot-more">
                  {meal && (
                    <div class="row between">
                      <a class="small" href={`#/meals/${meal.id}`}>Open recipe →</a>
                      {!isOptional(x) && (
                        <button class="chip-btn" onClick={() => toggleCook(x)} aria-label={`Cook: ${x.cook ?? 'nobody'}. Tap to switch.`}>
                          <Icon name="chef" size={14} /> <CookBadge cook={x.cook} />
                        </button>
                      )}
                    </div>
                  )}
                  {meal && <MealMeta meal={meal} last={s.last_eaten[meal.id]} />}
                  {cost && meal && <PriceLine meal={meal} cost={cost} hasSides={x.sides.length > 0} />}
                  {warn && <p class="warn">{warn}</p>}
                  {meal && !isOptional(x) && <SidesBlock slot={x} />}
                  <div class="slot-actions">
                    {x.locked ? (
                      <button class={`btn ${x.eaten_date ? 'done' : 'primary'}`} onClick={() => (x.eaten_date ? store.run(() => api.eaten(s.week_of, x.slot, null)) : setEating(x))}>
                        <Icon name="check" size={18} /> {x.eaten_date ? `Eaten ${short(x.eaten_date)}` : 'Mark eaten'}
                      </button>
                    ) : (
                      <button class="btn" disabled={!s.meals.length} onClick={() => setPicking(x)}><Icon name="search" size={18} /> Pick a meal</button>
                    )}
                    {isOptional(x) && !x.eaten_date && (
                      <button class="btn" onClick={() => store.run(() => api.deleteSlot(s.week_of, x.slot))}><Icon name="x" size={18} /> Remove</button>
                    )}
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>

      <div class="row between dinner-count">
        <span>Dinners this week</span>
        <span class="stepper">
          <button class="icon" aria-label="One fewer dinner" disabled={dinnerCount <= 1} onClick={removeDinner}><Icon name="minus" size={16} /></button>
          <span>{dinnerCount}</span>
          <button class="icon" aria-label="One more dinner" onClick={() => store.saveSlots(addDinner(s, s.week_of, s.slots))}><Icon name="plus" size={16} /></button>
        </span>
      </div>

      <details class="extras card" open={s.snacks.length > 0}>
        <summary>Extras <span class="muted small">dessert, snack recipe, snacks</span></summary>
        {missingOptional.length > 0 && (
          <div class="row gap wrap">
            {missingOptional.map((c) => (
              <button key={c} class="btn" onClick={() => store.saveSlots(addOptionalSlot(s, s.week_of, s.slots, c))}>
                <Icon name="plus" size={18} /> Add {optionalLabel(c).toLowerCase()}
              </button>
            ))}
          </div>
        )}
        <SnacksSection />
      </details>

      {(unlockedCount > 0 || lockedCount > 0) && (
        <div class="action-bar">
          {unlockedCount > 0 ? (
            <>
              <button class="btn primary" onClick={lockAll}><Icon name="lock" size={18} /> Lock all ({unlockedCount})</button>
              <button class="btn" onClick={refreshAll}><Icon name="reroll" size={18} /> Fresh picks</button>
            </>
          ) : (
            <a class="btn primary" href="#/groceries"><Icon name="cart" size={18} /> Grocery list</a>
          )}
        </div>
      )}

      {picking && (
        <PickSheet
          slot={picking}
          onClose={() => setPicking(null)}
          onPick={(m) => {
            const working = s.slots.map((y) => (y.slot === picking.slot ? { ...y, meal_id: null } : y));
            update(picking.slot, {
              meal_id: m.id,
              locked: 1,
              cook: isOptional(picking) ? null : assignCook(m, working, picking.slot, s.settings.cooks),
              sides: keepLockedSides(picking, m.id),
            });
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
        meal.ingredients.length ? `${meal.ingredients.length} ${meal.ingredients.length === 1 ? 'ingredient' : 'ingredients'}` : '',
        last ? `last ${short(last)}` : '',
      ].filter(Boolean).join(' · ')}
    </span>
  );
}

/** Estimated price of a dinner and its sides, from Prices & pantry and today's Kroger prices. */
function dinnerCost(meal: Meal, slot: Slot, byId: Map<string, Meal>, pantry: Map<string, PantryItem>, prices: Record<string, KrogerPrice>) {
  const sides = slot.sides.map((x) => byId.get(x.id)).filter((m): m is Meal => !!m);
  const parts = [meal, ...sides].map((m) => mealCost(m, pantry, prices));
  return {
    cost: parts.reduce((sum, p) => sum + p.cost, 0),
    missing: parts.reduce((sum, p) => sum + p.missing, 0),
  };
}

function PriceLine({ meal, cost, hasSides }: { meal: Meal; cost: { cost: number; missing: number }; hasSides: boolean }) {
  if (!meal.ingredients.length) return <p class="price muted small">No ingredients yet, so no price estimate.</p>;
  return (
    <p class="price small">
      {cost.cost > 0 ? <>About <b>{money(cost.cost)}</b>{hasSides ? ' with sides' : ''}</> : <span class="muted">No price estimate yet</span>}
      {cost.missing > 0 && <span class="muted"> · {cost.missing} without a price</span>}
    </p>
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
    <Sheet title={`Pick for ${slotLabel(s.slots, slot)}`} onClose={onClose} tall>
      <div class="search-row"><input class="search" type="search" placeholder="Search meals" value={q} onInput={(e) => setQ(e.currentTarget.value)} /></div>
      <ul class="list">
        {list.map((m) => (
          <li key={m.id}>
            <button class="list-item" disabled={used.has(m.id)} onClick={() => onPick(m)}>
              <span class="meal-name">{m.name} {isNew(m, s) && <NewBadge />}</span>
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
