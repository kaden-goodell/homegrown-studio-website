/**
 * Charge on the reader (stage 4 Task 11, R16): the pure parts.
 *
 * At the door the crew (or Catherine) take a seat's money on the Square card
 * reader through Square's Point of Sale app. Our server prices the seat and
 * builds the app link (`square-commerce-v1://payment/create?data=…`, Square's
 * POS API web flow for iOS) with the exact amount, a note naming the booking,
 * class, day and person, and a signed state token. The app takes the card and
 * comes back to /staff/pos-return with Square's answer in `?data=`. Nothing is
 * marked paid from that answer alone: the server reads the order from Square
 * and checks it (see checkReaderOrder) first.
 *
 * Everything here is pure (no store, no network), so it can be tested to the
 * letter. The HMAC needs node:crypto, so it is server only.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Cents } from './types'

/** How long a seat is held while the crew are in the Square app. */
export const READER_HOLD_MINUTES = 30
/** A payment Square took offline (the iPad lost wifi): the seat stays held while Square finishes it. */
export const READER_OFFLINE_HOLD_HOURS = 24
/** A signed state is good for this long: a return older than that is refused (Check again still works). */
export const READER_STATE_TTL_MS = 24 * 3_600_000
/** A reader sale with no answer for this long shows in /admin › To decide with Ask Square. */
export const READER_DECIDE_AFTER_MS = 15 * 60_000
/** Orders made this long before the sale started can't be its payment (clock slack between us and Square). */
export const READER_CLOCK_SLACK_MS = 5 * 60_000
/** The POS API caps the note at 500 characters. */
export const READER_NOTE_MAX = 500
/** The POS API version this link is written for. */
export const POS_API_VERSION = '1.3'
/** What the reader takes (OWNER-S4-9): card and Square gift card. Cash stays "Pay at the counter". */
export const READER_TENDERS = ['CREDIT_CARD', 'SQUARE_GIFT_CARD'] as const
/** The same, as Square writes them on the order's tenders. */
export const READER_ORDER_TENDERS = new Set(['CARD', 'SQUARE_GIFT_CARD'])

/** Our booking ids ('bkg_…'), as they appear in a note. */
const BOOKING_IN_NOTE = /\bbkg_[A-Za-z0-9_-]+/

// ---------------------------------------------------------------- the note and the link

/**
 * The note the payment carries in Square: "Hometown bkg_… · Clay Camp Sat Nov 7 ·
 * Gia Winner". The booking id comes first so it never falls off the end.
 */
export function readerNote(bookingId: string, className: string, dayLabel: string, personName: string): string {
  const clean = (s: string) => s.replace(/\s+/g, ' ').trim()
  return [`Hometown ${bookingId}`, clean(`${className} ${dayLabel}`), clean(personName)].filter(Boolean).join(' · ').slice(0, READER_NOTE_MAX)
}

/** The booking id a payment note names, or null. */
export function bookingInNote(note: unknown): string | null {
  if (typeof note !== 'string') return null
  return BOOKING_IN_NOTE.exec(note)?.[0] ?? null
}

export interface PosRequest {
  amountCents: Cents
  /** https://…/staff/pos-return on this site (registered with Square for this client id) */
  callbackUrl: string
  /** the Square application id the callback is registered on (SQUARE_POS_CLIENT_ID) */
  clientId: string
  notes: string
  /** signState(bookingId) */
  state: string
}

/** The JSON the Square POS app reads, exactly (no line items: the POS API takes an amount and a note). */
export function posRequestData(r: PosRequest): Record<string, unknown> {
  return {
    amount_money: { amount: r.amountCents, currency_code: 'USD' },
    callback_url: r.callbackUrl,
    client_id: r.clientId,
    version: POS_API_VERSION,
    notes: r.notes,
    // S4-R5: the amount already carries the 9% tax, so the app must add none of its own.
    options: { supported_tender_types: [...READER_TENDERS], clear_default_fees: true, auto_return: true },
    state: r.state,
  }
}

