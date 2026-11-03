/**
 * Owner-tapped class emails (final review I1, I6). Never automatic:
 *  - "Email them their booking again" on a booking row: the same confirmation
 *    (with a fresh "Can't make it?" link and the calendar file), optionally to
 *    a corrected email, which is saved on the booking first. Audited.
 *  - "Email everyone the new details" after a move: the confirmation again for
 *    each booking on the moved dates, with the new time and a calendar file
 *    that replaces the old event. Audited.
 */
import { siteConfig } from '@config/site.config'
import { recordAudit } from '@lib/audit'
import type { By } from '@lib/staff-auth'
import { ActionError } from './admin-actions'
import { seatsLabelFor } from './checkout'
import { getClass } from './class-store'
import { sendClassConfirmation } from './confirmation'
import { isFreeBooking } from './refunds'
import { getLedger, setNames, unpaidDoorSeat, type LedgerLine } from './seat-ledger'
import { isComing, paidOn } from './seat-status'
import type { ScheduledClass } from './types'

/** A refusal the owner reads (the class routes' ActionError, so `reply` answers it as one). */
export class ResendError extends ActionError {}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const RESEND_MESSAGES = {
  noClass: 'We couldn’t find that class. Refresh and try again.',
  cancelled: 'This class is cancelled, so there’s no booking to send.',
  over: 'This class has already happened.',
  notComing: 'Nobody on this booking is coming any more, so there’s nothing to send.',
  noEmail: 'There’s no email on this booking. Type one in.',
  badEmail: 'That email doesn’t look right. Check for typos.',
  notSent: 'The email didn’t go. Check More › Email, texts and Square, then try again.',
  noMoved: 'Pick the dates that moved.',
} as const

/** The lead sentence of the email sent after a move. */
export const MOVED_LEAD = 'Your class has a new time. Here are your updated details, with a new calendar file to replace the old one.'

const origin = () => siteConfig.url.replace(/\/$/, '')
const actor = (by: By) => ({ ...by, role: 'owner' as const })

async function mustClass(id: unknown): Promise<ScheduledClass> {
  const cls = typeof id === 'string' && id ? await getClass(id) : null
  if (!cls) throw new ResendError(404, RESEND_MESSAGES.noClass)
  if (cls.status === 'cancelled') throw new ResendError(409, RESEND_MESSAGES.cancelled)
  if (!cls.sessions.some((s) => Date.parse(s.endIso) > Date.now())) throw new ResendError(409, RESEND_MESSAGES.over)
  return cls
}

function pickLines(cls: ScheduledClass, lines: LedgerLine[]): string[] {
  const out: string[] = []
  for (const l of [...lines].sort((a, b) => a.seat - b.seat)) {
    for (const q of cls.content.questions) if (l.answers[q.id]) out.push(`Seat ${l.seat} · ${q.label} ${l.answers[q.id]}`)
  }
  return out
}

/** One booking's confirmation, as it was first sent (comp, free, pay at the counter or paid), to `email`. */
async function sendFor(cls: ScheduledClass, lines: LedgerLine[], email: string, extra: { lead?: string; calendarFrom?: Record<string, string> } = {}): Promise<boolean> {
  const first = lines[0]
  const picks = pickLines(cls, lines)
  const due = lines.filter(unpaidDoorSeat).reduce((s, l) => s + paidOn(l), 0)
  const flags = first.source === 'comp' ? { comped: true }
    : isFreeBooking(first) ? { free: true }
      : due > 0 ? { dueAtStudioCents: due } : {}
  return sendClassConfirmation({
    origin: origin(), bookingId: first.bookingId, cls, sessionIds: first.sessionIds, seats: lines.length,
    seatsLabel: seatsLabelFor(cls, lines), email, givenName: first.customer?.givenName ?? '', receiptUrl: null,
    totalChargedCents: first.square.chargedCents ?? lines.reduce((s, l) => s + paidOn(l), 0),
    ...(picks.length ? { pickLines: picks } : {}),
    ...flags,
    ...(extra.lead ? { lead: extra.lead } : {}),
    ...(extra.calendarFrom ? { calendarFrom: extra.calendarFrom, calendarSequence: Math.floor(Date.now() / 60_000) } : {}),
  }).catch(() => false)
}

/**
 * "Email them their booking again" (I6). `email`, when given and different,
 * is saved on the booking first (every seat of it), then the email goes there.
 */
