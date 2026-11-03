/**
 * One checkout attempt, and what we can honestly say about how it ended.
 *
 * The browser makes one attempt ID when the pay step opens and keeps it for as
 * long as the outcome of that checkout is NOT KNOWN (a dropped connection, a
 * "we're not sure" answer). Once the server has said plainly that nothing was
 * charged, the attempt is over and the next try gets a new ID.
 *
 * The server turns the ID into the idempotency keys it hands to Square.
 * What Square does with a repeated key (checked against its docs, 27 Sep 2026):
 *   - the very same request again → the original result, nothing done twice
 *   - the same key with anything changed (a re-typed card makes a new payment
 *     token) → refused with IDEMPOTENCY_KEY_REUSED
 * So the key alone stops a double charge but cannot tell a retry how the
 * first try ended. For that the server asks Square whether the order is paid
 * (PaymentProvider.findOrderPayment). Nothing about the attempt is stored on
 * our side.
 *
 * Three endings, and only three:
 *   - charged      → show the confirmation
 *   - not charged  → we KNOW (it failed before the charge, or Square refused it)
 *   - unknown      → the charge was sent and we never heard back. Never say
 *                    "not charged" here; say we're not sure and give the number.
 *
 * Client-safe: no imports, no env.
 */

export type CheckoutErrorCode =
  | 'invalid'
  | 'card_declined'
  | 'slot_taken'
  | 'sold_out'
  | 'already_booked'
  | 'not_open'
  | 'unavailable'
  | 'unknown_outcome'
  | 'gift_card_short'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isAttemptId(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

/** A fresh attempt ID. Falls back where crypto.randomUUID is missing (old browsers, http). */
export function newAttemptId(): string {
  const c = (globalThis as any).crypto
  if (c?.randomUUID) return c.randomUUID()
  const bytes = new Uint8Array(16)
  if (c?.getRandomValues) c.getRandomValues(bytes)
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** `pay-<seat>`: a class seat after the first, each its own charge. */
export type AttemptStep = 'book' | 'order' | 'pay' | `pay-${number}`

/**
 * The idempotency key for one step of an attempt. Square's tightest limit is
 * 45 characters (payments); a UUID plus a short step name is at most 43 (`:pay-20`).
 */
export function attemptKey(attemptId: string, step: AttemptStep): string {
  return `${attemptId}:${step}`
}

/**
 * Did a failed charge call definitely NOT charge the card?
 *
 * Square refuses a request with a 4xx and a reason (declined card, bad
 * number, expired token): the card was not charged. Anything else — no
 * response at all, a timeout, a 5xx — means the request may have been
 * processed and we simply don't know.
 *
 * One 4xx is different: IDEMPOTENCY_KEY_REUSED. It says an earlier request
 * used this key, and says nothing about how that one ended. It may have
 * charged the card. That is unknown, never "not charged".
 */
export function chargeOutcomeOf(error: unknown): 'not_charged' | 'unknown' {
  if (squareErrorCodes(error).includes('IDEMPOTENCY_KEY_REUSED')) return 'unknown'
  const status = (error as { statusCode?: unknown } | null)?.statusCode
  if (typeof status === 'number' && status >= 400 && status < 500 && status !== 408) return 'not_charged'
  return 'unknown'
}

/** Square's error codes for a failed charge, when it gave any. For the log, never the customer. */
export function squareErrorCodes(error: unknown): string[] {
  const errors = (error as { errors?: unknown } | null)?.errors
  if (!Array.isArray(errors)) return []
  return errors.map((e) => String((e as { code?: unknown })?.code ?? '')).filter(Boolean)
}

/**
 * Sort a refusal from Square's class-booking service into something we can
 * explain. That service is undocumented and answers in free text, so this
 * reads for meaning and falls back to `unavailable`. The raw text is for the
 * server log only.
 */
export function classifyClassBookingError(text: string, phase: 'create' | 'complete'): CheckoutErrorCode {
  const t = text.toLowerCase()
  if (/already (booked|registered|enrolled|exists|has)|duplicate/.test(t)) return 'already_booked'
  if (/sold out|no (seats|spots|capacity|availability)|(is|are) full|capacity|not enough (seats|spots)|unavailable/.test(t)) {
    return 'sold_out'
  }
  if (phase === 'complete' && /declin|card|cvv|expir|insufficient|payment source|could not charge|charge/.test(t)) {
    return 'card_declined'
  }
  return 'unavailable'
}

// ── An attempt still going through, kept for this browser tab ─────────────────
//
// Final review C2: closing the panel, reloading or swiping back while Pay was
// running used to lose the attempt id, so the next try was a new booking and
// could charge again. The id now lives in sessionStorage while its outcome is
// unknown (sent, no answer yet, or "still finishing"), keyed by what is being
// booked. Reopening the same booking sends the same id, so the server answers
// with the first try's result instead of charging twice. A plain ending
// (booked, or "nothing was charged") forgets it.

const PENDING_PREFIX = 'hs-pending-attempt:'
/** Long enough to cover a lost answer and a reopened page; the server's holds run out well before. */
export const PENDING_ATTEMPT_MAX_MS = 30 * 60_000

export interface PendingAttempt {
  id: string
  /** What was being booked (the flow's own description), so a different booking never reuses it. */
  shape: string
  /** When it was sent (ms). */
  at: number
}

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null
  } catch {
    return null
  }
}

/** The attempt still going through for this scope (`class:<id>`, `party`), if any and not too old. */
export function pendingAttempt(scope: string, now: number = Date.now()): PendingAttempt | null {
  const s = storage()
  if (!s) return null
  try {
    const raw = s.getItem(PENDING_PREFIX + scope)
    if (!raw) return null
    const p = JSON.parse(raw) as PendingAttempt
    if (!isAttemptId(p?.id) || typeof p.shape !== 'string' || typeof p.at !== 'number') return null
    if (now - p.at > PENDING_ATTEMPT_MAX_MS) {
      s.removeItem(PENDING_PREFIX + scope)
      return null
    }
    return p
  } catch {
    return null
  }
}

/** The attempt id to use for this booking: the one still going through for the same booking, else a fresh one. */
export function attemptIdFor(scope: string, shape: string): string {
  const p = pendingAttempt(scope)
  return p && p.shape === shape ? p.id : newAttemptId()
}

/** Called just before the request leaves: until a plain answer comes back, this attempt is going through. */
export function rememberPendingAttempt(scope: string, id: string, shape: string, now: number = Date.now()): void {
  try {
    storage()?.setItem(PENDING_PREFIX + scope, JSON.stringify({ id, shape, at: now } satisfies PendingAttempt))
  } catch {
    // Storage blocked: the server's same-person check still stops a quick second booking.
  }
}

/** A plain ending: booked, or nothing was charged. Only forgets the attempt it names. */
export function forgetPendingAttempt(scope: string, id: string): void {
  const s = storage()
  if (!s) return
  try {
    const p = pendingAttempt(scope)
    if (!p || p.id === id) s.removeItem(PENDING_PREFIX + scope)
  } catch {
    // Nothing to do.
  }
}
