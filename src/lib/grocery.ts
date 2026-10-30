// Builds the week's grocery list from locked meals, locked sides, and locked snacks, like the sheet's Grocery List tab.
import type { AppState, Ingredient, KrogerPrice, Meal, PantryItem } from './types';
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

export const PACKAGE_UNITS = new Set(['each', 'can', 'jar', 'pkg', 'bag', 'box', 'bunch', 'dozen', 'slice', 'clove', 'bottle', 'head']);

// Recipe units as ounces of weight or fluid ounces of volume, for turning a Kroger package price into a per-unit price.
const WEIGHT_OZ: Record<string, number> = { oz: 1, lb: 16, lbs: 16, g: 0.035274, kg: 35.274 };
const VOLUME_FLOZ: Record<string, number> = { tsp: 1 / 6, tbsp: 0.5, 'fl oz': 1, cup: 8, pint: 16, pt: 16, qt: 32, gal: 128, ml: 0.033814, l: 33.814 };

/** Reads a Kroger size such as "15 fl oz", "1/2 gal", "2 lb" or "8 ct". */
export function parseSize(size: string): { qty: number; unit: string } | null {
  const m = size.toLowerCase().match(/(\d+(?:\.\d+)?(?:\s*\/\s*\d+)?)\s*(fl\.?\s*oz|oz|lbs?|kg|g|gal|qt|pt|pint|ml|l|ct|count|slices?)\b/);
  if (!m) return null;
  const [a, b] = m[1].split('/').map(Number);
  const qty = b ? a / b : a;
  const unit = m[2].replace(/fl\.?\s*oz/, 'fl oz').replace(/^lbs$/, 'lb').replace(/^(count|slices?)$/, 'ct');
  return qty > 0 ? { qty, unit } : null;
}

/**
 * Price per recipe unit from a Kroger product's regular price and package size. A package unit (jar, can, bag…)
 * costs the whole package. Weights and volumes are converted when the size says how much is in the package; a
 * plain "oz" size counts as fluid ounces for cup and spoon units. Returns null when the units don't line up.
 */
export function krogerUnitPrice(price: number | null, size: string, unit: string): number | null {
  if (price == null || price <= 0) return null;
  const u = unit.trim().toLowerCase();
  const sz = parseSize(size);
  const round = (n: number) => +n.toFixed(4);
  if (u === 'slice' && sz?.unit === 'ct') return round(price / sz.qty);
  if (PACKAGE_UNITS.has(u)) return price;
  if (!sz) return null;
  if (u in WEIGHT_OZ && sz.unit in WEIGHT_OZ) return round((price / (sz.qty * WEIGHT_OZ[sz.unit])) * WEIGHT_OZ[u]);
  const volume = sz.unit === 'oz' ? 'fl oz' : sz.unit;
  if (u in VOLUME_FLOZ && volume in VOLUME_FLOZ) return round((price / (sz.qty * VOLUME_FLOZ[volume])) * VOLUME_FLOZ[u]);
  return null;
}

/** How many of a product to put in the Kroger cart for a line. */
export const cartQuantity = (l: GroceryLine) =>
  PACKAGE_UNITS.has(l.unit.toLowerCase()) && l.toBuy ? Math.max(1, Math.ceil(l.toBuy)) : 1;

/**
 * Price per unit for an ingredient. For a package matched to a Kroger product: today's sale price, then today's
 * regular price. Otherwise the price in Prices & pantry, which picking a Kroger product fills in.
 */
export function unitPrice(item: PantryItem | undefined, unit: string, prices: Record<string, KrogerPrice>) {
  const kroger = PACKAGE_UNITS.has(unit.toLowerCase()) && item?.store === 'Kroger' && item.kroger_upc ? prices[item.kroger_upc] : undefined;
  return kroger?.promo || kroger?.regular || (item?.price ?? null);
}

/** Estimated cost of a meal's ingredients. Staples kept on hand don't count; `missing` is ingredients with no price. */
export function mealCost(meal: Meal, pantry: Map<string, PantryItem>, prices: Record<string, KrogerPrice>) {
  let cost = 0;
  let missing = 0;
  for (const ing of meal.ingredients) {
    const item = pantry.get(itemKey(ing.name, ing.unit));
    if (item?.staple && !item.restock) continue;
    const price = unitPrice(item, ing.unit, prices);
    if (price == null || ing.qty == null) missing++;
    else cost += price * ing.qty;
  }
  return { cost, missing };
}

