import { createHmac, timingSafeEqual } from 'node:crypto'

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

  // Use timing-safe comparison to prevent timing oracle attacks
  const expected = Buffer.from(hmac, 'utf8')
  const actual = Buffer.from(signature, 'utf8')

  if (expected.length !== actual.length) return false

  return timingSafeEqual(expected, actual)
}
