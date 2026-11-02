/**
 * Party lines for the staff "Needs attention" panel and the owners' daily
 * email (stage 2 Task 13). Read-only: nothing here moves, cancels, refunds
 * or lets a time go. Each line says what a person does about it.
 *
 *   party-waiting-payment   one of our parties within 7 days still has its
 *                           studio fee or extras to pay (never cancelled for it)
 *   party-hold-no-party     a time held in the party book that no booked party
 *                           of ours is on: no record, a cancelled party, or a
 *                           party that is on another time (a move that didn't
 *                           finish). Short holds of a booking still being paid
 *                           and holds of a checkout waiting in To decide are
 *                           left out (they run out, or To decide has them).
 *   party-no-hold           the other way round: a booked party of ours whose
 *                           time isn't held (or whose extra time isn't), so the
 *                           time could be booked by someone else
 *   two-parties             two parties at once (or inside the cleanup hour),
 *                           e.g. one paid after its time was taken (R6)
 *   class-over-party        one of OUR classes within an hour of a party (the
 *                           Square classes are checked in ../warnings.ts)
 *
 * Parties booked in Square are taken from Square's own live list (party
 * service, not cancelled; `squareParties`, which listWarnings passes from the
 * scan it already makes), never from our saved records of them: a party
 * cancelled in Square raises nothing, one booked there by hand is checked.
 * When that list can't be read, one "couldn't check" line says so.
 *   party-paid-after-cancel money came in on a party after it was cancelled
 *
 * Server only.
 */
import type { Warning } from '@lib/warnings'
import { formatMoney } from '@lib/money'
import { formatTime, formatTimeSpan, studioDayUtcRange } from '@lib/studio-time'
import { overlaps, intervalOf, partyName } from '@lib/conflicts'
import { listClasses } from '@lib/classes/class-store'
import { isOurs, listParties, partyEndIso, type PartyRecord } from '@lib/party-store'
import { legacyPartyBusy } from './legacy-square'
import type { PartySpan } from '@lib/conflicts'
import { holdsBetween, type PartyHold } from './party-book'
import { listCheckouts } from './party-checkouts'
import { dueCents, refundableOn } from './money'
import { partyWhenLabel, whatIsDue } from './payment-link'
import { PARTY_CLEANUP_MINUTES } from './party-times'

const DAY_MS = 86_400_000
/** "Party waiting on payment" looks this far ahead. */
export const PAYMENT_WARNING_DAYS = 7
/** A payment that came in after a cancel stays listed this long after the party's day. */
const PAID_AFTER_CANCEL_DAYS = 30

export const NO_HOLD_ACTION = 'Open the party on /admin and tap Hold this time again.'
/** A cancelled party still holding its time: the party sheet's "Free this time". */
export const CANCELLED_HOLD_ACTION = 'Open the party on /admin and tap Free this time.'
/** A leftover hold after a move: the party sheet's "Free the old time". */
export const LEFTOVER_HOLD_ACTION = 'Open the party on /admin and tap Free the old time.'
/** A held time with no party at all: To decide's "Free this time". */
export const ORPHAN_HOLD_ACTION = 'Open To decide on /admin and tap Free this time.'

/**
 * Parties booked in Square before the switch-over are read-only here (S2-R9): the one place they can
 * still be changed is Square itself, and only until the switch-over finishes. Said plainly.
 */
export const SQUARE_ONLY = 'was booked in Square before we moved bookings here, so it can only be moved in Square.'

