// functions/api/capture.js
// POST /api/capture — { email, roast_id?, gift_email? }
// Stores the email capture locally AND in the shared central signup store
// (email_contact in the mehyar-jobs D1, brand='roastme'), so every RoastMe
// signup is queryable alongside every other product's signups.
// Returns { ok:true, unsub_url } — the unsub URL must accompany every
// RoastMe email that references this capture.
//
// Protections: D1 sliding-window rate limit (10/15min/IP — survives isolate
// restarts, unlike the old in-memory Map), duplicate suppression, and a
// throwaway-domain blocklist for list quality.

import { json, EMAIL_RE, clientIp } from "../lib/respond.js";
import { rateLimitOk } from "../lib/rate-limit.js";

const BRAND = "roastme";
const UNSUB_BASE = "https://roast.mehyar.us/api/unsubscribe";

// Common throwaway domains — keep the list short; exact-match on the domain part.
const THROWAWAY = new Set([
  "mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com",
  "throwawaymail.com", "fakeinbox.com", "getnada.com", "yopmail.com",
  "temp-mail.org", "sharklasers.com",
]);

async function ensureTables(db) {
  await db
    .prepare(
      "CREATE TABLE IF NOT EXISTS captures (" +
        "id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, roast_id TEXT, " +
        "gift_email TEXT, " +
        "created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))"
    )
    .run();
  await db
    .prepare(
      "CREATE TABLE IF NOT EXISTS unsub_tokens (token TEXT PRIMARY KEY, email TEXT NOT NULL, " +
        "created_at TEXT NOT NULL DEFAULT (datetime('now')))"
    )
    .run();
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env?.ROAST_DB) return json({ ok: false, error: "service_unavailable" }, 503);
    const ip = clientIp(request);
    if (!(await rateLimitOk(env.ROAST_DB, "capture:" + ip, 10, 900))) {
      return json({ ok: false, error: "rate_limited" }, 429);
    }

    const body = await request.json().catch(() => ({}));
    const email = String(body.email || "").trim().toLowerCase().slice(0, 254);
    const roastId = String(body.roast_id || "").slice(0, 64);
    const giftEmail = String(body.gift_email || "").trim().toLowerCase().slice(0, 254) || null;
    if (!EMAIL_RE.test(email)) return json({ ok: false, error: "invalid_email" }, 400);
    if (THROWAWAY.has(email.split("@")[1] || "")) {
      return json({ ok: false, error: "disposable_email" }, 400);
    }
    if (giftEmail && !EMAIL_RE.test(giftEmail)) {
      return json({ ok: false, error: "invalid_gift_email" }, 400);
    }

    const db = env.ROAST_DB;
    await ensureTables(db);

    // Duplicate suppression: one capture row per email (latest roast wins).
    const existing = await db
      .prepare("SELECT id FROM captures WHERE email = ? LIMIT 1")
      .bind(email)
      .first()
      .catch(() => null);
    if (existing) {
      await db
        .prepare("UPDATE captures SET roast_id = ?, gift_email = ? WHERE id = ?")
        .bind(roastId || null, giftEmail, existing.id)
        .run()
        .catch(() => {});
    } else {
      await db
        .prepare("INSERT INTO captures (email, roast_id, gift_email) VALUES (?, ?, ?)")
        .bind(email, roastId || null, giftEmail)
        .run()
        .catch((e) => console.error("api/capture local insert failed", e && e.message));
    }

    // One-click unsubscribe token (random bearer, stored server-side).
    const token = crypto.randomUUID();
    await db
      .prepare("INSERT OR REPLACE INTO unsub_tokens (token, email) VALUES (?, ?)")
      .bind(token, email)
      .run()
      .catch((e) => console.error("api/capture token store failed", e && e.message));

    // Central signup store: best-effort, never blocks the product flow.
    let central = false;
    if (env?.CENTRAL_DB) {
      try {
        await env.CENTRAL_DB.prepare(
          "INSERT OR IGNORE INTO email_contact (email, brand, status, source) VALUES (?, ?, 'pending', 'web')"
        )
          .bind(email, BRAND)
          .run();
        central = true;
      } catch (e) {
        console.error("api/capture central store write failed", e && e.message);
      }
    } else {
      console.error("api/capture CENTRAL_DB binding missing");
    }

    return json({ ok: true, central, unsub_url: `${UNSUB_BASE}?token=${token}` });
  } catch (e) {
    console.error("api/capture error", e && e.message);
    return json({ ok: false, error: "capture_failed" }, 500);
  }
}
