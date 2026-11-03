/**
 * Final concurrency review I-5: a booking paid onto a class an owner cancelled
 * while the customer was between the seat hold and the charge. The cancel's
 * "who's booked" list was read before this seat was confirmed, so nobody
 * would know. The booking route re-reads the class after confirming and, if
 * it was cancelled meanwhile, keeps one entry here (create-only, one per
 * booking), texts the owners, and /admin › To decide shows it with
 * Refund them / It's already sorted. Never refunds by itself (house rule).
 */
import { makeKvStore } from '@lib/blob-store'
import type { Cents } from './types'

export interface PaidOnCancelled {
  id: string
  classId: string
  className: string
  bookingId: string
  orderId: string | null
  paymentId: string | null
  chargedCents: Cents
  customer: { givenName: string; familyName: string; email: string; phone: string }
  last4: string
  at: string
}

const kv = makeKvStore('paid-on-cancelled', 'paid-on-cancelled')
const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '_')
export const paidOnCancelledId = (classId: string, bookingId: string) => `poc-${safe(classId)}-${safe(bookingId)}`

/** Keeps it once. True only for the call that wrote it (that one texts the owners). */
export async function notePaidOnCancelled(e: Omit<PaidOnCancelled, 'id'>): Promise<boolean> {
  const id = paidOnCancelledId(e.classId, e.bookingId)
  return kv.setIfMatch(id, JSON.stringify({ ...e, id }), null, false)
}

export async function listPaidOnCancelled(): Promise<PaidOnCancelled[]> {
  const keys = (await kv.list('poc-')).filter((k) => k.startsWith('poc-'))
  const docs = await Promise.all(keys.map((k) => kv.get(k)))
  return docs.flatMap((d) => (d ? [JSON.parse(d) as PaidOnCancelled] : []))
}
