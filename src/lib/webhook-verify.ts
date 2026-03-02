import { createHmac } from 'node:crypto'

/**
 * Verifies a Square webhook signature using HMAC-SHA256.
 *
 * Square sends the signature in the `x-square-hmacsha256-signature` header.
 * The HMAC is computed over: webhookUrl + body, using the webhook signature key.
 *
 * @see https://developer.squareup.com/docs/webhooks/step3validate
 */
export function verifySquareSignature(
  body: string,
  signature: string,
  signatureKey: string,
  webhookUrl: string
): boolean {
  if (!signature || !signatureKey) return false

  const hmac = createHmac('sha256', signatureKey)
    .update(webhookUrl + body)
    .digest('base64')

  return hmac === signature
}