/** The link that opens the Square POS app on the iPad. */
export function posPaymentUrl(r: PosRequest): string {
  if (!Number.isInteger(r.amountCents) || r.amountCents < 100) throw new Error('The reader takes $1.00 or more.')
  return `square-commerce-v1://payment/create?data=${encodeURIComponent(JSON.stringify(posRequestData(r)))}`
}

// ---------------------------------------------------------------- the state token

/** "bkg_….<expires, seconds>.<hmac>": only our server can make one, and it runs out. */
export function signState(bookingId: string, secret: string, now: Date, ttlMs = READER_STATE_TTL_MS): string {
  const exp = Math.floor((now.getTime() + ttlMs) / 1000)
  return `${bookingId}.${exp}.${mac(`${bookingId}.${exp}`, secret)}`
}

export type StateCheck = { ok: true; bookingId: string } | { ok: false; why: 'forged' | 'expired' }

export function verifyState(state: unknown, secret: string, now: Date): StateCheck {
  if (typeof state !== 'string' || state.length > 200) return { ok: false, why: 'forged' }
  const m = /^(bkg_[A-Za-z0-9_-]+)\.(\d{9,11})\.([A-Za-z0-9_-]{43})$/.exec(state)
  if (!m) return { ok: false, why: 'forged' }
  const [, bookingId, exp, sig] = m
  const want = mac(`${bookingId}.${exp}`, secret)
  if (!safeEq(sig, want)) return { ok: false, why: 'forged' }
  if (Number(exp) * 1000 <= now.getTime()) return { ok: false, why: 'expired' }
  return { ok: true, bookingId }
}

