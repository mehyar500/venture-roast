// functions/api/roast.js
// POST /api/roast — { image: "data:image/...;base64,..." }
// Generates a savage-but-playful roast via Workers AI (vision -> text),
// stores the full roast in D1, and returns only the first 2 lines as a teaser.

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function randomHex(bytes) {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

const VISION_PROMPT =
  "Describe this photo factually: the person's appearance, clothing, " +
  "expression, pose, setting, and any funny or notable details. Be specific " +
  "and observational, no judgment.";

const ROAST_SYSTEM =
  "You are RoastMe, a savage-but-playful roast comedian. Write 8-12 punchy " +
  "one-liner roasts about the person in the photo, based ONLY on the " +
  "description. Roast observable choices: outfit, pose, background, " +
  "expression, photo quality, lighting. NEVER mention race, ethnicity, " +
  "gender, age, disability, religion, or body weight/shape — nothing cruel " +
  "about protected traits, no slurs, no hate. Keep it funny, not " +
  "mean-spirited. End with one backhanded compliment. One roast per line, " +
  "each on its OWN line separated by a newline character — never " +
  "merge roasts into one paragraph. No numbering, no intro.";

export async function onRequestPost({ request, env }) {
  try {
    if (!env?.AI || !env?.ROAST_DB) {
      return json({ ok: false, error: "service_unavailable" }, 503);
    }

    const body = await request.json().catch(() => ({}));
    const dataUrl = String(body.image || "");
    const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!m) return json({ ok: false, error: "invalid_image" }, 400);

    // ~8MB decoded cap.
    const b64 = m[2];
    if (b64.length > 8 * 1024 * 1024 * 1.38) {
      return json({ ok: false, error: "image_too_large" }, 413);
    }
    const bin = atob(b64);
    const bytes = new Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

    // Step 1: vision model describes the photo.
    const vision = await env.AI.run("@cf/llava-hf/llava-1.5-7b-hf", {
      image: bytes,
      prompt: VISION_PROMPT,
    });
    const description =
      (vision && (vision.description || vision.response)) || "";
    if (!description) return json({ ok: false, error: "roast_failed" }, 500);

    // Step 2: text model writes the roast from the description.
    const roastRes = await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fp8", {
      messages: [
        { role: "system", content: ROAST_SYSTEM },
        {
          role: "user",
          content: "PHOTO DESCRIPTION:\n" + description + "\n\nWrite the roast.",
        },
      ],
    });
    const roastText = (roastRes && roastRes.response || "").trim();
    if (!roastText) return json({ ok: false, error: "roast_failed" }, 500);

    const lines = roastText
      .split("\n")
      .map((l) => l.replace(/^\s*[\d]+[.)]\s*/, "").trim())
      .filter(Boolean);
    if (lines.length === 0) return json({ ok: false, error: "roast_failed" }, 500);

    const teaser = lines.slice(0, 2).join("\n");
    const roastId = randomHex(16);

    await env.ROAST_DB.prepare(
      "INSERT INTO roasts (id, roast_text, teaser_text) VALUES (?, ?, ?)"
    )
      .bind(roastId, lines.join("\n"), teaser)
      .run();

    return json({ ok: true, roast_id: roastId, teaser, lines: lines.length });
  } catch (e) {
    console.error("api/roast error", e && e.message);
    return json({ ok: false, error: "roast_failed" }, 500);
  }
}
