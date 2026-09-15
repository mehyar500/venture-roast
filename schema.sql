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
-- One-click unsubscribe tokens (random bearers, single use). Created at
-- capture time; the emailed link hits /api/unsubscribe?token=… which opts
-- the address out of the central email_contact store (brand='roastme').
CREATE TABLE IF NOT EXISTS unsub_tokens (
  token TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
