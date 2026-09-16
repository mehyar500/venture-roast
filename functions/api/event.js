// functions/api/event.js
// POST /api/event — { event, roast_id?, ref? }
// Privacy-friendly funnel analytics. No cookies, no fingerprinting — just
// counts of funnel steps so we can see where the $5 funnel leaks.
// Events: page_view, ref_landing, upload_started, roast_requested, roast_ok,
// roast_failed, teaser_viewed, pay_clicked, checkout_started, unlocked,
// downloaded, shared, gift_opened, resend_requested, roast_page_view.

import { json, clientIp } from "../lib/respond.js";
import { rateLimitOk } from "../lib/rate-limit.js";

const ALLOWED = new Set([
  "page_view", "ref_landing", "upload_started", "roast_requested",
  "roast_ok", "roast_failed", "teaser_viewed", "pay_clicked",
  "checkout_started", "unlocked", "downloaded", "shared",
  "gift_opened", "resend_requested", "roast_page_view",
]);

async function ensureTable(db) {
  await db
    .prepare(
      "CREATE TABLE IF NOT EXISTS events (" +
        "id INTEGER PRIMARY KEY AUTOINCREMENT, event TEXT NOT NULL, " +
        "roast_id TEXT, ref TEXT, ip TEXT, " +
        "created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))"
    )
    .run();
  await db
    .prepare("CREATE INDEX IF NOT EXISTS idx_events_event_ts ON events (event, created_at)")
    .run();
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env?.ROAST_DB) return json({ ok: false, error: "service_unavailable" }, 503);
    const ip = clientIp(request);
    // Generous: analytics must never break the product UX.
    if (!(await rateLimitOk(env.ROAST_DB, "event:" + ip, 200, 3600))) {
      return json({ ok: false, error: "rate_limited" }, 429);
    }
    const body = await request.json().catch(() => ({}));
    const event = String(body.event || "").slice(0, 40);
    if (!ALLOWED.has(event)) return json({ ok: false, error: "bad_event" }, 400);
    const roastId = String(body.roast_id || "").slice(0, 64) || null;
    const ref = String(body.ref || "").slice(0, 64) || null;

    await ensureTable(env.ROAST_DB);
    await env.ROAST_DB.prepare(
      "INSERT INTO events (event, roast_id, ref, ip) VALUES (?, ?, ?, ?)"
    )
      .bind(event, roastId, ref, ip === "unknown" ? null : ip)
      .run()
      .catch(() => {});
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: "event_failed" }, 500);
  }
}
