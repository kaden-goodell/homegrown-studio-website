/**
 * D2: the signed token in a class booking's "Can't make it?" link
 * (/classes/cancel/<classId>.<bookingId>.<mac>). It holds no state, so it
 * works from any old confirmation; the page re-reads the booking each time.
 * HMAC with the site's signing secret (LOOKUP_SIGNING_SECRET). Server only.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { signingSecret } from '@lib/reuse-token'

export const CANCEL_PAGE = '/classes/cancel/'

const mac = (payload: string) => createHmac('sha256', signingSecret()).update(`class-cancel:${payload}`).digest('base64url').slice(0, 22)
const ID = /^[A-Za-z0-9_-]{4,80}$/

/** The token in a booking's "Can't make it?" link. Ids never hold a dot. */
export function cancelToken(classId: string, bookingId: string): string {
  return `${classId}.${bookingId}.${mac(`${classId}.${bookingId}`)}`
}

export function cancelPathFor(classId: string, bookingId: string): string {
  return `${CANCEL_PAGE}${cancelToken(classId, bookingId)}`
}

/** The class and booking a token names, or null for anything not signed by us (a wrong token and a missing booking look the same). */
export function readCancelToken(raw: unknown): { classId: string; bookingId: string } | null {
  if (typeof raw !== 'string' || raw.length > 220) return null
  const [classId, bookingId, sig, extra] = raw.split('.')
  if (extra !== undefined || !classId || !bookingId || !sig || !ID.test(classId) || !ID.test(bookingId)) return null
  const want = Buffer.from(mac(`${classId}.${bookingId}`))
  const got = Buffer.from(sig)
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null
  return { classId, bookingId }
}
