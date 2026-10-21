// Builds the week's grocery list from locked meals, locked sides, and locked snacks, like the sheet's Grocery List tab.
import type { AppState, Ingredient, PantryItem } from './types';
import { itemKey } from './types';

export interface GroceryLine {
  key: string;
  name: string;
  unit: string;
  needed: number | null; // null when a recipe line has no quantity
  onHand: number;
  toBuy: number | null;
  store: string;
  price: number | null;
  cost: number | null;
  usedIn: string[];
  staple: boolean;
  item: PantryItem | undefined;
}

export const PACKAGE_UNITS = new Set(['each', 'can', 'jar', 'pkg', 'bag', 'box', 'bunch', 'dozen', 'slice', 'clove']);

/** How many of a product to put in the Kroger cart for a line. */
export const cartQuantity = (l: GroceryLine) =>
  PACKAGE_UNITS.has(l.unit.toLowerCase()) && l.toBuy ? Math.max(1, Math.ceil(l.toBuy)) : 1;

export function buildList(state: AppState) {
  const byId = new Map(state.meals.map((m) => [m.id, m]));
  const pantry = new Map(state.pantry.map((p) => [p.key, p]));
  const lines = new Map<string, GroceryLine>();
  const locked = state.slots.filter((s) => s.meal_id && s.locked);
  const unlocked = state.slots.filter((s) => s.meal_id && !s.locked).length;

  const add = (ing: Ingredient, usedIn: string, key = itemKey(ing.name, ing.unit)) => {
    const item = pantry.get(key);
    const line = lines.get(key) ?? {
      key,
      name: item?.name ?? ing.name,
      unit: ing.unit,
      needed: 0,
      onHand: item?.on_hand ?? 0,
      toBuy: 0,
      store: item?.store || 'Kroger',
      price: item?.price ?? null,
      cost: null,
      usedIn: [],
      staple: !!item?.staple && !item?.restock,
      item,
    };
    line.needed = line.needed == null || ing.qty == null ? null : line.needed + ing.qty;
    if (!line.usedIn.includes(usedIn)) line.usedIn.push(usedIn);
    lines.set(key, line);
  };

  for (const s of locked) {
    const meal = byId.get(s.meal_id!);
    if (meal) for (const ing of meal.ingredients) add(ing, meal.name);
  }
  // Locked sides count even when their dinner isn't locked yet: you chose them.
  const sides = state.slots.flatMap((s) => (s.meal_id ? s.sides : []));
  for (const x of sides.filter((x) => x.locked)) {
    const side = byId.get(x.id);
    if (side) for (const ing of side.ingredients) add(ing, side.name);
  }
  const snacks = state.snacks.filter((x) => x.locked && pantry.has(x.key));
  for (const x of snacks) {
    const item = pantry.get(x.key)!;
    add({ name: item.name, unit: item.unit, qty: x.qty }, 'Snacks', x.key);
    lines.get(x.key)!.staple = false;
  }
  const unlockedExtras = sides.filter((x) => !x.locked).length + state.snacks.filter((x) => !x.locked).length;

  for (const l of lines.values()) {
    l.toBuy = l.needed == null ? null : Math.max(0, +(l.needed - l.onHand).toFixed(2));
    l.cost = l.price != null && l.toBuy != null ? +(l.toBuy * l.price).toFixed(2) : null;
  }

  const all = [...lines.values()].sort((a, b) => a.name.localeCompare(b.name));
  const staples = all.filter((l) => l.staple);
  const shop = all.filter((l) => !l.staple && l.toBuy !== 0);
  const covered = all.filter((l) => !l.staple && l.toBuy === 0);
  const stores = [...new Set(['Kroger', ...state.settings.stores, ...shop.map((l) => l.store)])].filter((st) =>
    shop.some((l) => l.store === st),
  );
  const total = shop.reduce((sum, l) => sum + (l.cost ?? 0), 0);
  const missingPrices = shop.filter((l) => l.price == null).length;
  return { shop, staples, covered, stores, total, missingPrices, lockedCount: locked.length, snackCount: snacks.length, unlocked, unlockedExtras };
}

export const fmtQty = (n: number | null) => (n == null ? '' : Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, ''));
export const money = (n: number) => `$${n.toFixed(2)}`;
