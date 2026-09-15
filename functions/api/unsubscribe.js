// functions/api/unsubscribe.js
// GET /api/unsubscribe?token=…
// One-click unsubscribe for RoastMe emails. The token is a random bearer
// minted at capture time and stored server-side (ROAST_DB.unsub_tokens),
// so no login is required. Warmup-campaign emails mint their tokens in the
// shared CENTRAL_DB.warmup_unsub_tokens table instead — both are accepted
// here. Opts out the roastme-brand row in the shared central signup store
// (email_contact) — the same store every product's signups flow into.

const BRAND = "roastme";

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function page(title, bodyHtml, status = 200) {
  return new Response(
    `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">` +
      `<meta name="viewport" content="width=device-width, initial-scale=1.0">` +
      `<title>${esc(title)} — RoastMe</title>` +
      `<style>body{background:#0d0b09;color:#f5efe6;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px;box-sizing:border-box}.box{max-width:460px;text-align:center;background:#1e1813;border:1px solid #2c241d;border-radius:16px;padding:36px 28px}.fire{font-size:44px}a{color:#ffc531}</style>` +
      `</head><body><div class="box"><div class="fire">🔥</div><h1>${esc(title)}</h1>${bodyHtml}</div></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }
  );
}

export async function onRequestGet({ request, env }) {
  try {
    if (!env?.ROAST_DB) return page("Service unavailable", "<p>Try again in a bit.</p>", 503);
    const url = new URL(request.url);
    const token = (url.searchParams.get("token") || "").trim();
    if (!token || token.length > 64) {
      return page("Invalid link", "<p>This unsubscribe link is missing or malformed.</p>", 400);
    }

    const db = env.ROAST_DB;
    const row = await db
      .prepare("SELECT email FROM unsub_tokens WHERE token = ?")
      .bind(token)
      .first()
      .catch(() => null);
    let email = row?.email ? String(row.email) : null;
    let warmupToken = false;

    // Fall back to the shared warmup token table (CENTRAL_DB) — warmup
    // campaign emails mint their tokens there so every brand shares one table.
    if (!email && env?.CENTRAL_DB) {
      const wrow = await env.CENTRAL_DB.prepare(
        "SELECT email FROM warmup_unsub_tokens WHERE token = ? AND brand = ?"
      )
        .bind(token, BRAND)
        .first()
        .catch(() => null);
      if (wrow?.email) {
        email = String(wrow.email);
        warmupToken = true;
      }
    }
    if (!email) {
      return page("Link expired", "<p>This unsubscribe link was already used or is invalid. You're probably already unsubscribed — or never were. Either way: no emails from us. 🤝</p>", 400);
    }

    // Opt out the roastme brand row in the central store.
    let centralOk = false;
    if (env?.CENTRAL_DB) {
      try {
        await env.CENTRAL_DB.prepare(
          "UPDATE email_contact SET status = 'opted_out' WHERE email = ? AND brand = ?"
        )
          .bind(email, BRAND)
          .run();
        centralOk = true;
      } catch (e) {
        console.error("api/unsubscribe central opt-out failed", e && e.message);
      }
    }

    // Burn the token — one-click links are single use.
    await db.prepare("DELETE FROM unsub_tokens WHERE token = ?").bind(token).run().catch(() => {});
    if (warmupToken && env?.CENTRAL_DB) {
      await env.CENTRAL_DB.prepare("DELETE FROM warmup_unsub_tokens WHERE token = ?")
        .bind(token)
        .run()
        .catch(() => {});
    }

    return page(
      "You're unsubscribed",
      `<p><strong>${esc(email)}</strong> won't get RoastMe emails anymore.</p>` +
        (centralOk ? "" : "<p>(Central list update was skipped — contact support if emails continue.)</p>") +
        `<p><a href="https://roast.mehyar.us/">← Back to RoastMe</a></p>`
    );
  } catch (e) {
    console.error("api/unsubscribe error", e && e.message);
    return page("Something broke", "<p>Try again in a bit.</p>", 500);
  }
}
