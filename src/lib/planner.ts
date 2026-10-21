// Weekly suggestions, ported from the spreadsheet's rules and extended with cook balancing:
//  1. Only active meals in the slot's category; never one already used in another slot this week.
//  2. Meals still inside their repeat wait are used only when nothing else is left (flagged).
//  3. Dinners prefer a protein the other dinners aren't using.
//  4. Prefer a meal whose cook keeps the week split fairly between Dean and Kinley.
//  5. Never-eaten meals first, then the one eaten longest ago. Ties go to the quicker meal.
// Rerolling adds the current meal to the slot's "skipped" list and picks again.
import type { AppState, KrogerPrice, Meal, PantryItem, Settings, Slot, SnackPick } from './types';
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

/** When a dinner's meal changes, sides picked for the old meal go unless they were locked in. */
export const keepLockedSides = (slot: Slot, mealId: string | null) =>
  mealId === slot.meal_id ? slot.sides : slot.sides.filter((x) => x.locked);

/** Fill every unlocked, uneaten slot in order. `refill` also replaces meals already suggested. */
export function fillWeek(state: PlanData, weekOf: string, slots: Slot[], refill = false): Slot[] {
  let next = slots.map((s) => ({ ...s }));
  for (const s of next) {
    if (s.locked || s.eaten_date) continue;
    if (s.meal_id && !refill && state.meals.some((m) => m.id === s.meal_id && !m.archived)) continue;
    const working = next.map((x) => (x.slot === s.slot ? { ...x, meal_id: null } : x));
    const p = suggest(state, weekOf, working, s.slot);
    next = next.map((x) => (x.slot === s.slot ? { ...x, meal_id: p.meal_id, cook: p.cook, sides: keepLockedSides(x, p.meal_id) } : x));
  }
  return next;
}

