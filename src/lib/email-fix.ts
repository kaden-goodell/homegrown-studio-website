/**
 * Fixing a mistyped email right after booking (Kaden, 11 Oct 2026).
 *
 * The booking answer carries a signed ticket naming the booking, the Square
 * customer it landed on, what was typed, and — when the phone matched a
 * record whose email is a letter or two off — the email on file. Only the
 * browser that booked holds it, and it lasts a day.
 *
 * What a fix may do to the Square record is limited, so nobody can take over
 * someone else's profile by typing their phone number:
 *   - choosing between the typed email and the near-identical one on file: yes
 *   - a record this booking created: yes
 *   - a letter-or-two correction of the record's own email: yes
 *   - anything else (an existing record, a wholly different email): no — the
 *     booking's emails go to the new address and the owners are told.
 */
import { issueSignedToken, readSignedToken } from '@lib/reuse-token'
import { isNearMiss } from '@lib/email-typos'
import type { BookingKind } from '@lib/confirmation-copies'

export interface EmailFixTicket extends Record<string, unknown> {
  kind: BookingKind
  bookingId: string
  /** Square customer the booking used ('' when unknown). */
  customerId: string
  /** The address the confirmation went to (what they typed, or their last fix). */
  typed: string
  /** The near-identical email on their Square record, when there is one. */
  onFile: string | null
  matchedBy: 'email' | 'phone' | 'new' | 'unknown'
  /** Workshop seat-choice records are keyed by the class schedule. */
  eventId?: string
}

const DAY_MS = 24 * 60 * 60 * 1000

export function issueEmailFixTicket(t: EmailFixTicket, now = Date.now()): string {
  return issueSignedToken(t, DAY_MS, now)
}

export function readEmailFixTicket(token: unknown, now = Date.now()): EmailFixTicket | null {
  const t = readSignedToken<EmailFixTicket>(token, now)
  if (!t || (t.kind !== 'workshop' && t.kind !== 'party') || typeof t.bookingId !== 'string' || typeof t.typed !== 'string') return null
  return t
}

/** The email on file to ask about: only when the phone matched and the emails are a slip apart. */
export function onFileToAskAbout(typed: string, customer: { email?: string; matchedBy?: string } | null): string | null {
  if (!customer?.email || customer.matchedBy !== 'phone') return null
  return isNearMiss(typed, customer.email) ? customer.email : null
}

export type FixPlan =
  | { action: 'none' }
  | { action: 'choose'; email: string; updateSquare: boolean }
  | { action: 'resend'; email: string; updateSquare: boolean }

/** What a fix to `email` should do, given the ticket. Pure. */
export function planEmailFix(t: EmailFixTicket, email: string): FixPlan {
  const next = email.trim()
  const same = (a: string | null | undefined, b: string) => !!a && a.toLowerCase() === b.toLowerCase()
  if (t.onFile && (same(t.typed, next) || same(t.onFile, next))) {
    // Both addresses already have the confirmation; this only settles the record.
    return { action: 'choose', email: next, updateSquare: !!t.customerId && !same(t.onFile, next) }
  }
  if (same(t.typed, next)) return { action: 'none' }
  const recordEmail = t.onFile ?? (t.matchedBy === 'email' || t.matchedBy === 'new' ? t.typed : null)
  const updateSquare = !!t.customerId && (t.matchedBy === 'new' || (!!recordEmail && isNearMiss(recordEmail, next)))
  return { action: 'resend', email: next, updateSquare }
}
