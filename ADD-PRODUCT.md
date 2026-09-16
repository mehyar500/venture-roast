# Adding a product to RoastMe (runbook)

RoastMe has exactly one product today (`roast-card`, $5) but is built to hold
many. Adding product #2 must not touch payment logic, billing verification, or
webhook handling. This runbook is the whole checklist.

## Product model

| SKU | Type | Price | Fulfills |
|---|---|---|---|
| `roast-card` | base | $5 | full roast card + share card + PNG |
| `roast-style` | add-on | $3 | re-roast the same photo in another style |
| `roast-pack-5` | pack | $20 | 5 roast credits (replaces single-card checkout) |
| `roast-gift` | gift | $5 | roast card sent to someone else's email |
| `roast-group` | group | $15 | roast up to 4 people from one photo |

SKUs live in the CENTRALIZED Stripe catalog on mehyar.us
(`billing_payments.product_id`). RoastMe never creates Stripe products.

## Checklist for a new product

1. **Create the SKU in Stripe** (dashboard or central script) and set the
   D1 row: `billing_payments.product_id = '<sku>'` must match.
2. **Frontend:** call `/api/checkout` with the product in the request:
   `POST /api/checkout { email, roast_id, product_id: '<sku>', ... }`
   (default `product_id` = `env.PRODUCT_ID` = `roast-card`).
3. **Unlock:** `/api/unlock` verifies via `functions/lib/verify-payment.js`,
   which reads `env.PRODUCT_ID || "roast-card"` — pass the new SKU in the
   env map (`PRODUCT_ID` can also be sent per-request in the checkout payload
   `params.product_id`; verify-payment falls back to env, then 'roast-card').
4. **Fulfillment:** add a branch in the central fulfillment table
   (`fulfillment` registry on mehyar.us) keyed by `product_id`.
5. **Tests:** add the SKU to `scripts/qa.sh` (see step 7 of this repo's QA
   list) — checkout create + unlock verify, no real charge.

## What you never touch

- `functions/lib/verify-payment.js` — shared billing verification.
- `functions/api/brevo-webhook.js` — central event mapping.
- `schema.sql` — product-agnostic by design.

## Env vars (Cloudflare Pages dashboard, `venture-roast`)

| Var | Kind | Notes |
|---|---|---|
| `PRODUCT_ID` | plain_text | Default SKU for this Pages project. |
| `CHECKOUT_API` | plain_text | Central checkout endpoint (mehyar.us). |
| `BRAND_NAME` | plain_text | "RoastMe" — used in fulfillment emails. |
| `BREVO_WEBHOOK_KEY` | **secret_text** | HMAC key for the Brevo webhook. Survives deploys because it is secret_text; `wrangler pages deploy` only REPLACES plain_text `[vars]`. Never convert to plain_text. |
| `STRIPE_*` | — | Not on this project — Stripe lives on mehyar.us (central checkout). |

## Deploy

```
cd ~/workspace/build/roast-mvp
python3 deploy.py
```

`deploy.py` stages a clean copy and runs `wrangler pages deploy`. It does NOT
touch env vars, so `BREVO_WEBHOOK_KEY` is never disturbed. After deploy,
verify: upload → teaser, checkout create (test mode), unlock with a test
token, `/r/<id>` page, security headers on `/`.