export function reroll(state: PlanData, weekOf: string, slots: Slot[], slotNo: number): Slot[] {
  const cur = slots.find((s) => s.slot === slotNo)!;
  const skipped = cur.meal_id && !cur.skipped.includes(cur.meal_id) ? [...cur.skipped, cur.meal_id] : cur.skipped;
  const working = slots.map((s) => (s.slot === slotNo ? { ...s, meal_id: null, skipped } : s));
  const p = suggest(state, weekOf, working, slotNo);
  const reset = p.warning?.startsWith("You've rerolled") ? (p.meal_id ? [] : skipped) : skipped;
  return working.map((s) =>
    s.slot === slotNo ? { ...s, meal_id: p.meal_id, cook: p.cook, skipped: reset, sides: keepLockedSides(cur, p.meal_id) } : s,
  );
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

// ---- Sides (dinners only) ----
// A side is a meal with category "Side". Each dinner starts with none; "Add side" asks for a suggestion:
//  1. Never a side already on this dinner, or one rerolled away from it.
//  2. Sides you've locked in with this meal before score up; ones you rerolled away from it score down.
//  3. Until there's history, styles do the pairing: a Mexican side suits a Mexican meal, BBQ and American mix,
//     and a side with no style (salad, green beans) goes with anything. A clashing style scores well down.
//  4. A side already on another dinner this week scores a little lower. Ties go to the quicker side.
//  5. Once a meal has two or more favourite sides, about one suggestion in four is a fitting side you
//     haven't had with it yet.

const STYLE_WORDS: [string, RegExp][] = [
  ['Mexican', /taco|burrito|enchilada|quesadilla|fajita|nacho|salsa|mexican|tortilla|elote|refried|spanish rice|cilantro|street corn|queso|carnitas|chimichanga/],
  ['Italian', /pasta|spaghetti|lasagna|alfredo|parmesan|parm\b|marinara|italian|garlic bread|caesar|tuscan|ravioli|meatball|pizza|penne|fettuccine|ziti|bruschetta/],
  ['Asian', /stir.?fry|teriyaki|fried rice|lo mein|egg roll|asian|sesame|ramen|noodle|orange chicken|kung pao|sweet and sour|edamame|potsticker|dumpling|broccoli beef|beef (&|and) broccoli|thai|curry|bulgogi|jasmine/],
  ['BBQ', /bbq|barbecue|pulled pork|brisket|ribs|cole ?slaw|baked beans|cornbread|mac.*cheese/],
  ['Breakfast', /breakfast|pancake|waffle|scramble|omelet|hash ?brown|french toast|biscuit/],
  ['American', /burger|steak|meatloaf|pork chop|mashed|baked potato|fries|tots|dinner roll|mac.*cheese|sandwich|hoagie|slider|wings|chili|fried chicken|grilled chicken|potato/],
];
const NEAR: Record<string, string[]> = { American: ['BBQ', 'Breakfast'], BBQ: ['American'], Breakfast: ['American'] };

/** A meal's style: its own setting, or the first one its name suggests. */
export const mealStyle = (m: Meal) => m.style || STYLE_WORDS.find(([, re]) => re.test(m.name.toLowerCase()))?.[0] || '';

/** Styles a side fits; empty means it goes with anything. */
export const sideStyles = (m: Meal) =>
  m.style ? [m.style] : STYLE_WORDS.filter(([, re]) => re.test(m.name.toLowerCase())).map(([s]) => s);

export const isSide = (m: Meal) => m.category === 'Side';
export const activeSides = (meals: Meal[]) => meals.filter((m) => isSide(m) && !m.archived);

export interface SideSuggestion {
  id: string | null;
  note: string | null;
}

type SideData = Pick<AppState, 'meals' | 'side_pairs'>;

export function suggestSide(state: SideData, slots: Slot[], slotNo: number, skipped: string[] = [], random = Math.random): SideSuggestion {
  const slot = slots.find((s) => s.slot === slotNo)!;
  const meal = state.meals.find((m) => m.id === slot.meal_id);
  const sides = activeSides(state.meals);
  if (!sides.length) return { id: null, note: 'No sides yet. Add some on the Meals tab or from Ideas.' };
  const onThis = new Set(slot.sides.map((x) => x.id));
  const elsewhere = new Set(slots.filter((s) => s.slot !== slotNo).flatMap((s) => s.sides.map((x) => x.id)));
  const pairs = new Map(state.side_pairs.filter((p) => p.meal_id === meal?.id).map((p) => [p.side_id, p]));
  const style = meal ? mealStyle(meal) : '';

  const styleScore = (side: Meal) => {
    const fits = sideStyles(side);
    if (!style || !fits.length) return 0;
    if (fits.includes(style)) return 3;
    if (fits.some((f) => NEAR[style]?.includes(f))) return 1.5;
    return -4;
  };
  const scored = sides
    .filter((x) => !onThis.has(x.id))
    .map((x) => {
      const p = pairs.get(x.id);
      const fit = styleScore(x);
      return { x, fit, tried: !!p && p.kept + p.skipped > 0, score: (p ? 4 * p.kept - 3 * p.skipped : 0) + fit - (elsewhere.has(x.id) ? 1 : 0) };
    })
    .sort((a, b) => b.score - a.score || (totalMinutes(a.x) || 999) - (totalMinutes(b.x) || 999) || a.x.name.localeCompare(b.x.name));
  if (!scored.length) return { id: null, note: 'Every side is already on this dinner.' };

  const skip = new Set(skipped);
  const fresh = scored.filter((c) => !skip.has(c.x.id));
  const pool = fresh.length ? fresh : scored;
  const favourites = [...pairs.values()].filter((p) => p.kept > p.skipped).length;
  const untried = pool.filter((c) => !c.tried && c.fit >= 0);
  const explore = favourites >= 2 && untried.length > 0 && random() < 0.25;
  const pick = explore ? untried[0] : pool[0];
  const kept = pairs.get(pick.x.id)?.kept ?? 0;
  const note = !fresh.length
    ? "You've rerolled through every side, so they're starting over."
    : explore
      ? `Something new to try with ${meal?.name ?? 'this'}.`
      : kept > 0
        ? `You've had this with ${meal?.name ?? 'this meal'} ${kept === 1 ? 'before' : `${kept} times`}.`
        : pick.fit < 0
          ? "Doesn't usually go with this style of meal, but it's what's left."
          : null;
  return { id: pick.x.id, note };
}

/** Add a suggested side to a dinner. */
export function addSide(state: SideData, slots: Slot[], slotNo: number): { slots: Slot[]; note: string | null } {
  const p = suggestSide(state, slots, slotNo);
  if (!p.id) return { slots, note: p.note };
  return {
    slots: slots.map((s) => (s.slot === slotNo ? { ...s, sides: [...s.sides, { id: p.id!, locked: 0, skipped: [] }] } : s)),
    note: p.note,
  };
}

/** Swap one side on a dinner for the next suggestion. */
export function rerollSide(state: SideData, slots: Slot[], slotNo: number, index: number): { slots: Slot[]; note: string | null } {
  const slot = slots.find((s) => s.slot === slotNo)!;
  const cur = slot.sides[index];
  const skipped = cur.skipped.includes(cur.id) ? cur.skipped : [...cur.skipped, cur.id];
  const without = slots.map((s) => (s.slot === slotNo ? { ...s, sides: s.sides.filter((_, i) => i !== index) } : s));
  const p = suggestSide(state, without, slotNo, skipped);
  if (!p.id) return { slots, note: p.note };
  const restart = p.note?.startsWith("You've rerolled");
  const next = { id: p.id, locked: 0, skipped: restart ? [] : skipped };
  return {
    slots: slots.map((s) => (s.slot === slotNo ? { ...s, sides: s.sides.map((x, i) => (i === index ? next : x)) } : s)),
    note: p.note,
  };
}

// ---- Snacks ----
// Snacks are pantry items marked as snacks. They aren't tied to meals and have no repeat wait.
//  1. Never one already on this week's list, or one rerolled away from that spot.
//  2. Kroger snacks on sale come first.
//  3. Then the ones you lock in most often, so the usual favourites come up before the rest.
//  4. Then A–Z. Rerolling walks down the list, which is how you change it up.

export const snackItems = (pantry: PantryItem[]) => pantry.filter((p) => p.snack);

/** Sale price for a snack at Kroger, if it's matched to a product that's on sale. */
export const salePrice = (item: PantryItem | undefined, prices: Record<string, KrogerPrice>) => {
  const p = item?.store === 'Kroger' && item.kroger_upc ? prices[item.kroger_upc] : undefined;
  return p?.promo ? p.promo : null;
};

export const snackPrice = (item: PantryItem | undefined, prices: Record<string, KrogerPrice>) =>
  salePrice(item, prices) ?? item?.price ?? null;

type SnackData = Pick<AppState, 'pantry' | 'snacks' | 'snack_counts'>;

export function suggestSnack(state: SnackData, picks: SnackPick[], skipped: string[], prices: Record<string, KrogerPrice>) {
  const used = new Set(picks.map((p) => p.key));
  const ranked = snackItems(state.pantry)
    .filter((p) => !used.has(p.key))
    .sort(
      (a, b) =>
        (salePrice(b, prices) ? 1 : 0) - (salePrice(a, prices) ? 1 : 0) ||
        (state.snack_counts[b.key] ?? 0) - (state.snack_counts[a.key] ?? 0) ||
        a.name.localeCompare(b.name),
    );
  const skip = new Set(skipped);
  const fresh = ranked.filter((p) => !skip.has(p.key));
  return { item: (fresh.length ? fresh : ranked)[0] ?? null, restarted: !fresh.length && ranked.length > 0 };
}

export function addSnack(state: SnackData, prices: Record<string, KrogerPrice>): SnackPick[] | null {
  const { item } = suggestSnack(state, state.snacks, [], prices);
  return item ? [...state.snacks, { key: item.key, qty: 1, locked: 0, skipped: [] }] : null;
}

export function rerollSnack(state: SnackData, index: number, prices: Record<string, KrogerPrice>): SnackPick[] | null {
  const cur = state.snacks[index];
  const skipped = cur.skipped.includes(cur.key) ? cur.skipped : [...cur.skipped, cur.key];
  const others = state.snacks.filter((_, i) => i !== index);
  const { item, restarted } = suggestSnack(state, others, skipped, prices);
  if (!item) return null;
  return state.snacks.map((p, i) => (i === index ? { key: item.key, qty: cur.qty, locked: 0, skipped: restarted ? [] : skipped } : p));
}
