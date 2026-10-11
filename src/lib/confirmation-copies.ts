/**
 * A copy of each booking's confirmation email, exactly as sent, so a booker
 * who mistyped their email can have the same email sent to the right address
 * (src/pages/api/booking/fix-email.json.ts) without rebuilding it.
 *
 * Netlify Blobs in prod, `.data/confirmation-copies/` on disk in dev.
 */
import { makeKvStore } from '@lib/blob-store'
import { createLogger } from '@lib/logger'

const logger = createLogger('confirmation-copies')
const kv = makeKvStore('confirmation-copies', 'confirmation-copies')

export type BookingKind = 'workshop' | 'party'

export interface ConfirmationMessage {
  subject: string
  html: string
  text: string
  attachments?: { filename: string; content: string; contentType: string }[]
}

export interface ConfirmationCopy extends ConfirmationMessage {
  kind: BookingKind
  bookingId: string
  /** Every address it has been sent to, oldest first. */
  sentTo: string[]
  at: string
}

const key = (kind: BookingKind, bookingId: string) => `${kind}-${bookingId}`

/** Never throws: a copy we couldn't keep must not fail a paid booking. */
export async function keepConfirmationCopy(kind: BookingKind, bookingId: string, message: ConfirmationMessage, sentTo: string[]): Promise<void> {
  try {
    const copy: ConfirmationCopy = { kind, bookingId, ...message, sentTo, at: new Date().toISOString() }
    await kv.set(key(kind, bookingId), JSON.stringify(copy))
  } catch (err) {
    logger.error('Could not keep a copy of the confirmation (booking unaffected)', { kind, bookingId, error: err instanceof Error ? err.message : String(err) })
  }
}

export async function getConfirmationCopy(kind: BookingKind, bookingId: string): Promise<ConfirmationCopy | null> {
  const raw = await kv.get(key(kind, bookingId))
  return raw ? (JSON.parse(raw) as ConfirmationCopy) : null
}

export async function noteResent(copy: ConfirmationCopy, to: string): Promise<void> {
  await kv.set(key(copy.kind, copy.bookingId), JSON.stringify({ ...copy, sentTo: [...copy.sentTo, to] }))
}
