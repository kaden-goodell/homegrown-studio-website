/**
 * Guest seats: who sits in a booker's extra seats.
 *
 * A booking for 2+ seats carries one name (the booker). A friend who signs her
 * own agreement matches no booking by name, email or phone, so the door card
 * said "No seat on record" and staff could wrongly sell or comp her a seat.
 *
 * Two ways tie her household to the booking:
 *  - the guest link in the booker's confirmation (/waiver?workshop=…&guest=…),
 *    a signed token scoped to one class and one booking;
 *  - one tap at check-in ("With Shelby Taylor · 1 seat open").
 *
 * This is ONLY a link between a waiver household and a seat already booked.
 * It never changes money, seats or Square. One document per class (the class
 * schedule id for Square-era classes, the cls_ id for ours).
 *
 * A booking's guests fill seats 2…N in the order they were attached; anyone
 * past seats − 1 still shows as the booker's guest but with no seat, so staff
 * notice.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { signingSecret } from '@lib/reuse-token'
import { makeKvStore } from '@lib/blob-store'
import { CAS_ATTEMPTS, casPause } from '@lib/cas-retry'
import { createLogger } from '@lib/logger'
import type { By } from '@lib/staff-auth'
import type { SeatChoiceRecord } from '@lib/seat-choices'

const logger = createLogger('guest-links')
const kv = makeKvStore('guest-links', 'guest-links')

// ── The guest link ───────────────────────────────────────────────────────────

const ID = /^[A-Za-z0-9_-]{4,80}$/
const mac = (eventId: string, bookingId: string) =>
  createHmac('sha256', signingSecret()).update(`guest-seat:workshop:${eventId}:${bookingId}`).digest('base64url').slice(0, 24)

/** `<bookingId>.<signature>`: the class id is in the link beside it and inside the signature. */
export function guestToken(eventId: string, bookingId: string): string {
  return `${bookingId}.${mac(eventId, bookingId)}`
}

/** The booking a guest token names for THIS class, or null for anything we didn't sign. */
export function readGuestToken(eventId: string, raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 200 || !ID.test(eventId)) return null
  const [bookingId, sig, extra] = raw.split('.')
  if (extra !== undefined || !bookingId || !sig || !ID.test(bookingId)) return null
  const want = Buffer.from(mac(eventId, bookingId))
  const got = Buffer.from(sig)
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null
  return bookingId
}

/**
 * The page a guest signs on. Deliberately NOT the booker's own link
 * (`&booking=`): a guest signing there would count as the booker having
 * signed (the 9 AM waiver reminder reads it that way).
 */
export function guestWaiverPath(eventId: string, bookingId: string): string {
  return `/waiver?workshop=${encodeURIComponent(eventId)}&guest=${encodeURIComponent(guestToken(eventId, bookingId))}`
}

/**
 * The confirmation's guest link, for a booking with 2+ seats; nothing for one
 * seat, or when it can't be signed (it never stops a confirmation).
 */
export function guestLinkFor(origin: string, eventId: string, bookingId: string, seats: number): { guestWaiverUrl?: string } {
  if (seats < 2 || !ID.test(eventId) || !ID.test(bookingId)) return {}
  try {
    return { guestWaiverUrl: `${origin}${guestWaiverPath(eventId, bookingId)}` }
  } catch (err) {
    logger.error('Guest link not made', { eventId, bookingId, error: err instanceof Error ? err.message : String(err) })
    return {}
  }
}

// ── The stored links ─────────────────────────────────────────────────────────

export interface GuestLink {
  /** the guest's waiver record id (the roster household) */
  recordId: string
  bookingId: string
  at: string
  /** 'link': signed through the guest link; 'staff': matched at check-in */
  via: 'link' | 'staff'
  /** the staff member who matched them (null for the guest link) */
  by: By | null
}

interface GuestDoc { links: GuestLink[] }

const docKey = (eventId: string) => `guests-workshop-${eventId}`
const parse = (json: string | null): GuestDoc => {
  if (!json) return { links: [] }
  try {
    const d = JSON.parse(json) as GuestDoc
    return { links: Array.isArray(d?.links) ? d.links : [] }
  } catch {
    return { links: [] }
  }
}

export async function listGuestLinks(eventId: string): Promise<GuestLink[]> {
  return parse(await kv.get(docKey(eventId))).links
}

