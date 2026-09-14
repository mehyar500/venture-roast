// functions/api/capture.js
// POST /api/capture — { email, roast_id } — stores the email capture in D1.

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

    await env.ROAST_DB.prepare(
      "INSERT INTO captures (email, roast_id) VALUES (?, ?)"
    )
      .bind(email, roastId || null)
      .run();

    return json({ ok: true });
  } catch (e) {
    console.error("api/capture error", e && e.message);
    return json({ ok: false, error: "capture_failed" }, 500);
  }
}
