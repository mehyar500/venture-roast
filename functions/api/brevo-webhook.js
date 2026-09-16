// functions/api/brevo-webhook.js
// POST /api/brevo-webhook?key=… — Brevo event webhook for the RoastMe
// email warmup campaign. Brevo POSTs one JSON event per request
// (or an array of them). We map message-id -> warmup_campaign_sends and
// keep opened/clicked/bounced statuses current; unsubscribe + complaint
// events also flip the roastme-brand email_contact row to opted_out.
//
// Auth: ?key= must equal the BREVO_WEBHOOK_KEY worker secret.

const BRAND = "roastme";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function sameKey(a, b) {
  a = String(a || "");
  b = String(b || "");
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const nowIso = () => new Date().toISOString();

async function applyEvent(env, ev) {
  const event = String(ev.event || "").toLowerCase();
  const messageId = ev["message-id"] || ev.messageId || ev.message_id || null;
  const email = (ev.email || "").toString().trim().toLowerCase();
  if (!messageId && !email) return { skipped: true };

  // Find the send row: prefer message-id, fall back to latest queued/sent row for the email.
  let row = null;
  if (messageId) {
    row = await env.CENTRAL_DB.prepare(
      "SELECT id, recipient_email, status FROM warmup_campaign_sends WHERE message_id = ? AND brand = ? ORDER BY id DESC LIMIT 1"
    )
      .bind(String(messageId), BRAND)
      .first()
      .catch(() => null);
  }
  if (!row && email) {
    row = await env.CENTRAL_DB.prepare(
      "SELECT id, recipient_email, status FROM warmup_campaign_sends WHERE recipient_email = ? AND brand = ? ORDER BY id DESC LIMIT 1"
    )
      .bind(email, BRAND)
      .first()
      .catch(() => null);
  }
  if (!row) return { skipped: true, reason: "no_match" };

  const t = nowIso();
  const sets = [];
  const binds = [];
  const setStatus = (s) => {
    sets.push("status = ?");
    binds.push(s);
  };

  switch (event) {
    case "delivered":
      if (row.status === "sent" || row.status === "queued") setStatus("delivered");
      break;
    case "opened":
      sets.push("opened_at = COALESCE(opened_at, ?)");
      binds.push(t);
      if (row.status === "sent" || row.status === "delivered" || row.status === "queued") setStatus("opened");
      break;
    case "click":
    case "clicked":
      sets.push("clicked_at = COALESCE(clicked_at, ?)");
      binds.push(t);
      setStatus("clicked");
      break;
    case "deferred":
      // Transient — the receiving server asked us to retry later. Track it
      // separately so it never inflates bounce stats.
      sets.push("status = ?");
      binds.push("deferred");
      break;
    case "hard_bounce":
    case "hardbounce":
    case "soft_bounce":
    case "softbounce":
    case "bounce":
    case "blocked":
    case "invalid_email":
    case "invalid":
    case "error":
      sets.push("bounced_at = COALESCE(bounced_at, ?)");
      binds.push(t);
      setStatus("bounced");
      break;
    case "complaint":
    case "spam":
      setStatus("complaint");
      break;
    case "unsubscribed":
    case "unsub":
      setStatus("unsubscribed");
      break;
    default:
      return { skipped: true, reason: "unknown_event:" + event };
  }

  if (sets.length) {
    binds.push(row.id);
    await env.CENTRAL_DB.prepare(
      `UPDATE warmup_campaign_sends SET ${sets.join(", ")} WHERE id = ?`
    )
      .bind(...binds)
      .run();
  }

  // Complaints and unsubscribes suppress the contact centrally — never mail them again.
  if (event === "complaint" || event === "spam" || event === "unsubscribed" || event === "unsub") {
    const target = row.recipient_email || email;
    if (target) {
      await env.CENTRAL_DB.prepare(
        "UPDATE email_contact SET status = 'opted_out' WHERE email = ? AND brand = ?"
      )
        .bind(String(target).toLowerCase(), BRAND)
        .run()
        .catch(() => {});
    }
  }

  return { ok: true, event, row: row.id };
}

export async function onRequestPost({ request, env }) {
  try {
    const url = new URL(request.url);
    if (!sameKey(url.searchParams.get("key"), env?.BREVO_WEBHOOK_KEY)) {
      return json({ ok: false, error: "unauthorized" }, 401);
    }
    if (!env?.CENTRAL_DB) return json({ ok: false, error: "service_unavailable" }, 503);

    const body = await request.json().catch(() => null);
    if (!body) return json({ ok: false, error: "bad_payload" }, 400);
    const events = Array.isArray(body) ? body : [body];

    const results = [];
    for (const ev of events.slice(0, 100)) {
      try {
        results.push(await applyEvent(env, ev || {}));
      } catch (e) {
        results.push({ error: String((e && e.message) || e).slice(0, 120) });
      }
    }
    return json({ ok: true, processed: results.length, results });
  } catch (e) {
    console.error("api/brevo-webhook error", e && e.message);
    return json({ ok: false, error: "internal" }, 500);
  }
}

// Non-POST methods are rejected so scanners can't fake events via GET.
export async function onRequestGet() {
  return json({ ok: false, error: "method_not_allowed" }, 405);
}
