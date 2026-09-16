// functions/lib/verify-payment.js — shared paid-status check (not a route).
// Product is env-driven (env.PRODUCT_ID) so adding SKU #2 needs no code change.

/**
 * Returns { payment, roastId } when the token maps to a paid billing_payments
 * row for the configured product, or null otherwise.
 */
export async function verifyPayment(env, token) {
  if (!env?.BILLING_DB || !token || token.length > 128) return null;
  const productId = env.PRODUCT_ID || "roast-card";
  const payment = await env.BILLING_DB.prepare(
    "SELECT status, metadata_json FROM billing_payments " +
      "WHERE access_token = ? AND product_id = ? " +
      "ORDER BY id DESC LIMIT 1"
  )
    .bind(token, productId)
    .first()
    .catch(() => null);
  if (!payment || payment.status !== "paid") return null;
  let roastId = null;
  try {
    roastId = (JSON.parse(payment.metadata_json || "{}") || {}).roast_id || null;
  } catch {
    /* ignore */
  }
  if (!roastId) return null;
  return { payment, roastId };
}
