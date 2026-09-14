// functions/api/unlock.js
// GET /api/unlock?token= — verifies the Stripe payment via the shared
// billing_payments table (BILLING_DB binding on mehyar_leads_prod) and
// returns the full roast text once the payment is marked 'paid'.

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function onRequestGet({ request, env }) {
  try {
    if (!env?.ROAST_DB || !env?.BILLING_DB) {
      return json({ ok: false, error: "service_unavailable" }, 503);
    }
    const token = new URL(request.url).searchParams.get("token") || "";
    if (!token || token.length > 128) return json({ ok: false, error: "not_paid" }, 402);

    const payment = await env.BILLING_DB.prepare(
      "SELECT status, metadata_json FROM billing_payments " +
        "WHERE access_token = ? AND product_id = 'roast-card' " +
        "ORDER BY id DESC LIMIT 1"
    )
      .bind(token)
      .first();

    if (!payment || payment.status !== "paid") {
      return json({ ok: false, error: "not_paid" }, 402);
    }

    let roastId = null;
    try {
      roastId = (JSON.parse(payment.metadata_json || "{}") || {}).roast_id || null;
    } catch {
      /* ignore */
    }
    if (!roastId) return json({ ok: false, error: "not_paid" }, 402);

    const roast = await env.ROAST_DB.prepare(
      "SELECT roast_text FROM roasts WHERE id = ?"
    )
      .bind(roastId)
      .first();
    if (!roast) return json({ ok: false, error: "not_paid" }, 402);

    await env.ROAST_DB.prepare("UPDATE roasts SET unlocked = 1 WHERE id = ?")
      .bind(roastId)
      .run();

    return json({ ok: true, roast_text: roast.roast_text, roast_id: roastId });
  } catch (e) {
    console.error("api/unlock error", e && e.message);
    return json({ ok: false, error: "not_paid" }, 402);
  }
}