export async function resendBookingConfirmation(body: { id?: unknown; bookingId?: unknown; email?: unknown }, by: By): Promise<{ data: { sent: true; to: string; emailChanged: boolean } }> {
  const cls = await mustClass(body.id)
  const ledger = await getLedger(cls.id)
  const all = ledger.lines.filter((l) => l.bookingId === body.bookingId)
  const coming = all.filter(isComing)
  if (!coming.length) throw new ResendError(409, RESEND_MESSAGES.notComing)
  const current = coming.find((l) => l.customer?.email)?.customer ?? coming[0].customer
  const typed = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (typed && !EMAIL_RE.test(typed)) throw new ResendError(400, RESEND_MESSAGES.badEmail, { field: 'email' })
  const to = typed || current?.email?.trim() || ''
  if (!to) throw new ResendError(400, RESEND_MESSAGES.noEmail, { field: 'email' })
  const before = current?.email ?? ''
  const emailChanged = !!typed && typed !== before.trim().toLowerCase()
  if (emailChanged) {
    const who = current ?? { givenName: '', familyName: '', email: '', phone: '' }
    await setNames(cls.id, all.map((l) => l.id), { ...who, email: typed })
    await recordAudit({
      by: actor(by), action: 'class-booking-email-fixed', target: { kind: 'class', id: cls.id, label: cls.content.name },
      details: { bookingId: String(body.bookingId), from: before, to: typed },
    })
  }
  const lines = emailChanged ? coming.map((l) => ({ ...l, customer: l.customer ? { ...l.customer, email: typed } : l.customer })) : coming
  const sent = await sendFor(cls, lines, to)
  await recordAudit({
    by: actor(by), action: 'class-confirmation-resent', target: { kind: 'class', id: cls.id, label: cls.content.name },
    details: { bookingId: String(body.bookingId), to, sent },
  })
  if (!sent) throw new ResendError(502, emailChanged ? `The email is fixed on the booking, but it didn’t go. Check More › Email, texts and Square, then try again.` : RESEND_MESSAGES.notSent, { emailChanged })
  return { data: { sent: true, to, emailChanged } }
}

export interface MovedEmailResult { sent: string[]; failed: string[]; noEmail: string[] }

/**
 * "Email everyone the new details" (I1): each booking coming on a moved date
 * gets its confirmation again with the new time. `movedFrom`: sessionId → the
 * start time before the move (for the calendar file).
 */
export async function emailMovedBookings(body: { id?: unknown; movedFrom?: unknown }, by: By): Promise<{ data: MovedEmailResult }> {
  const cls = await mustClass(body.id)
  const raw = body.movedFrom && typeof body.movedFrom === 'object' ? body.movedFrom as Record<string, unknown> : {}
  const movedFrom: Record<string, string> = {}
  for (const [id, iso] of Object.entries(raw)) {
    if (cls.sessions.some((s) => s.id === id) && typeof iso === 'string' && !Number.isNaN(Date.parse(iso))) movedFrom[id] = iso
  }
  const ids = Object.keys(movedFrom)
  if (!ids.length) throw new ResendError(400, RESEND_MESSAGES.noMoved)
  const ledger = await getLedger(cls.id)
  const groups = new Map<string, LedgerLine[]>()
  for (const l of ledger.lines) {
    if (!isComing(l) || !l.sessionIds.some((s) => ids.includes(s))) continue
    groups.set(l.bookingId, [...(groups.get(l.bookingId) ?? []), l])
  }
  const out: MovedEmailResult = { sent: [], failed: [], noEmail: [] }
  for (const lines of groups.values()) {
    const who = lines.find((l) => l.customer?.email)?.customer
    const name = [lines[0].customer?.givenName, lines[0].customer?.familyName].filter(Boolean).join(' ') || 'No name'
    if (!who?.email) { out.noEmail.push(name); continue }
    if (await sendFor(cls, lines, who.email, { lead: MOVED_LEAD, calendarFrom: movedFrom })) out.sent.push(name)
    else out.failed.push(name)
  }
  await recordAudit({
    by: actor(by), action: 'class-move-emailed', target: { kind: 'class', id: cls.id, label: cls.content.name },
    details: { sent: out.sent.length, failed: out.failed.length, noEmail: out.noEmail.length },
  })
  return { data: out }
}
