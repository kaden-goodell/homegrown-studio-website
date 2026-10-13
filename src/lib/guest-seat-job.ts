/**
 * Adds an online booking's guest seats (2+) in Square, after the charge.
 *
 * The booking route takes the money for every seat on the customer's own
 * booking, then hands the guest seats to a background function
 * (netlify/functions/guest-seats-background.ts) so the customer never waits
 * on them and the booking can't time out after the charge. That function
 * calls /api/jobs/guest-seat.json once per seat, which runs `runGuestSeat`.
 *
 * Each seat is safe to run twice: what went in is remembered per seat, so a
 * retry finishes the job (settles the order) instead of adding a second guest.
 * Anything that needs a person texts the owners, saying exactly what to add.
 */
import { createHmac } from 'node:crypto'
import { issueSignedToken, readSignedToken } from '@lib/reuse-token'
import { makeKvStore } from '@lib/blob-store'
import { addOneGuestSeat, settleGuestSeatOrder, type GuestSeatParams } from '@lib/guest-seats'
import { addSquareBookingId } from '@lib/seat-choices'
import { alertOwners } from '@lib/owner-alert'
import { formatSlotLabel } from '@lib/studio-time'
import { createLogger } from '@lib/logger'

const logger = createLogger('guest-seat-job')
const kv = makeKvStore('guest-seat-jobs', 'guest-seat-jobs')
const TICKET_TTL_MS = 6 * 60 * 60 * 1000

export interface GuestSeatJob {
  scheduleId: string
  startAt: string
  className: string
  holder: { givenName: string; familyName: string; email: string }
  totalSeats: number
  /** The customer's own (paid) booking: every seat's money is on it. */
  paidBookingId: string
}
export type GuestSeatTicket = GuestSeatJob & { kind: 'guest-seats' }

export function issueGuestSeatTicket(t: GuestSeatJob): string {
  return issueSignedToken({ kind: 'guest-seats', ...t }, TICKET_TTL_MS)
}

export function readGuestSeatTicket(token: unknown): GuestSeatTicket | null {
  const t = readSignedToken<Record<string, unknown>>(token) as GuestSeatTicket | null
  return t && t.kind === 'guest-seats' ? t : null
}

/** The key the background function sends; made from a secret only the site holds. */
export function guestSeatJobKey(secret: string): string {
  return createHmac('sha256', secret).update('job:guest-seats').digest('hex')
}

export const settleLabel = (paidBookingId: string) => `Paid on booking ${paidBookingId}`

const seatKey = (t: GuestSeatTicket, seat: number) => `${t.paidBookingId}:${seat}`

function paramsOf(t: GuestSeatTicket): GuestSeatParams {
  return {
    scheduleId: t.scheduleId,
    startAt: t.startAt,
    className: t.className,
    holder: t.holder,
    totalSeats: t.totalSeats,
    what: 'Online seat',
    settleAs: settleLabel(t.paidBookingId),
  }
}

const who = (t: GuestSeatTicket) => `${t.holder.givenName} ${t.holder.familyName}`

export type GuestSeatRun = { ok: true; bookingId: string } | { ok: false; kind: string }

/** Guest seat `seat` of the ticket's booking. Texts the owners when a person is needed. */
export async function runGuestSeat(t: GuestSeatTicket, seat: number): Promise<GuestSeatRun> {
  if (!Number.isInteger(seat) || seat < 2 || seat > t.totalSeats) return { ok: false, kind: 'bad_seat' }
  const done = await kv.get(seatKey(t, seat))
  if (done) {
    const prior = JSON.parse(done) as { bookingId: string; settled: boolean }
    if (!prior.settled) {
      const settled = await settleGuestSeatOrder(t.scheduleId, prior.bookingId, null, settleLabel(t.paidBookingId))
      if (settled) await kv.set(seatKey(t, seat), JSON.stringify({ ...prior, settled }))
    }
    return { ok: true, bookingId: prior.bookingId }
  }

  const one = await addOneGuestSeat({ ...paramsOf(t), seat })
  if (!one.ok) {
    const missing = t.totalSeats - seat + 1
    await alertOwners(
      `Add ${missing} guest seat${missing === 1 ? '' : 's'} in Square by hand: ${who(t)} paid online for ${t.totalSeats} seats in ${t.className}, ${formatSlotLabel(t.startAt)}, but Square only has ${seat - 1}. In Square, Add attendee for seats ${seat}${missing > 1 ? `–${t.totalSeats}` : ''} (their money is already in, nothing to collect). (${one.stopped.kind === 'signed_out' ? 'The site’s Square sign-in has expired.' : 'Square said no.'})`,
    ).catch(() => undefined)
    return { ok: false, kind: one.stopped.kind }
  }
  await kv.set(seatKey(t, seat), JSON.stringify({ bookingId: one.bookingId, settled: one.settled }))
  await addSquareBookingId(t.scheduleId, t.paidBookingId, one.bookingId).catch(() => false)
  if (!one.settled) {
    await alertOwners(
      `Guest seat ${seat} of ${t.totalSeats} for ${who(t)} (${t.className}, ${formatSlotLabel(t.startAt)}) is in Square but shows as not paid. It is paid: the money is on their own booking. Nothing to collect.`,
    ).catch(() => undefined)
  }
  logger.info('Guest seat added', { paidBookingId: t.paidBookingId, seat, of: t.totalSeats, bookingId: one.bookingId, settled: one.settled })
  return { ok: true, bookingId: one.bookingId }
}

/**
 * Ask the background function to add seats 2..N. True when it took the job.
 * When it can't be reached, the owners are texted to add the seats by hand.
 */
export async function startGuestSeats(origin: string, ticket: string, t: GuestSeatJob, ask: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await ask(`${origin.replace(/\/$/, '')}/.netlify/functions/guest-seats-background`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket, seats: t.totalSeats }),
    })
    if (res.ok) return true
    logger.error('Guest seats job not taken', { status: res.status, paidBookingId: t.paidBookingId })
  } catch (err) {
    logger.error('Guest seats job unreachable', { error: err instanceof Error ? err.message : String(err), paidBookingId: t.paidBookingId })
  }
  const extra = t.totalSeats - 1
  await alertOwners(
    `Add ${extra} guest seat${extra === 1 ? '' : 's'} in Square by hand: ${t.holder.givenName} ${t.holder.familyName} paid online for ${t.totalSeats} seats in ${t.className}, ${formatSlotLabel(t.startAt)}, but the site couldn't add the extra seats. In Square, Add attendee (their money is already in, nothing to collect).`,
  ).catch(() => undefined)
  return false
}
