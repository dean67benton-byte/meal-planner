// Shapes shared by the app and the worker API.

export type Cook = 'Dean' | 'Kinley' | 'Either';

export interface Ingredient {
  name: string;
  qty: number | null;
  unit: string;
}

export interface Meal {
  id: string;
  name: string;
  category: string;
  protein: string;
  cook: Cook;
  servings: number | null;
  prep_min: number | null;
  cook_min: number | null;
  repeat_days: number | null;
  recipe: string;
  notes: string;
  source: string;
  style: string; // Mexican, Italian, … ('' = work it out from the name)
  archived: number;
  created_at: string;
  ingredients: Ingredient[];
}

export interface PantryItem {
  key: string;
  name: string;
  unit: string;
  store: string;
  price: number | null;
  staple: number;
  restock: number;
  on_hand: number;
  kroger_upc: string | null;
  kroger_desc: string | null;
  snack: number;
}

export interface SlotConfig {
  label: string;
  category: string;
}

/** A side on a dinner. */
export interface SidePick {
  id: string;
  locked: number;
  skipped: string[];
}

/** A snack on this week's list; `key` is the pantry item. */
export interface SnackPick {
  key: string;
  qty: number;
  locked: number;
  skipped: string[];
}

export interface SidePair {
  meal_id: string;
  side_id: string;
  kept: number;
  skipped: number;
}

export interface Slot extends SlotConfig {
  week_of: string;
  slot: number;
  meal_id: string | null;
  locked: number;
  cook: string | null;
  skipped: string[];
  eaten_date: string | null;
  sides: SidePick[];
}

/** A video link saved on the Import screen for Claude to turn into a meal. */
export interface ImportLink {
  id: number;
  url: string;
  note: string;
  added_by: string;
  created_at: string;
}

export interface HistoryRow {
  id: number;
  date: string;
  meal_id: string | null;
  meal_name: string;
  week_of: string | null;
  slot: number | null;
  cook: string | null;
  added_by: string | null;
}

export interface Settings {
  slots: SlotConfig[];
  repeat_days: number;
  categories: string[];
  proteins: string[];
  stores: string[];
  units: string[];
  cooks: string[];
  styles: string[];
}

export interface AppState {
  settings: Settings;
  meals: Meal[];
  pantry: PantryItem[];
  week_of: string;
  slots: Slot[];
  last_eaten: Record<string, string>;
  history: HistoryRow[];
  checks: Record<string, number>;
  snacks: SnackPick[];
  /** Last week's snack list, for "Same as last week". */
  prev_snacks: SnackPick[];
  /** How many past weeks each snack was locked in. */
  snack_counts: Record<string, number>;
  side_pairs: SidePair[];
  features: { ai: boolean; kroger: boolean };
}

/** A recipe proposed by the AI or the idea bank, before it is saved. */
export interface MealDraft {
  name: string;
  category: string;
  protein: string;
  cook: Cook;
  servings: number | null;
  prep_min: number | null;
  cook_min: number | null;
  recipe: string;
  notes: string;
  source: string;
  style?: string;
  ingredients: Ingredient[];
}

export interface KrogerStatus {
  configured: boolean;
  connected: boolean;
  location_id: string | null;
  location_name: string | null;
}

export interface KrogerProduct {
  upc: string;
  description: string;
  brand: string;
  size: string;
  price: number | null;
  image: string | null;
}

export interface KrogerDeal {
  term: string; // the staple it was found under, e.g. "chicken breast"
  upc: string;
  description: string;
  size: string;
  regular: number;
  promo: number;
}

/** Today's price for a matched product; `promo` is 0 when it isn't on sale. */
export interface KrogerPrice {
  upc: string;
  regular: number;
  promo: number;
}

export const itemKey = (name: string, unit: string) =>
  `${name.trim().toLowerCase()} | ${unit.trim().toLowerCase()}`;