const mac = (payload: string, secret: string) => createHmac('sha256', `${secret}:reader-state`).update(payload).digest('base64url')
function safeEq(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

// ---------------------------------------------------------------- what the app sent back

export type ReaderReturn =
  | { kind: 'paid'; transactionId: string; clientTransactionId: string | null; state: string }
  /** taken offline: Square knows only its own client id until the iPad is back online */
  | { kind: 'offline'; clientTransactionId: string; state: string }
  | { kind: 'error'; code: string; state: string }

/**
 * Square's `data` (a JSON string) → what happened, or null when it isn't one
 * of Square's answers. iOS sends { status: 'ok', transaction_id,
 * client_transaction_id, state } or { status: 'error', error_code, state }.
 */
export function parseReaderReturn(raw: unknown): ReaderReturn | null {
  if (typeof raw !== 'string' || !raw || raw.length > 4000) return null
  let d: any
  try { d = JSON.parse(raw) } catch { return null }
  if (!d || typeof d !== 'object') return null
  const state = typeof d.state === 'string' ? d.state : ''
  const id = (v: unknown) => (typeof v === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(v) ? v : null)
  if (d.status === 'ok') {
    const tx = id(d.transaction_id), ctx = id(d.client_transaction_id)
    if (tx) return { kind: 'paid', transactionId: tx, clientTransactionId: ctx, state }
    if (ctx) return { kind: 'offline', clientTransactionId: ctx, state }
    return null
  }
  if (d.status === 'error') {
    const code = typeof d.error_code === 'string' && /^[a-z_]{1,60}$/.test(d.error_code) ? d.error_code : 'unknown'
    return { kind: 'error', code, state }
  }
  return null
}

/** Codes that mean the Square app or its setup needs fixing (not the customer's card). */
const SETUP_CODES = new Set([
  'client_not_authorized', 'unsupported_api_version', 'invalid_request', 'data_invalid', 'amount_invalid_format',
  'amount_too_large', 'amount_too_small', 'currency_code_mismatch', 'currency_code_missing', 'invalid_tender_type',
  'gift_card_not_supported', 'customer_management_not_supported', 'invalid_customer_id', 'unknown',
])

/** Whether an error from the app means the setup is broken (owners hear of it). */
export const isSetupError = (code: string) => SETUP_CODES.has(code)

/**
 * What the crew read after an error came back from the app. Every POS API
 * error means the app didn't take the payment, so each one says nothing was
 * charged and the seat was let go.
 */
export function readerErrorMessage(code: string): string {
  switch (code) {
    case 'payment_canceled':
      return 'Cancelled on the reader. Nothing was charged, and the seat was let go.'
    case 'not_logged_in':
    case 'user_not_active':
      return 'The Square app on this iPad isn’t signed in. Nothing was charged, and the seat was let go. Sign in to the studio’s account in the Square app, then try again.'
    case 'no_network':
      return 'The Square app couldn’t connect. Nothing was charged, and the seat was let go. Check the wifi, then try again.'
    default:
      return 'The Square app didn’t take the payment. Nothing was charged, and the seat was let go. Try again, or use Pay on the iPad or Pay at the counter.'
  }
}

// ---------------------------------------------------------------- checking the order Square shows

export type OrderRefusal = 'location' | 'not-completed' | 'amount' | 'tender' | 'old' | 'not-ours'

export type OrderCheck =
  | { ok: true; orderId: string; paymentId: string | null; paymentIds: string[]; tipCents: Cents }
  | { ok: false; why: OrderRefusal }

const cents = (m: any): number => (typeof m?.amount === 'number' ? m.amount : Number(m?.amount) || 0)

/**
 * An order Square shows for a reader sale is that sale's payment only when it
 * is ours to the letter: at our location, COMPLETED, for exactly the held
 * amount (a tip on top is allowed and isn't the seat's), paid by card or
 * Square gift card only (never cash, OWNER-S4-9), made after the sale started
 * and within a day of it, and, when it names a booking in its note, naming
 * this one. Whether it is already linked to another booking is the store's
 * check (linkReaderOrder).
 */
export function checkReaderOrder(
  order: any,
  expect: { locationId: string; amountCents: Cents; bookingId: string; startedAt: string },
): OrderCheck {
  const orderId = typeof order?.id === 'string' ? order.id : ''
  if (!orderId) return { ok: false, why: 'not-ours' }
  if (expect.locationId && order.location_id !== expect.locationId) return { ok: false, why: 'location' }
  if (order.state !== 'COMPLETED') return { ok: false, why: 'not-completed' }
  const tenders: any[] = Array.isArray(order.tenders) ? order.tenders : []
  const named = tenders.map((t) => bookingInNote(t?.note)).filter((x): x is string => !!x)
  if (named.some((b) => b !== expect.bookingId)) return { ok: false, why: 'not-ours' }
  const created = Date.parse(order.created_at ?? '')
  const started = Date.parse(expect.startedAt)
  if (!Number.isFinite(created) || created < started - READER_CLOCK_SLACK_MS || created > started + READER_STATE_TTL_MS) {
    return { ok: false, why: 'old' }
  }
  if (!tenders.length || tenders.some((t) => !READER_ORDER_TENDERS.has(String(t?.type)))) return { ok: false, why: 'tender' }
  const tip = cents(order.total_tip_money)
  if (cents(order.total_money) - tip !== expect.amountCents) return { ok: false, why: 'amount' }
  const paymentIds = [...new Set(tenders.map((t) => t?.payment_id ?? t?.id).filter((x): x is string => typeof x === 'string' && !!x))]
  return { ok: true, orderId, paymentId: paymentIds[0] ?? null, paymentIds, tipCents: tip }
}

/** What the crew read when the order Square shows doesn't pass. The seat stays held; owners hear of it. */
export function refusalMessage(why: OrderRefusal | 'linked'): string {
  switch (why) {
    case 'amount': return 'Square shows a different amount for that payment, so the seat isn’t marked paid. It stays held. Ask Catherine or Kaden.'
    case 'tender': return 'That payment wasn’t by card or gift card, so the seat isn’t marked paid. It stays held. Take cash with Pay at the counter instead.'
    case 'location': return 'That payment was taken at another Square location, so the seat isn’t marked paid. It stays held. Ask Catherine or Kaden.'
    case 'not-completed': return 'Square doesn’t show that payment as finished yet. The seat stays held. Tap Check again in a minute.'
    case 'old': return 'That payment is from before this sale, so the seat isn’t marked paid. It stays held. Ask Catherine or Kaden.'
    case 'linked': return 'That payment already paid for another seat, so this seat isn’t marked paid. It stays held. Ask Catherine or Kaden.'
    case 'not-ours': return 'That payment is for a different sale, so this seat isn’t marked paid. It stays held. Ask Catherine or Kaden.'
  }
}
