# RoastMe — Stripe wiring

All payments run through the **centralized checkout** on `mehyar-web`
(`https://mehyar.us/api/pay/checkout`). RoastMe never touches card data.

## Product

| field | value |
|---|---|
| `product_id` | `roast-card` |
| brand | `RoastMe` |
| price | $5.00 (`price_cents = 500`, from DB — never from the client) |
| fulfillment | `none` (unlock is verified server-side against the ledger) |
| success URL | `https://roast.mehyar.us/?paid=1&access_token={access_token}` |
| cancel URL | `https://roast.mehyar.us/?canceled=1` |

Seeded in D1 `mehyar_leads_prod.billing_products` (2026-09-14).

## Flow

1. `POST /api/checkout` (roast.mehyar.us) → forwards
   `{product_id: "roast-card", email, params: {roast_id}, test?}` to the
   centralized checkout. Returns `{checkout_url, token}`.
   - `test: true` → uses `STRIPE_TEST_SECRET_KEY` (session `cs_test_…`)
   - omitted → uses `STRIPE_SECRET_KEY` (session `cs_live_…`)
2. Buyer pays on Stripe → redirect to `?paid=1&access_token=…`
3. App calls `GET /api/unlock?token=…` → verifies the `billing_payments`
   row is `status='paid'` for that token → returns the full roast text.
4. Stripe webhook `checkout.session.completed` → `POST
   https://mehyar.us/api/pay/webhook` marks the row paid (signature-verified).

## Webhook endpoints (Stripe dashboard)

| mode | endpoint id | URL | signing secret env (mehyar-web) |
|---|---|---|---|
| test | `we_1UFibf4NaXpNyV6yLNtqmBuY` | `https://mehyar.us/api/pay/webhook` | `STRIPE_WEBHOOK_SECRET_TEST2` |
| live | *(created 2026-09-14, id TBD)* | `https://mehyar.us/api/pay/webhook` | `STRIPE_WEBHOOK_SECRET_LIVE2` |

Events subscribed: `checkout.session.completed` only.

The legacy live endpoint (`we_1UFfQw8y1yiOc3KfrNdr3Y4n` →
`/api/audit/full-report/webhook`, secret `STRIPE_WEBHOOK_SECRET`) is
untouched. The new live endpoint gets its **own** signing secret because
Stripe issues one secret per endpoint — never reuse or overwrite
`STRIPE_WEBHOOK_SECRET`.

`functions/api/pay/webhook.js` verifies against
`[STRIPE_WEBHOOK_SECRET, STRIPE_WEBHOOK_SECRET_LIVE2,
STRIPE_WEBHOOK_SECRET_TEST, STRIPE_WEBHOOK_SECRET_TEST2]`.

## Deploying secret changes (mehyar-web)

New webhook secrets go in as **GitHub Actions secrets** on
`mehyar-us/mehyar-web` (e.g. `STRIPE_WEBHOOK_SECRET_LIVE2`), mapped in
`.github/workflows/deploy-cloudflare-pages.yml` into `[vars]`, then deployed
via the workflow. Never `wrangler pages deploy` from the repo — it wipes
dashboard-only vars. Never add via the Cloudflare dashboard alone — the
next Actions deploy would wipe it.
