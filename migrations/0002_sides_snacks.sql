-- Sides for dinners and a weekly snack list.

-- Sides are meals with category 'Side'. Style (Mexican, Italian, …) helps pair them before there's any history.
ALTER TABLE meals ADD COLUMN style TEXT NOT NULL DEFAULT '';

-- Each dinner's sides: JSON [{ "id": meal id, "locked": 0|1, "skipped": [meal ids] }].
ALTER TABLE week_slots ADD COLUMN sides TEXT NOT NULL DEFAULT '[]';

-- The week's snacks: JSON [{ "key": pantry key, "qty": n, "locked": 0|1, "skipped": [keys] }].
ALTER TABLE weeks ADD COLUMN snacks TEXT NOT NULL DEFAULT '[]';

-- Snacks are products in the pantry list, flagged so they show up as snacks.
ALTER TABLE pantry_items ADD COLUMN snack INTEGER NOT NULL DEFAULT 0;

-- How often a side was kept with a meal (locked in) or rerolled away from it.
CREATE TABLE IF NOT EXISTS side_pairs (
  meal_id TEXT NOT NULL,
  side_id TEXT NOT NULL,
  kept INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (meal_id, side_id)
);

UPDATE settings SET value = json_insert(value, '$[#]', 'Side')
WHERE key = 'categories' AND NOT EXISTS (SELECT 1 FROM json_each(settings.value) WHERE json_each.value = 'Side');

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('styles', '["American","BBQ","Mexican","Italian","Asian","Breakfast"]');

-- Starter snacks with rough Kroger prices; edit or delete them in the app.
INSERT OR IGNORE INTO pantry_items (key, name, unit, store, price) VALUES
  ('doritos | bag', 'Doritos', 'bag', 'Kroger', 5.29),
  ('kettle chips | bag', 'Kettle chips', 'bag', 'Kroger', 4.49),
  ('cheez-it | box', 'Cheez-It', 'box', 'Kroger', 5.49),
  ('goldfish | bag', 'Goldfish', 'bag', 'Kroger', 3.29),
  ('tortilla chips | bag', 'Tortilla chips', 'bag', 'Kroger', 3.49),
  ('salsa | jar', 'Salsa', 'jar', 'Kroger', 3.29),
  ('candy | bag', 'Candy', 'bag', 'Kroger', 4.29),
  ('ice cream | each', 'Ice cream', 'each', 'Kroger', 4.99);
UPDATE pantry_items SET snack = 1 WHERE key IN
  ('doritos | bag', 'kettle chips | bag', 'cheez-it | box', 'goldfish | bag', 'tortilla chips | bag', 'salsa | jar', 'candy | bag', 'ice cream | each');
