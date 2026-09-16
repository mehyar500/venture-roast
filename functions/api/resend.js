// functions/api/resend.js
// POST /api/resend — { email }
// "Lost your roast link?" — looks up the latest paid purchase for the email
// in the LOCAL payments map (written by checkout.js) and returns the unlock
// URL. Rate-limited; never reveals whether an email exists (always ok:true,
// url only when found).

import { json, EMAIL_RE, clientIp } from "../lib/respond.js";
import { rateLimitOk } from "../lib/rate-limit.js";

const UNLOCK_BASE = "https://roast.mehyar.us/?paid=1&access_token=";

export async function onRequestPost({ request, env }) {
  try {
    if (!env?.ROAST_DB) return json({ ok: false, error: "service_unavailable" }, 503);
    const ip = clientIp(request);
    if (!(await rateLimitOk(env.ROAST_DB, "resend:" + ip, 5, 3600))) {
      return json({ ok: false, error: "rate_limited" }, 429);
    }
    const body = await request.json().catch(() => ({}));
    const email = String(body.email || "").trim().toLowerCase().slice(0, 254);
    if (!EMAIL_RE.test(email)) return json({ ok: true });

    const row = await env.ROAST_DB.prepare(
      "SELECT token FROM payments WHERE email = ? ORDER BY id DESC LIMIT 1"
    )
      .bind(email)
      .first()
      .catch(() => null);

    if (row && row.token) {
      return json({ ok: true, unlock_url: UNLOCK_BASE + encodeURIComponent(row.token) });
    }
    return json({ ok: true });
  } catch (e) {
    console.error("api/resend error", e && e.message);
    return json({ ok: true });
  }
}