async function mutate(eventId: string, change: (links: GuestLink[]) => GuestLink[] | null): Promise<GuestLink[]> {
  const k = docKey(eventId)
  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
    await casPause(attempt)
    const { value, etag } = await kv.getWithMeta(k)
    const before = parse(value).links
    const after = change(before)
    if (after === null) return before
    if (await kv.setIfMatch(k, JSON.stringify({ links: after }), etag, value !== null)) return after
  }
  throw new Error('Concurrent update — please retry')
}

/**
 * Ties a household to a booking's seat. The same household on the same
 * booking again changes nothing (keeps its first time, so seat order holds).
 * On another booking it moves: one household is one booking's guest.
 */
export async function attachGuest(input: { eventId: string; bookingId: string; recordId: string; via: GuestLink['via']; by: By | null }): Promise<GuestLink> {
  const fresh: GuestLink = { recordId: input.recordId, bookingId: input.bookingId, at: new Date().toISOString(), via: input.via, by: input.by }
  const links = await mutate(input.eventId, (links) => {
    const had = links.find((l) => l.recordId === input.recordId)
    if (had && had.bookingId === input.bookingId) return null
    return [...links.filter((l) => l.recordId !== input.recordId), fresh]
  })
  logger.info('Guest attached', { eventId: input.eventId, bookingId: input.bookingId, via: input.via })
  return links.find((l) => l.recordId === input.recordId) ?? fresh
}

/** Takes a household off whatever booking it was a guest of. False when it wasn't one. */
export async function detachGuest(eventId: string, recordId: string): Promise<boolean> {
  let removed = false
  await mutate(eventId, (links) => {
    if (!links.some((l) => l.recordId === recordId)) return null
    removed = true
    return links.filter((l) => l.recordId !== recordId)
  })
  return removed
}

// ── What the roster shows ────────────────────────────────────────────────────

export interface GuestOf {
  bookingId: string
  bookerName: string
  /** 2…N, or null when the booking's guest seats were already taken */
  seat: number | null
  /** the booking's seats */
  of: number
}

export interface GuestMatch {
  bookingId: string
  bookerName: string
  /** guest seats nobody is in yet */
  open: number
}

export interface GuestSeatView {
  /** waiver record id → whose guest they are */
  guestOf: Record<string, GuestOf>
  /** bookings in this event (this day) with a guest seat still open, for "Are they someone's guest?" */
  matches: GuestMatch[]
  /** lower-cased booker email → the seated guests' names, counted against the booker's seats */
  guestsByEmail: Record<string, string[]>
}

const norm = (s: string) => s.trim().toLowerCase()
const bookerNameOf = (r: SeatChoiceRecord) => `${r.customer.givenName} ${r.customer.familyName}`.trim()

/**
 * One event-day's guests. Seat 1 is always the booker's (signed or not); each
 * booking offers seats − 1 guest seats. Pure: the roster and the attach route
 * share it, so the button and the check agree.
 */
export function guestSeatView(
  records: SeatChoiceRecord[],
  households: { recordId: string; email: string; signer: string }[],
  links: GuestLink[],
): GuestSeatView {
  const byRecord = new Map(households.map((h) => [h.recordId, h]))
  const guestOf: GuestSeatView['guestOf'] = {}
  const guestsByEmail: GuestSeatView['guestsByEmail'] = {}
  const matches: GuestMatch[] = []

  for (const r of records) {
    const bookerEmail = norm(r.customer.email)
    // A counter sale with no name yet has its own "Who is it?"; it is no one's to be a guest of.
    if (!bookerEmail) continue
    const bookerName = bookerNameOf(r)
    const mine = links
      .filter((l) => l.bookingId === r.bookingId)
      // The booker opening her own guest link is still the booker.
      .filter((l) => norm(byRecord.get(l.recordId)?.email ?? '') !== bookerEmail)
      .sort((a, b) => a.at.localeCompare(b.at))
    const guestSeats = Math.max(0, r.seats - 1)
    mine.forEach((l, i) => {
      const seated = i < guestSeats
      guestOf[l.recordId] = { bookingId: r.bookingId, bookerName, seat: seated ? i + 2 : null, of: r.seats }
      if (seated) {
        const name = byRecord.get(l.recordId)?.signer ?? ''
        guestsByEmail[bookerEmail] = [...(guestsByEmail[bookerEmail] ?? []), name]
      }
    })
    const open = guestSeats - Math.min(mine.length, guestSeats)
    if (open > 0) matches.push({ bookingId: r.bookingId, bookerName, open })
  }
  return { guestOf, matches, guestsByEmail }
}
