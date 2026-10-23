-- Optional Dessert and Snack meals. A week gets their slots only when someone taps "Add dessert" or "Add snack recipe".
UPDATE settings SET value = json_insert(value, '$[#]', 'Dessert')
WHERE key = 'categories' AND NOT EXISTS (SELECT 1 FROM json_each(settings.value) WHERE json_each.value = 'Dessert');
UPDATE settings SET value = json_insert(value, '$[#]', 'Snack')
WHERE key = 'categories' AND NOT EXISTS (SELECT 1 FROM json_each(settings.value) WHERE json_each.value = 'Snack');
