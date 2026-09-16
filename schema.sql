CREATE TABLE IF NOT EXISTS roasts (
  id TEXT PRIMARY KEY,
  roast_text TEXT NOT NULL,
  teaser_text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  unlocked INTEGER NOT NULL DEFAULT 0,
  access_token TEXT,
  mode TEXT NOT NULL DEFAULT 'savage',
  referrer_roast_id TEXT
);
CREATE TABLE IF NOT EXISTS captures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  roast_id TEXT,
  gift_email TEXT,
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
-- Funnel analytics: privacy-friendly event log, no cookies/fingerprints.
-- Events: page_view, ref_landing, upload_started, roast_requested, roast_ok,
-- roast_failed, teaser_viewed, pay_clicked, checkout_started, unlocked,
-- downloaded, shared, gift_opened, resend_requested, roast_page_view.
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event TEXT NOT NULL,
  roast_id TEXT,
  ref TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_events_event_ts ON events (event, created_at);
-- D1-backed sliding-window rate limiter (shared lib: functions/lib/rate-limit.js).
CREATE TABLE IF NOT EXISTS rate_limits (
  k TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_k_ts ON rate_limits (k, ts);
-- Local payment map (written by checkout.js): email -> token -> roast.
-- Powers unlock-link recovery (/api/resend) without depending on central schema.
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  token TEXT NOT NULL,
  roast_id TEXT,
  gift_email TEXT,
  ref TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_payments_email ON payments (email);
-- Referral attribution: who sent whom (visits tracked via ref_landing events).
CREATE TABLE IF NOT EXISTS referrals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  referrer_roast_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
