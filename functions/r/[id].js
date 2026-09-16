// functions/r/[id].js
// GET /r/<roast_id> — public roast page. Only unlocked (paid) roasts get one.
// Every shared card links here, turning each share into a landing page and
// each roast into indexable content. Roast text is HTML-escaped (AI-generated).

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function page({ roastId, lines, mode, found }) {
  const modeLabel = { savage: "Savage", playful: "Playful", shakespeare: "Shakespeare", ramsay: "Ramsay", genz: "Gen-Z" }[mode] || "Savage";
  const firstTwo = lines.slice(0, 2).join(" ");
  const ogDesc = found
    ? esc(firstTwo.slice(0, 200)) + " — see the full burn on RoastMe."
    : "Upload a funny photo. Get destroyed. (Lovingly.) First 2 lines free — full roast $5.";
  const cardHtml = found
    ? lines.map((l) => `<p class="rl">${esc(l)}</p>`).join("\n")
    : `<p class="rl">This roast has gone cold — but yours doesn't have to.</p>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${found ? "🔥 I got roasted on RoastMe" : "RoastMe — AI Roast Generator"}</title>
<meta name="description" content="${ogDesc}">
<link rel="canonical" href="https://roast.mehyar.us/r/${esc(roastId)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="RoastMe">
<meta property="og:title" content="🔥 I got roasted on RoastMe">
<meta property="og:description" content="${ogDesc}">
<meta property="og:url" content="https://roast.mehyar.us/r/${esc(roastId)}">
<meta property="og:image" content="https://roast.mehyar.us/og-card.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="RoastMe roast card">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="🔥 I got roasted on RoastMe">
<meta name="twitter:description" content="${ogDesc}">
<meta name="twitter:image" content="https://roast.mehyar.us/og-card.jpg">
<meta name="twitter:image:alt" content="RoastMe roast card">
<meta name="theme-color" content="#0d0b09">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0d0b09;color:#f5efe6;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:32px 16px}
.brand{font-weight:900;letter-spacing:2px;color:#ffc531;font-size:20px;margin-bottom:20px}
.brand span{color:#f5efe6}
.card{background:linear-gradient(180deg,#241a12,#14100c);border:1px solid #3a2c1e;border-radius:16px;max-width:640px;width:100%;padding:28px;box-shadow:0 20px 60px rgba(0,0,0,.5)}
.card .cb{font-weight:900;color:#ffc531;letter-spacing:1px;margin-bottom:14px;font-size:14px}
.rl{font-size:19px;line-height:1.55;margin-bottom:12px}
.rl:first-of-type{font-size:22px}
.meta{margin-top:16px;font-size:13px;color:#a89c8c}
.cta{margin-top:26px;text-align:center}
.cta a{display:inline-block;background:#ffc531;color:#1a120a;font-weight:900;font-size:19px;padding:15px 34px;border-radius:12px;text-decoration:none}
.cta p{margin-top:12px;color:#a89c8c;font-size:14px}
.foot{margin-top:auto;padding-top:40px;color:#6b5f52;font-size:12px}
</style>
</head>
<body>
<div class="brand">🔥 ROAST<span>ME</span></div>
<article class="card">
<div class="cb">🔥 ROASTME ${found ? "• " + esc(modeLabel).toUpperCase() + " MODE" : ""}</div>
${cardHtml}
<div class="meta">roast.mehyar.us/r/${esc(roastId)} — share the burn</div>
</article>
<div class="cta">
<a href="https://roast.mehyar.us/">🔥 Roast yourself — $5</a>
<p>First 2 lines free. Zero mercy. 60 seconds, photo to roast.</p>
</div>
<p class="foot">Playful roasts only. © 2026 MehyarSoft</p>
</body>
</html>`;
}

export async function onRequestGet({ request, env, params }) {
  const roastId = String((params && params.id) || "").slice(0, 64);
  let roast = null;
  if (roastId && env?.ROAST_DB) {
    roast = await env.ROAST_DB.prepare(
      "SELECT roast_text, mode FROM roasts WHERE id = ? AND unlocked = 1"
    )
      .bind(roastId)
      .first()
      .catch(() => null);
  }
  const found = !!(roast && roast.roast_text);
  const lines = found ? String(roast.roast_text).split("\n").filter(Boolean) : [];

  // Count the view (best-effort).
  if (found && env?.ROAST_DB) {
    env.ROAST_DB.prepare(
      "INSERT INTO events (event, roast_id) VALUES ('roast_page_view', ?)"
    )
      .bind(roastId)
      .run()
      .catch(() => {});
  }

  const html = page({ roastId, lines, mode: (roast && roast.mode) || "savage", found });
  return new Response(html, {
    status: found ? 200 : 404,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": found ? "public, max-age=3600" : "no-store",
      "X-Frame-Options": "DENY",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    },
  });
}
