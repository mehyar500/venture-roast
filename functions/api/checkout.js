// functions/api/checkout.js
// POST /api/checkout — { email, roast_id, test? }
// Server-to-server forward to the CENTRALIZED Stripe checkout on mehyar.us
// (POST https://mehyar.us/api/pay/checkout). Keeps the Stripe session secret
// server-side and records the returned access token against the roast.

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function onRequestPost({ request, env }) {
  try {
    if (!env?.ROAST_DB) return json({ ok: false, error: "service_unavailable" }, 503);
    const body = await request.json().catch(() => ({}));
    const email = String(body.email || "").trim().toLowerCase().slice(0, 254);
    const roastId = String(body.roast_id || "").slice(0, 64);
    if (!EMAIL_RE.test(email)) return json({ ok: false, error: "invalid_email" }, 400);
    if (!roastId) return json({ ok: false, error: "invalid_roast" }, 400);

    const payload = {
      product_id: env.PRODUCT_ID || "roast-card",
      email,
      params: { roast_id: roastId },
    };
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

    await env.ROAST_DB.prepare(
      "UPDATE roasts SET access_token = ? WHERE id = ?"
    )
      .bind(String(data.token || ""), roastId)
      .run();

    return json({ ok: true, checkout_url: data.checkout_url, token: data.token });
  } catch (e) {
    console.error("api/checkout error", e && e.message);
    return json({ ok: false, error: "checkout_failed" }, 500);
  }
}
