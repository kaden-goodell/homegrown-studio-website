/**
 * A party's money as the crew see it on /staff (S2-R8: crew refund a party
 * with a reason logged under their name): each real payment with what is
 * left to refund on it, a refund still waiting on Square, and whether
 * anything is still to pay. Only our own parties; a Square-booked one has
 * none (refunded in Square).
 *
 * Server only.
 */
import { formatDay, formatTime } from '@lib/studio-time'
import { formatMoney } from '@lib/money'
import { listRefundRequests } from '@lib/classes/refund-requests'
import { PARTY_SCOPE } from '@lib/booking-core/refund-runner'
import { isOurs, type PartyCharge, type PartyRecord } from '@lib/party-store'
import { dueCents, refundableOn } from './money'
import { describePartyRequest } from './refunds'

export interface CrewPartyMoney {
  /** who the money goes back to */
  payer: string
  /** real payments (test bookings with no card left out), with what is left to refund */
  charges: { id: string; left: number; label: string }[]
  /** a refund sent to Square that never got an answer: the panel asks "did it go through?" */
  waiting: { requestId: string; cents: number; at: string; by: { id: string; name: string }; chargeId: string | null } | null
  dueCents: number
  cancelled: boolean
}

function chargeLabel(c: PartyCharge): string {
  const how = c.via === 'admin-card' ? 'Card, taken by the owners' : c.via === 'link' ? 'Paid by payment link' : 'Paid online when booked'
  return `${how} · ${formatDay(c.at)} ${formatTime(c.at)} · ${formatMoney(c.cents)}`
}

/** Null for a party booked in Square. The refund requests are read once; when they can't be, `waiting` is null. */
export async function crewPartyMoney(rec: PartyRecord): Promise<CrewPartyMoney | null> {
  if (!isOurs(rec)) return null
  let waiting: CrewPartyMoney['waiting'] = null
  try {
    const w = (await listRefundRequests(PARTY_SCOPE, rec.bookingId)).map(describePartyRequest).find((q) => q.status === 'pending' && !q.squareRefundId)
    if (w) waiting = { requestId: w.requestId, cents: w.cents, at: w.at, by: w.by, chargeId: w.chargeId }
  } catch { /* the panel still refunds; a waiting refund is caught by the server's own check */ }
  return {
    payer: rec.hostName,
    charges: (rec.charges ?? []).filter((c) => !c.simulated).map((c) => ({ id: c.id, left: refundableOn(rec, c.id), label: chargeLabel(c) })),
    waiting,
    dueCents: dueCents(rec),
    cancelled: rec.status === 'cancelled',
  }
}
