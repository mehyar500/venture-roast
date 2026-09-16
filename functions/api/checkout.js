// functions/api/checkout.js
// POST /api/checkout — { email, roast_id, ref?, test? }
// Server-to-server forward to the CENTRALIZED Stripe checkout on mehyar.us
// (POST https://mehyar.us/api/pay/checkout). Keeps the Stripe session secret
// server-side and records the returned access token against the roast.
//
// Protections: D1 sliding-window rate limits (10/hr/IP, 3/hr/email) so the
// endpoint can't be used to spam Stripe session creation.
// Also records a local (email -> token -> roast) mapping in `payments` so
// unlock-link recovery (/api/resend) never depends on central schema details.

import { json, EMAIL_RE, clientIp } from "../lib/respond.js";
import { rateLimitOk } from "../lib/rate-limit.js";

async function ensurePaymentsTable(db) {
  await db
    .prepare(
      "CREATE TABLE IF NOT EXISTS payments (" +
        "id INTEGER PRIMARY KEY AUTOINCREMENT, " +
        "email TEXT NOT NULL, token TEXT NOT NULL, roast_id TEXT, " +
        "gift_email TEXT, ref TEXT, " +
        "created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))"
    )
    .run();
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env?.ROAST_DB) return json({ ok: false, error: "service_unavailable" }, 503);
    const ip = clientIp(request);
    if (!(await rateLimitOk(env.ROAST_DB, "checkout:ip:" + ip, 10, 3600))) {
      return json({ ok: false, error: "rate_limited" }, 429);
    }

    const body = await request.json().catch(() => ({}));
    const email = String(body.email || "").trim().toLowerCase().slice(0, 254);
    const roastId = String(body.roast_id || "").slice(0, 64);
    const ref = String(body.ref || "").slice(0, 64) || null;
    const giftEmail = String(body.gift_email || "").trim().toLowerCase().slice(0, 254) || null;
    if (!EMAIL_RE.test(email)) return json({ ok: false, error: "invalid_email" }, 400);
    if (giftEmail && !EMAIL_RE.test(giftEmail)) {
      return json({ ok: false, error: "invalid_gift_email" }, 400);
    }
    if (!roastId) return json({ ok: false, error: "invalid_roast" }, 400);

    if (!(await rateLimitOk(env.ROAST_DB, "checkout:email:" + email, 3, 3600))) {
      return json({ ok: false, error: "rate_limited" }, 429);
    }

    const payload = {
      product_id: env.PRODUCT_ID || "roast-card",
      email,
      params: { roast_id: roastId },
    };
    if (ref) payload.params.ref = ref;
    if (giftEmail) payload.params.gift_email = giftEmail;
    if (body.test === true) payload.test = true;

    const resp = await fetch(env.CHECKOUT_API || "https://mehyar.us/api/pay/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000),
    });
    const data = await resp.json().catch(() => ({}));

    if (!resp.ok || !data.ok || !data.checkout_url) {
      console.error("api/checkout central checkout failed", data && data.error);
      return json({ ok: false, error: "checkout_failed" }, 502);
    }

    const token = String(data.token || "");
    await env.ROAST_DB.prepare(
      "UPDATE roasts SET access_token = ? WHERE id = ?"
    )
      .bind(token, roastId)
      .run();

    // Local payment mapping for link recovery + referral attribution.
    await ensurePaymentsTable(env.ROAST_DB);
    await env.ROAST_DB.prepare(
      "INSERT INTO payments (email, token, roast_id, gift_email, ref) VALUES (?, ?, ?, ?, ?)"
    )
      .bind(email, token, roastId, giftEmail, ref)
      .run()
      .catch((e) => console.error("api/checkout payment map failed", e && e.message));

    // Referral attribution: credit the roast page that sent this buyer.
    if (ref) {
      await env.ROAST_DB.prepare(
        "UPDATE roasts SET referrer_roast_id = ? WHERE id = ?"
      )
        .bind(ref, roastId)
        .run()
        .catch(() => {});
      await env.ROAST_DB.prepare(
        "CREATE TABLE IF NOT EXISTS referrals (" +
          "id INTEGER PRIMARY KEY AUTOINCREMENT, referrer_roast_id TEXT NOT NULL, " +
          "kind TEXT NOT NULL, " +
          "created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))"
      ).run().catch(() => {});
      await env.ROAST_DB.prepare(
        "INSERT INTO referrals (referrer_roast_id, kind) VALUES (?, 'purchase')"
      )
        .bind(ref)
        .run()
        .catch(() => {});
    }

    return json({ ok: true, checkout_url: data.checkout_url, token });
  } catch (e) {
    console.error("api/checkout error", e && e.message);
    return json({ ok: false, error: "checkout_failed" }, 500);
  }
}
