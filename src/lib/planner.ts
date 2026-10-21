// Weekly suggestions, ported from the spreadsheet's rules and extended with cook balancing:
//  1. Only active meals in the slot's category; never one already used in another slot this week.
//  2. Meals still inside their repeat wait are used only when nothing else is left (flagged).
//  3. Dinners prefer a protein the other dinners aren't using.
//  4. Prefer a meal whose cook keeps the week split fairly between Dean and Kinley.
//  5. Never-eaten meals first, then the one eaten longest ago. Ties go to the quicker meal.
// Rerolling adds the current meal to the slot's "skipped" list and picks again.
import type { AppState, Meal, Settings, Slot } from './types';
import { addDays } from './dates';

export interface Suggestion {
  meal_id: string | null;
  cook: string | null;
  warning: string | null;
}

export const totalMinutes = (m: Meal) => (m.prep_min ?? 0) + (m.cook_min ?? 0);

export const repeatDays = (m: Meal, s: Settings) => m.repeat_days ?? s.repeat_days;

/** First day this meal may be eaten again, or null if it's ready now. */
export function readyOn(m: Meal, state: PlanData, weekOf: string) {
  const last = state.last_eaten[m.id];
  if (!last) return null;
  const next = addDays(last, repeatDays(m, state.settings));
  return next > weekOf ? next : null;
}

type PlanData = Pick<AppState, 'meals' | 'settings' | 'last_eaten'>;

function cookCounts(slots: Slot[], skip: number, cooks: string[]) {
  const counts: Record<string, number> = Object.fromEntries(cooks.map((c) => [c, 0]));
  for (const s of slots) if (s.slot !== skip && s.meal_id && s.cook && s.cook in counts) counts[s.cook]++;
  return counts;
}

/** Who should cook a meal in this slot: its fixed cook, or whoever has fewer meals so far. */
export function assignCook(meal: Meal, slots: Slot[], slotNo: number, cooks: string[]) {
  if (meal.cook !== 'Either' && cooks.includes(meal.cook)) return meal.cook;
  const counts = cookCounts(slots, slotNo, cooks);
  return [...cooks].sort((a, b) => counts[a] - counts[b] || (slotNo % 2 ? -1 : 1))[0] ?? null;
}

export function suggest(state: PlanData, weekOf: string, slots: Slot[], slotNo: number): Suggestion {
  const slot = slots.find((s) => s.slot === slotNo)!;
  const cooks = state.settings.cooks;
  const others = slots.filter((s) => s.slot !== slotNo && s.meal_id);
  const usedIds = new Set(others.map((s) => s.meal_id));
  const byId = new Map(state.meals.map((m) => [m.id, m]));
  const otherDinnerProteins = new Set(
    others.filter((s) => s.category === 'Dinner').map((s) => byId.get(s.meal_id!)?.protein).filter(Boolean),
  );
  const counts = cookCounts(slots, slotNo, cooks);
  const cap = Math.ceil(slots.length / Math.max(cooks.length, 1));

  const pool = state.meals.filter((m) => !m.archived && m.category === slot.category && !usedIds.has(m.id));
  if (!pool.length) {
    return { meal_id: null, cook: null, warning: `No ${slot.category.toLowerCase()} meals yet. Add some on the Meals tab.` };
  }

  const rank = (m: Meal) => [
    readyOn(m, state, weekOf) ? 1 : 0,
    slot.category === 'Dinner' && m.protein && otherDinnerProteins.has(m.protein) ? 1 : 0,
    m.cook !== 'Either' && (counts[m.cook] ?? 0) >= cap ? 1 : 0,
    state.last_eaten[m.id] ? Date.parse(state.last_eaten[m.id]) : 0,
    totalMinutes(m) || 999,
  ];
  const sorted = pool
    .map((m) => ({ m, r: rank(m) }))
    .sort((a, b) => {
      for (let i = 0; i < a.r.length; i++) if (a.r[i] !== b.r[i]) return a.r[i] - b.r[i];
      return a.m.name.localeCompare(b.m.name);
    });

  const skipped = new Set(slot.skipped);
  const fresh = sorted.filter((x) => !skipped.has(x.m.id));
  const choice = (fresh.length ? fresh : sorted)[0];
  const m = choice.m;
  const warnings = [];
  if (!fresh.length) warnings.push("You've rerolled through every option, so they're starting over.");
  const wait = readyOn(m, state, weekOf);
  if (wait) warnings.push(`Eaten recently. Normally waits until ${wait}.`);
  if (choice.r[1]) warnings.push('Same protein as another dinner (no other option).');
  return { meal_id: m.id, cook: assignCook(m, slots, slotNo, cooks), warning: warnings.join(' ') || null };
}

/** Fill every unlocked, uneaten slot in order. `refill` also replaces meals already suggested. */
export function fillWeek(state: PlanData, weekOf: string, slots: Slot[], refill = false): Slot[] {
  let next = slots.map((s) => ({ ...s }));
  for (const s of next) {
    if (s.locked || s.eaten_date) continue;
    if (s.meal_id && !refill && state.meals.some((m) => m.id === s.meal_id && !m.archived)) continue;
    const working = next.map((x) => (x.slot === s.slot ? { ...x, meal_id: null } : x));
    const p = suggest(state, weekOf, working, s.slot);
    next = next.map((x) => (x.slot === s.slot ? { ...x, meal_id: p.meal_id, cook: p.cook } : x));
  }
  return next;
}

export function reroll(state: PlanData, weekOf: string, slots: Slot[], slotNo: number): Slot[] {
  const cur = slots.find((s) => s.slot === slotNo)!;
  const skipped = cur.meal_id && !cur.skipped.includes(cur.meal_id) ? [...cur.skipped, cur.meal_id] : cur.skipped;
  const working = slots.map((s) => (s.slot === slotNo ? { ...s, meal_id: null, skipped } : s));
  const p = suggest(state, weekOf, working, slotNo);
  const reset = p.warning?.startsWith("You've rerolled") ? (p.meal_id ? [] : skipped) : skipped;
  return working.map((s) => (s.slot === slotNo ? { ...s, meal_id: p.meal_id, cook: p.cook, skipped: reset } : s));
}

/** Warning text to show under a slot, recomputed from current data. */
export function slotWarning(state: PlanData, weekOf: string, slots: Slot[], slot: Slot): string | null {
  if (!slot.meal_id) return suggest(state, weekOf, slots, slot.slot).warning;
  const meal = state.meals.find((m) => m.id === slot.meal_id);
  if (!meal) return 'This meal was deleted. Reroll or pick another.';
  if (slot.eaten_date) return null;
  const wait = readyOn(meal, state, weekOf);
  return wait ? `Eaten recently. Normally waits until ${wait}.` : null;
}

export function cookSplit(slots: Slot[], cooks: string[]) {
  return cookCounts(slots, -1, cooks);
}
