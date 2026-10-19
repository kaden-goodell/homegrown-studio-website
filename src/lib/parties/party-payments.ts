/**
 * Which party a Square payment belongs to: kv `party-payments`, key
 * `pay-<paymentId>` → `{ partyId, chargeId }`. Written once when a charge is
 * recorded (create-only; a payment never moves to another party), read when
 * Square tells us about a refund on a payment (Task 10).
 *
 * A read failure throws: never "not a party". Server only.
 */
import { makeKvStore } from '@lib/blob-store'
import { createLogger } from '@lib/logger'

const logger = createLogger('party-payments')
const kv = makeKvStore('party-payments', 'party-payments')
const key = (paymentId: string) => `pay-${paymentId}`

export interface PartyPaymentEntry { partyId: string; chargeId: string }

/**
 * created: written now. exists: already there for this party and charge (a
 * retry). refused: the payment is already another party's (or charge's); the
 * stored entry comes back and is kept.
 */
export async function recordPartyPayment(
  paymentId: string, partyId: string, chargeId: string,
): Promise<{ kind: 'created' | 'exists' | 'refused'; entry: PartyPaymentEntry }> {
  const entry: PartyPaymentEntry = { partyId, chargeId }
  if (await kv.setIfMatch(key(paymentId), JSON.stringify(entry), null, false)) return { kind: 'created', entry }
  const stored = await partyForPayment(paymentId)
  if (!stored) throw new Error('Party payment write lost a race but nothing is stored')
  if (stored.partyId === partyId && stored.chargeId === chargeId) return { kind: 'exists', entry: stored }
  logger.error('Payment already belongs to another party', { paymentId, stored, wanted: entry })
  return { kind: 'refused', entry: stored }
}

export async function partyForPayment(paymentId: string): Promise<PartyPaymentEntry | null> {
  const json = await kv.get(key(paymentId))
  return json ? (JSON.parse(json) as PartyPaymentEntry) : null
}
