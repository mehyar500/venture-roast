CREATE TABLE IF NOT EXISTS roasts (
  id TEXT PRIMARY KEY,
  roast_text TEXT NOT NULL,
  teaser_text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  unlocked INTEGER NOT NULL DEFAULT 0,
  access_token TEXT
);
CREATE TABLE IF NOT EXISTS captures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  roast_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
