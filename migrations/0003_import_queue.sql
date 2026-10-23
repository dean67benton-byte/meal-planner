-- Video links saved from the Import screen. Claude watches each one, adds the meal, and deletes the row.
CREATE TABLE IF NOT EXISTS import_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  added_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
