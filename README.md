# RoastMe 🔥

**Upload a photo. Get destroyed. (Lovingly.)**

RoastMe is a $5 one-time impulse product: the user uploads a photo, Workers AI
writes a savage-but-playful roast, and the full roast is delivered as a
beautiful shareable image card.

Live: **https://roast.mehyar.us** · Repo: `mehyar500/venture-roast`

## The funnel

```
landing page
  → upload photo → POST /api/roast (Workers AI: llava vision → llama roast)
  → teaser card: photo + first 2 lines sharp, rest blurred + watermarked
  → email capture → POST /api/capture (D1)
  → $5 checkout → POST /api/checkout → centralized Stripe (mehyar.us/api/pay/checkout)
  → Stripe success → /?paid=1&access_token=…
  → GET /api/unlock → verifies billing_payments='paid' → full roast text
  → full HD share card + PNG download (client-side canvas render)
```

## API contracts

| Endpoint | Method | Body / Query | Returns |
|---|---|---|---|
| `/api/roast` | POST | `{ image: "data:image/…;base64,…" }` (≤ ~8MB) | `{ ok, roast_id, teaser, lines }` |
| `/api/capture` | POST | `{ email, roast_id }` | `{ ok: true }` |
| `/api/checkout` | POST | `{ email, roast_id, test? }` | `{ ok, checkout_url, token }` |
| `/api/unlock` | GET | `?token=` | `{ ok, roast_text, roast_id }` or 402 `{ ok:false, error:"not_paid" }` |

Product row in the shared `billing_products` table: `roast-card` ($5.00,
fulfillment `none`, success template `https://roast.mehyar.us/?paid=1&access_token={access_token}`).

## Stack

- **Hosting:** Cloudflare Pages project `venture-roast` (static `public/` + Pages Functions)
- **AI:** Workers AI `[[ai]]` binding — `@cf/llava-hf/llava-1.5-7b-hf` for the photo description, `@cf/meta/llama-3.1-8b-instruct` for the roast
- **Data:** D1 `roast_mvp` (`roasts`, `captures` — see `schema.sql`); read-only binding on `mehyar_leads_prod` for payment verification
- **Payments:** centralized Stripe checkout on mehyar.us — no Stripe keys here

## Local dev

```bash
npx wrangler pages dev public --d1 ROAST_DB=roast_mvp
# D1 schema: wrangler d1 execute roast_mvp --file schema.sql
```

## Deploy

Push to `main` → GitHub Actions (`.github/workflows/deploy.yml`) runs
`wrangler pages deploy public --project-name=venture-roast`. The committed
`wrangler.toml` `[vars]` is the complete authoritative var set (nothing secret
in it), so unlike mehyar-web no temp-toml injection is needed. Required repo
secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.

## Safety note

Roast prompts are engineered to target **choices** (outfit, pose, background,
expression, photo quality) — never protected traits. The system prompt
explicitly forbids mentions of race, ethnicity, gender, age, disability,
religion, or body weight/shape, plus slurs and hate. See `functions/api/roast.js`.
