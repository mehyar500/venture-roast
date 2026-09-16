// functions/api/unlock.js
// GET /api/unlock?token= — verifies the Stripe payment via the shared
// billing_payments table (BILLING_DB binding on mehyar_leads_prod) and
// returns the full roast text once the payment is marked 'paid'.
// Product is env-driven (env.PRODUCT_ID) — see functions/lib/verify-payment.js.

import { json } from "../lib/respond.js";
import { verifyPayment } from "../lib/verify-payment.js";

export async function onRequestGet({ request, env }) {
  try {
    if (!env?.ROAST_DB || !env?.BILLING_DB) {
      return json({ ok: false, error: "service_unavailable" }, 503);
    }
    const token = new URL(request.url).searchParams.get("token") || "";
    const verified = await verifyPayment(env, token);
    if (!verified) return json({ ok: false, error: "not_paid" }, 402);

    const roast = await env.ROAST_DB.prepare(
      "SELECT roast_text, mode FROM roasts WHERE id = ?"
    )
      .bind(verified.roastId)
      .first();
    if (!roast) return json({ ok: false, error: "not_paid" }, 402);

    await env.ROAST_DB.prepare("UPDATE roasts SET unlocked = 1 WHERE id = ?")
      .bind(verified.roastId)
      .run();

    return json({
      ok: true,
      roast_text: roast.roast_text,
      roast_id: verified.roastId,
      mode: roast.mode || "savage",
    });
  } catch (e) {
    console.error("api/unlock error", e && e.message);
    return json({ ok: false, error: "not_paid" }, 402);
  }
}
