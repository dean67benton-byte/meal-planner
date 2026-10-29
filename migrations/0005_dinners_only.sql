-- Work Lunch is gone: its meals become dinners, and the week is just dinners (3 by default, changed per week on Week).
UPDATE meals SET category = 'Dinner' WHERE category = 'Work Lunch';

UPDATE settings SET value = (
  SELECT json_group_array(json_each.value) FROM json_each(settings.value) WHERE json_each.value <> 'Work Lunch'
) WHERE key = 'categories';

UPDATE settings SET value = (
  SELECT json_group_array(json(json_each.value)) FROM json_each(settings.value)
  WHERE json_extract(json_each.value, '$.category') <> 'Work Lunch'
) WHERE key = 'slots';

-- Weeks already planned keep the meal: the lunch slot becomes one more dinner.
UPDATE week_slots SET category = 'Dinner', label = 'Dinner ' || (slot + 1) WHERE category = 'Work Lunch';
