// functions/api/capture.js
// POST /api/capture — { email, roast_id? }
// Stores the email capture locally AND in the shared central signup store
// (email_contact in the mehyar-jobs D1, brand='roastme'), so every RoastMe
// signup is queryable alongside every other product's signups.
// Returns { ok:true, unsub_url } — the unsub URL must accompany every
// RoastMe email that references this capture.

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BRAND = "roastme";
const UNSUB_BASE = "https://roast.mehyar.us/api/unsubscribe";

// Cheap in-memory rate limit: 10 captures / 15 min / IP (per isolate).
const RL = new Map();
function rateLimitOk(ip) {
  const now = Date.now();
  const arr = (RL.get(ip) || []).filter((ts) => now - ts < 15 * 60 * 1000);
  if (arr.length >= 10) return false;
  arr.push(now);
  RL.set(ip, arr);
  return true;
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env?.ROAST_DB) return json({ ok: false, error: "service_unavailable" }, 503);
    const ip = request.headers.get("cf-connecting-ip") || "unknown";
    if (!rateLimitOk(ip)) return json({ ok: false, error: "rate_limited" }, 429);

    const body = await request.json().catch(() => ({}));
    const email = String(body.email || "").trim().toLowerCase().slice(0, 254);
    const roastId = String(body.roast_id || "").slice(0, 64);
    if (!EMAIL_RE.test(email)) return json({ ok: false, error: "invalid_email" }, 400);

    const db = env.ROAST_DB;

    // Local product capture (unchanged behavior).
    await db
      .prepare("INSERT INTO captures (email, roast_id) VALUES (?, ?)")
      .bind(email, roastId || null)
      .run()
      .catch((e) => console.error("api/capture local insert failed", e && e.message));

    // One-click unsubscribe token (random bearer, stored server-side).
    await db
      .prepare(
        "CREATE TABLE IF NOT EXISTS unsub_tokens (token TEXT PRIMARY KEY, email TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))"
      )
      .run()
      .catch(() => {});
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
