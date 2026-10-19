/**
 * What a party of ours owes, has paid and can still refund, worked out from
 * its record. Pure and browser-safe.
 *
 * - due: items not yet paid (chargeId null) on a booked party; a cancelled
 *   party owes nothing (its charges stay refundable).
 * - paid: what Square took (charges) less refunds.
 * - A refund never changes what was bought, so it never changes the state.
 */
import type { Cents } from './types'
import type { PartyRecord } from '../party-store'

const sum = (xs: { cents: Cents }[] | undefined) => (xs ?? []).reduce((t, x) => t + x.cents, 0)

export function dueCents(r: PartyRecord): Cents {
  if (r.status === 'cancelled') return 0
  return sum((r.items ?? []).filter((it) => it.chargeId === null))
}

export function paidCents(r: PartyRecord): Cents {
  return sum(r.charges) - sum(r.refunds)
}

/** What can still go back on one charge (one Square payment, S2-R25). Never below 0. */
export function refundableOn(r: PartyRecord, chargeId: string): Cents {
  const charge = (r.charges ?? []).find((c) => c.id === chargeId)
  if (!charge) return 0
  return Math.max(0, charge.cents - sum((r.refunds ?? []).filter((f) => f.chargeId === chargeId)))
}

export function paymentState(r: PartyRecord): 'paid' | 'waiting' | 'partly' | 'legacy' | 'cancelled' {
  if (r.source !== 'ours') return 'legacy'
  if (r.status === 'cancelled') return 'cancelled'
  if (dueCents(r) === 0) return 'paid'
  return (r.items ?? []).some((it) => it.chargeId !== null) ? 'partly' : 'waiting'
}

/**
 * One payment at a time (a link payment and an owner's card, or two browsers
 * on the link). Another attempt still inside its time → busy; the same attempt
 * (a retry) goes through and its time starts again. Returns a new record.
 */
export function claimPaying(
  r: PartyRecord, attemptId: string, now: Date, ttlMinutes: number,
): { ok: true; rec: PartyRecord } | { ok: false; reason: 'busy' } {
  const p = r.paying
  if (p && p.attemptId !== attemptId && Date.parse(p.until) > now.getTime()) return { ok: false, reason: 'busy' }
  return { ok: true, rec: { ...r, paying: { attemptId, until: new Date(now.getTime() + ttlMinutes * 60_000).toISOString() } } }
}
