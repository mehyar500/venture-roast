// functions/lib/rate-limit.js — D1-backed sliding-window rate limiter (not a route).
// Survives isolate restarts (unlike the old in-memory Map in capture.js).
// Lazily creates its table so no separate migration step is required.

async function ensureTable(db) {
  await db
    .prepare(
      "CREATE TABLE IF NOT EXISTS rate_limits (k TEXT NOT NULL, ts INTEGER NOT NULL)"
    )
    .run();
  await db
    .prepare(
      "CREATE INDEX IF NOT EXISTS idx_rate_limits_k_ts ON rate_limits (k, ts)"
    )
    .run();
}

/**
 * Returns true if the call is allowed (and records it), false if over limit.
 * @param {D1Database} db
 * @param {string} key  e.g. "roast:1.2.3.4"
 * @param {number} limit  max calls per window
 * @param {number} windowSec  window length in seconds
 */
export async function rateLimitOk(db, key, limit, windowSec) {
  try {
    await ensureTable(db);
    const now = Date.now();
    const cutoff = now - windowSec * 1000;
    // Opportunistic cleanup of expired rows (cheap, indexed).
    await db.prepare("DELETE FROM rate_limits WHERE ts < ?").bind(cutoff).run();
    const row = await db
      .prepare("SELECT COUNT(*) AS n FROM rate_limits WHERE k = ? AND ts >= ?")
      .bind(key, cutoff)
      .first();
    if (row && row.n >= limit) return false;
    await db.prepare("INSERT INTO rate_limits (k, ts) VALUES (?, ?)").bind(key, now).run();
    return true;
  } catch (e) {
    // Fail open on DB errors so a limiter outage never takes down the product.
    console.error("rate-limit error", e && e.message);
    return true;
  }
}
