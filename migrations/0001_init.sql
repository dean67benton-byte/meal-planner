-- Meal planner schema. Every statement is safe to re-run.

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL -- JSON
);

CREATE TABLE IF NOT EXISTS meals (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Dinner',
  protein TEXT NOT NULL DEFAULT '',
  cook TEXT NOT NULL DEFAULT 'Either',       -- Dean | Kinley | Either
  servings INTEGER,
  prep_min INTEGER,
  cook_min INTEGER,
  repeat_days INTEGER,                       -- null = use settings default
  recipe TEXT NOT NULL DEFAULT '',           -- link and/or steps
  notes TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual',     -- manual | idea | ai | instagram
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS meal_ingredients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meal_id TEXT NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  qty REAL,
  unit TEXT NOT NULL DEFAULT 'each',
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS meal_ingredients_meal ON meal_ingredients(meal_id);

-- One row per ingredient (name + unit), like the sheet's Prices & Pantry.
CREATE TABLE IF NOT EXISTS pantry_items (
  key TEXT PRIMARY KEY,                      -- lower(name) | lower(unit)
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  store TEXT NOT NULL DEFAULT 'Kroger',
  price REAL,                                -- per unit
  staple INTEGER NOT NULL DEFAULT 0,
  restock INTEGER NOT NULL DEFAULT 0,
  on_hand REAL NOT NULL DEFAULT 0,
  kroger_upc TEXT,
  kroger_desc TEXT
);

CREATE TABLE IF NOT EXISTS weeks (
  week_of TEXT PRIMARY KEY,                  -- Sunday, YYYY-MM-DD
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS week_slots (
  week_of TEXT NOT NULL,
  slot INTEGER NOT NULL,
  label TEXT NOT NULL,
  category TEXT NOT NULL,
  meal_id TEXT,
  locked INTEGER NOT NULL DEFAULT 0,
  cook TEXT,                                 -- who is cooking this slot
  skipped TEXT NOT NULL DEFAULT '[]',        -- JSON meal ids rerolled away
  eaten_date TEXT,
  PRIMARY KEY (week_of, slot)
);

CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  meal_id TEXT,
  meal_name TEXT NOT NULL,
  week_of TEXT,
  slot INTEGER,
  cook TEXT,
  added_by TEXT
);
CREATE INDEX IF NOT EXISTS history_meal ON history(meal_id);

CREATE TABLE IF NOT EXISTS grocery_checks (
  week_of TEXT NOT NULL,
  key TEXT NOT NULL,
  bought INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (week_of, key)
);

-- Kroger OAuth state and tokens (single household account).
CREATE TABLE IF NOT EXISTS kroger (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  expires_at INTEGER
);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('slots', '[{"label":"Dinner 1","category":"Dinner"},{"label":"Dinner 2","category":"Dinner"},{"label":"Dinner 3","category":"Dinner"},{"label":"Work Lunch","category":"Work Lunch"}]'),
  ('repeat_days', '21'),
  ('categories', '["Dinner","Work Lunch"]'),
  ('proteins', '["Chicken","Beef / Deer","Pork","Seafood","Vegetarian","Other"]'),
  ('stores', '["Kroger","Costco","Other"]'),
  ('units', '["each","lb","oz","cup","tbsp","tsp","can","jar","pkg","bag","box","bunch","clove","slice","dozen","qt","gal","g","ml","pint","bottle","head"]'),
  ('cooks', '["Dean","Kinley"]');