export function buildList(state: AppState, prices: Record<string, KrogerPrice> = {}) {
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
      price: unitPrice(item, ing.unit, prices),
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

// Store aisles in the order you'd usually walk a Kroger. An item goes in the first list with a matching word,
// and the more specific lists come first, so "frozen broccoli" isn't produce and "chicken broth" isn't meat.
export const AISLES = ['Produce', 'Bakery', 'Meat & seafood', 'Deli', 'Dairy & eggs', 'Frozen', 'Pantry', 'Snacks & drinks', 'Other'] as const;
export type Aisle = (typeof AISLES)[number];
const AISLE_WORDS: [Aisle, string[]][] = [
  ['Bakery', ['hamburger bun', 'hot dog bun', 'slider bun', 'hawaiian roll']],
  ['Frozen', ['frozen', 'ice cream', 'fries', 'tater tot', 'popsicle', 'steam-in-bag']],
  ['Deli', ['deli', 'rotisserie', 'salami', 'pepperoni', 'lunch meat', 'hummus', 'tzatziki']],
  ['Pantry', ['broth', 'stock', 'bouillon', 'sauce', 'salsa', 'seasoning', 'spice', 'dressing', 'soup', 'black pepper', 'powder', 'salt', 'marinara', 'alfredo', 'pesto', 'gravy', 'peanut butter', 'lemon juice', 'lime juice', 'ground ginger', 'tomato paste', 'egg noodle', 'mac and cheese', 'sun-dried', 'pickle', 'cinnamon', 'cumin', 'paprika', 'oregano']],
  ['Snacks & drinks', ['chips', 'cracker', 'cookie', 'snack', 'popcorn', 'pretzel', 'granola bar', 'soda', 'juice', 'drink', 'water', 'cheez', 'goldfish', 'candy']],
  ['Meat & seafood', ['chicken', 'beef', 'steak', 'pork', 'sausage', 'bacon', 'turkey', 'shrimp', 'salmon', 'fish', 'tilapia', 'cod', 'ham', 'ground', 'brisket', 'deer', 'venison', 'meatball', 'pot roast', 'chuck roast', 'kielbasa', 'hot dog', 'bratwurst']],
  ['Produce', ['coleslaw', 'lettuce', 'spinach', 'salad', 'bell pepper', 'onion', 'garlic', 'potato', 'tomato', 'broccoli', 'carrot', 'celery', 'cucumber', 'avocado', 'lemon', 'lime', 'apple', 'banana', 'berr', 'grape', 'asparagus', 'green bean', 'mushroom', 'cilantro', 'parsley', 'basil', 'zucchini', 'squash', 'cabbage', 'slaw', 'jalape', 'corn on the cob', 'kale', 'fruit', 'herb', 'ginger', 'peach', 'pineapple', 'melon', 'orange']],
  ['Dairy & eggs', ['refrigerated biscuit', 'feta', 'cotija', 'milk', 'cheese', 'butter', 'egg', 'yogurt', 'cream', 'parmesan', 'mozzarella', 'cheddar', 'provolone', 'half and half', 'crescent', 'biscuit dough']],
  ['Bakery', ['bread', 'bun', 'roll', 'tortilla', 'bagel', 'pita', 'naan', 'croissant', 'english muffin', 'baguette', 'flatbread']],
  ['Pantry', ['rice', 'pasta', 'spaghetti', 'noodle', 'macaroni', 'fettuccine', 'penne', 'bean', 'oil', 'flour', 'sugar', 'honey', 'soy', 'vinegar', 'ketchup', 'mustard', 'mayo', 'syrup', 'cereal', 'oat', 'peanut butter', 'jelly', 'corn', 'tuna', 'crouton', 'breadcrumb', 'cornstarch', 'baking']],
];

/** Which aisle an item is in, from words in its name. Canned and jarred things go to Pantry. */
export function aisleFor(name: string, unit = ''): Aisle {
  const n = name.toLowerCase();
  const shelf = ['can', 'jar', 'box', 'bottle'].includes(unit.toLowerCase());
  for (const [aisle, words] of AISLE_WORDS) {
    if (!words.some((w) => new RegExp(`\\b${w}`).test(n))) continue;
    // A can of chicken or a jar of peppers lives on the shelf, not in the fresh section.
    return shelf && (aisle === 'Produce' || aisle === 'Meat & seafood') ? 'Pantry' : aisle;
  }
  return shelf ? 'Pantry' : 'Other';
}