/** Two parties at once: `ours` names a party of ours (null when it is a Square booking), `sq` a Square-booked one. */
function twoPartiesAction(oursA: string | null, oursB: string | null, sq: string | null): string {
  if (!sq) return 'Move one of them on /admin.'
  if (!oursA && !oursB) return 'Move one of them in Square. Both were booked in Square before we moved bookings here, so they can only be moved there.'
  return `Move ${oursA ?? oursB} on /admin. ${capitalize(sq)} ${SQUARE_ONLY}`
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const first = (name: string) => name.trim().split(/\s+/)[0] || 'them'
const possessive = (name: string) => `${name.trim() || 'Someone'}’s`
const nameOf = (r: Pick<PartyRecord, 'bookingId' | 'startIso' | 'hostName'>) => partyName({ id: r.bookingId, startIso: r.startIso, endIso: r.startIso, hostName: r.hostName })
const same = (a: string, b: string) => Date.parse(a) === Date.parse(b)

/** Held for a booking or a payment link, not a short hold while someone is paying (those run out by themselves). */
const lasting = (h: PartyHold) => h.state === 'booked' || h.holdExpiresAt === null

type SquareSide = { ok: true; spans: PartySpan[] } | { ok: false }

export async function partyWarnings(from: string, to: string, now: Date, opts: { squareParties?: Promise<PartySpan[]> } = {}): Promise<Warning[]> {
  const lo = studioDayUtcRange(from).startIso
  const hi = studioDayUtcRange(to).endIso
  const inWindow = (iso: string) => iso >= lo && iso <= hi
  // Square's own list of its parties; a failure is settled here at once (no unhandled rejection) and said in one line.
  const squareSide: Promise<SquareSide> = (opts.squareParties ?? legacyPartyBusy(lo, hi))
    .then((list): SquareSide => ({ ok: true, spans: list.map((p) => ({ id: p.id, startIso: p.startIso, endIso: p.endIso, ...(p.hostName ? { hostName: p.hostName } : {}) })) }), (): SquareSide => ({ ok: false }))
  // A day either side, so a party near the edge still finds its hold.
  const [records, holds, checkouts, classes, square] = await Promise.all([
    listParties(),
    holdsBetween(new Date(Date.parse(lo) - DAY_MS).toISOString(), new Date(Date.parse(hi) + DAY_MS).toISOString(), now),
    listCheckouts(),
    // Our classes unreadable: the class scan already says so in its own line; the party checks still run.
    listClasses({ fromIso: lo, toIso: hi }).catch(() => []),
    squareSide,
  ])
  const byId = new Map(records.map((r) => [r.bookingId, r]))
  const checkingOut = new Set(checkouts.filter((c) => c.state !== 'paid-elsewhere' && c.state !== 'settled').map((c) => c.partyId))
  const out: Warning[] = []

  // ── Waiting on payment (within 7 days) ─────────────────────────────────────
  for (const r of records) {
    if (!isOurs(r) || r.status === 'cancelled') continue
    const t = Date.parse(r.startIso)
    if (t <= now.getTime() || t > now.getTime() + PAYMENT_WARNING_DAYS * DAY_MS || !inWindow(r.startIso)) continue
    const due = dueCents(r)
    if (due <= 0) continue
    out.push({
      code: 'party-waiting-payment', eventKind: 'party', eventId: r.bookingId, when: r.startIso, title: capitalize(nameOf(r)),
      detail: `${capitalize(nameOf(r))} ${formatTime(r.startIso)} still has ${formatMoney(due)} to pay for ${whatIsDue(r)}.`,
      action: `Send the payment link again from the party on /admin, or call ${first(r.hostName)}. Nothing is cancelled for being unpaid.`,
    })
  }

  // ── Held times no booked party is on ───────────────────────────────────────
  for (const h of holds) {
    if (!lasting(h) || !inWindow(h.startIso) || Date.parse(h.endIso) <= now.getTime()) continue
    if (checkingOut.has(h.partyId)) continue
    const r = byId.get(h.partyId)
    const time = formatTime(h.startIso)
    if (!r) {
      out.push({
        code: 'party-hold-no-party', eventKind: 'party', eventId: '', when: h.startIso, title: 'A held party time',
        detail: `${time} is held for a party that isn’t on the books, so nobody can book that time.`,
        action: ORPHAN_HOLD_ACTION,
      })
    } else if (r.status === 'cancelled') {
      out.push({
        code: 'party-hold-no-party', eventKind: 'party', eventId: r.bookingId, when: h.startIso, title: capitalize(nameOf(r)),
        detail: `${possessive(r.hostName)} cancelled party still holds ${time}, so nobody can book that time.`,
        action: CANCELLED_HOLD_ACTION,
      })
    } else if (isOurs(r) && !same(r.startIso, h.startIso)) {
      out.push({
        code: 'party-hold-no-party', eventKind: 'party', eventId: r.bookingId, when: h.startIso, title: capitalize(nameOf(r)),
        detail: `${possessive(r.hostName)} party is on ${partyWhenLabel(r.startIso)}, but ${time} is held for it too, so nobody can book that time.`,
        action: LEFTOVER_HOLD_ACTION,
      })
    }
  }

  // ── Booked parties whose time (or extra time) isn't held ───────────────────
  for (const r of records) {
    if (!isOurs(r) || r.status === 'cancelled' || Date.parse(r.startIso) <= now.getTime() || !inWindow(r.startIso)) continue
    const mine = holds.find((h) => h.partyId === r.bookingId && same(h.startIso, r.startIso))
    const end = partyEndIso(r)
    const short = !!mine && !!end && Date.parse(mine.endIso) < Date.parse(end)
    if (mine && !short) continue
    out.push({
      code: 'party-no-hold', eventKind: 'party', eventId: r.bookingId, when: r.startIso, title: capitalize(nameOf(r)),
      detail: short
        ? `${possessive(r.hostName)} party on ${partyWhenLabel(r.startIso)} has extra time that isn’t held on the calendar, so someone else could book right after it.`
        : `${possessive(r.hostName)} party on ${partyWhenLabel(r.startIso)} isn’t held on the calendar, so that time could be booked by someone else.`,
      action: NO_HOLD_ACTION,
    })
  }

  // ── Two parties at once ────────────────────────────────────────────────────
  // Every party taking the room: our lasting holds (the time they really hold) and the parties Square lists as booked.
  if (!square.ok) {
    out.push({
      code: 'parties-unreadable', eventKind: 'party', eventId: '', when: now.toISOString(), title: 'Parties booked in Square',
      detail: 'Parties booked in Square couldn’t be checked against our parties and classes just now.', action: 'Refresh to try again.',
    })
  }
  const ourIds = new Set(holds.map((h) => h.partyId))
  const squareSpans = (square.ok ? square.spans : []).filter((p) => !ourIds.has(p.id) && p.startIso <= hi && p.endIso >= lo)
  const squareIds = new Set(squareSpans.map((p) => p.id))
  const spans: PartySpan[] = [
    ...holds.filter((h) => lasting(h) && byId.get(h.partyId)?.status !== 'cancelled' && inWindow(h.startIso)).map((h) => ({ id: h.partyId, startIso: h.startIso, endIso: h.endIso })),
    ...squareSpans,
  ].sort((a, b) => a.startIso.localeCompare(b.startIso))
  /** "the Justice party": our record's host, else the name Square's list carries. */
  const spanName = (p: PartySpan, fallback: string) => {
    const r = byId.get(p.id)
    if (r) return nameOf(r)
    return squareIds.has(p.id) ? partyName(p) : fallback
  }
  for (let i = 0; i < spans.length; i++) {
    for (let j = i + 1; j < spans.length; j++) {
      const a = spans[i], b = spans[j]
      if (a.id === b.id || !overlaps(intervalOf(a), intervalOf(b), PARTY_CLEANUP_MINUTES)) continue
      const na = spanName(a, 'a party'), nb = spanName(b, 'another party')
      const sqA = squareIds.has(a.id), sqB = squareIds.has(b.id)
      out.push({
        code: 'two-parties', eventKind: 'party', eventId: a.id, when: a.startIso, title: capitalize(na),
        detail: `${capitalize(na)} ${formatTimeSpan(a.startIso, a.endIso)} and ${nb} ${formatTimeSpan(b.startIso, b.endIso)} are booked at the same time, or without the hour between them for cleanup.`,
        action: twoPartiesAction(sqA ? null : na, sqB ? null : nb, sqA ? na : sqB ? nb : null),
      })
    }
  }

  // ── Our classes over a party ───────────────────────────────────────────────
  const partySpans = spans
  for (const cls of classes) {
    if (cls.status === 'cancelled' || cls.status === 'draft') continue
    for (const s of cls.sessions) {
      if (!inWindow(s.startIso)) continue
      for (const p of partySpans) {
        if (!overlaps(intervalOf(s), intervalOf(p), PARTY_CLEANUP_MINUTES)) continue
        out.push({
          code: 'class-over-party', eventKind: 'workshop', eventId: cls.id, when: s.startIso, title: cls.content.name,
          detail: `${cls.content.name} ${formatTimeSpan(s.startIso, s.endIso)} is within an hour of ${spanName(p, 'a party')} ${formatTime(p.startIso)}.`,
          action: squareIds.has(p.id) ? `Move the class on /admin. ${capitalize(spanName(p, 'the party'))} ${SQUARE_ONLY}` : 'Move one of them on /admin.',
        })
      }
    }
  }

  // ── Paid after it was cancelled ────────────────────────────────────────────
  for (const r of records) {
    if (!isOurs(r) || r.status !== 'cancelled' || !r.cancelled) continue
    if (Date.parse(r.startIso) < now.getTime() - PAID_AFTER_CANCEL_DAYS * DAY_MS) continue
    for (const c of r.charges ?? []) {
      if (c.simulated || Date.parse(c.at) <= Date.parse(r.cancelled.at) || refundableOn(r, c.id) <= 0) continue
      out.push({
        code: 'party-paid-after-cancel', eventKind: 'party', eventId: r.bookingId, when: r.startIso, title: capitalize(nameOf(r)), itemId: `paid-after-cancel-${c.id}`,
        detail: `${r.hostName.trim() || 'The host'} paid ${formatMoney(c.cents)} after their party on ${partyWhenLabel(r.startIso)} was cancelled. Nothing was refunded.`,
        action: 'Open the party on /admin. If the money should go back, use Refund on the Payments tab.',
      })
    }
  }

  return out
}
