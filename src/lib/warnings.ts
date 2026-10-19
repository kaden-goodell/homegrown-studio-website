/**
 * The staff console's "Needs attention" scan (spec G). Read-only: it reports
 * and says what a person does about it, in Square. Nothing here may cancel,
 * move or release a booking.
 *
 * Throws when classes or bookings can't be read: an empty list must only ever
 * mean "checked, and nothing is wrong". A source that can't be asked at all
 * (no listBookings, no listAllWorkshops) counts as can't be read.
 *
 * Oversold only fires when Square reports a NEGATIVE available_capacity: an
 * exactly-full class looks the same as an oversold one, so the roster's
 * seats-sold figure remains the human check.
 *
 * Capacity is Square's figure when it gives one, else the class's own setting
 * (Square's buyer API sends none for real classes). A class with questions and
 * no capacity anywhere gets a capacity-unknown line rather than silence.
 */
import { providers } from '@config/providers'
import { siteConfig } from '@config/site.config'
import { studioOpenOn, type Closure } from '@config/closures'
import { getClosures } from '@lib/studio-settings'
import { getEventMeta, type EventMeta } from '@lib/event-meta'
import { listSeatChoicesByEvent } from '@lib/seat-choices'
import { getPartyRecord } from '@lib/party-store'
import { createLogger } from '@lib/logger'
import { formatCalendarDay, formatTime, formatTimeSpan, studioDate, studioDayUtcRange } from '@lib/studio-time'
import { classSpanOf, classesOverlap, partyBlocksClass, partyName, partySpanOf, type ClassSpan, type PartySpan } from '@lib/conflicts'
import type { Workshop } from '@providers/interfaces/workshop'
import { getClass, listClasses } from '@lib/classes/class-store'
import { getLedger, seatsTaken } from '@lib/classes/seat-ledger'
import { listPosNeedsDays, listRefundFlags, listUnmatchedPos, type RefundFlag } from '@lib/classes/square-events'
import { onStaffConsole } from '@lib/classes/staff-view'
import { listCounterMatchChecks, listDoorUnpaid } from '@lib/classes/door-unpaid'
import { decidedIds, minimumItemId } from '@lib/classes/decided'
import type { ScheduledClass } from '@lib/classes/types'
import { formatMoney } from '@lib/money'

const logger = createLogger('warnings')

export type WarningCode =
  | 'class-over-party' | 'class-over-class' | 'oversold' | 'party-on-closed-day' | 'picks-missing' | 'capacity-unknown' | 'recorded-over-sold'
  // our own classes (Task 14): read-only for the crew; owners decide on /admin
  | 'below-minimum' | 'pos-unmatched' | 'pos-needs-days' | 'refund-flag' | 'door-unpaid' | 'counter-match-check' | 'classes-unreadable'

export interface Warning {
  code: WarningCode
  eventKind: 'workshop' | 'party'
  /** Class schedule id or party booking id: what the panel opens. '' = nothing to open (a counter sale that matched no class). */
  eventId: string
  /** ISO start of the event the line is about. */
  when: string
  title: string
  /** "Pumpkin Pails 1–3 PM is within an hour of the Rivera party 1:00 PM." */
  detail: string
  /** What a person does about it: "Move one in Square." */
  action: string
  /** Stable id of an undated item (a counter sale, a refund flag…), so the daily email can tell new from old. */
  itemId?: string
}

/** Items that aren't tied to a day: they stay until an owner decides. */
export const UNDATED_CODES: ReadonlySet<WarningCode> = new Set<WarningCode>(['pos-unmatched', 'pos-needs-days', 'refund-flag', 'door-unpaid', 'counter-match-check'])

/** Days ahead the panel and the daily email look. */
export const WARNING_WINDOW_DAYS = 60

/** "Sun Oct 18 · <detail> <action>" — the one line format, on the panel and in the email. */
export function warningLine(w: Warning): string {
  // These already name their day (and the class), so the line doesn't repeat it.
  if (w.code === 'door-unpaid' || w.code === 'counter-match-check') return `${w.detail.replace(/\.$/, '')}. ${w.action}`
  return `${formatCalendarDay(studioDate(w.when))} · ${w.detail} ${w.action}`
}

interface ScannedClass {
  span: ClassSpan
  workshop: Workshop
  meta: EventMeta | null
}

/** Seats the class holds: Square's figure, else the class's own setting. */
const capacityOf = (c: ScannedClass): number | null => c.workshop.totalCapacity ?? c.meta?.capacity ?? null

interface Scan {
  classes: ScannedClass[]
  parties: PartySpan[]
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

async function scan(from: string, to: string): Promise<Scan> {
  const startIso = studioDayUtcRange(from).startIso
  const endIso = studioDayUtcRange(to).endIso
  const lo = Date.parse(startIso)
  const hi = Date.parse(endIso)
  const w = providers.workshop
  const b = providers.booking
  if (typeof w.listAllWorkshops !== 'function') throw new Error('Classes cannot be read — warnings scan refused')
  if (typeof b.listBookings !== 'function') throw new Error('Bookings cannot be read — warnings scan refused')
  const [workshops, bookings] = await Promise.all([
    w.listAllWorkshops(),
    b.listBookings({
      startDate: startIso,
      endDate: endIso,
      locationId: siteConfig.providers.booking.config.locationId || '',
    }),
  ])
  const inWindow = workshops.filter((x) => {
    const t = Date.parse(x.startAt)
    return t >= lo && t <= hi
  })
  // A settings read that fails throws: it fails the scan, never quietly skips.
  const classes = (
    await Promise.all(
      inWindow.map(async (workshop) => {
        const span = classSpanOf(workshop)
        return { span, workshop, meta: await getEventMeta('workshop', span.id) }
      }),
    )
  ).sort((a, b) => a.span.startIso.localeCompare(b.span.startIso))
  const parties = await Promise.all(
    bookings
      .filter((b) => b.status !== 'cancelled')
      .map(async (b) => {
        const record = await getPartyRecord(b.id).catch((error) => {
          logger.warn('Party record unavailable for warning text', { id: b.id, error })
          return null
        })
        return partySpanOf(b, record?.hostName)
      }),
  )
  return { classes, parties }
}

function classOverParty(s: Scan): Warning[] {
  return s.classes.flatMap(({ span }) =>
    partyBlocksClass(span.startIso, span.endIso, s.parties).map((p): Warning => ({
      code: 'class-over-party',
      eventKind: 'workshop',
      eventId: span.id,
      when: span.startIso,
      title: span.name,
      detail: `${span.name} ${formatTimeSpan(span.startIso, span.endIso)} is within an hour of ${partyName(p)} ${formatTime(p.startIso)}.`,
      action: 'Move one in Square.',
    })),
  )
}

function classOverClass(s: Scan): Warning[] {
  const out: Warning[] = []
  for (let i = 0; i < s.classes.length; i++) {
    for (let j = i + 1; j < s.classes.length; j++) {
      const a = s.classes[i].span
      const b = s.classes[j].span
      if (!classesOverlap(a, b)) continue
      out.push({
        code: 'class-over-class',
        eventKind: 'workshop',
        eventId: a.id,
        when: a.startIso,
        title: a.name,
        detail: `${a.name} ${formatTimeSpan(a.startIso, a.endIso)} is within an hour of ${b.name} ${formatTimeSpan(b.startIso, b.endIso)}.`,
        action: 'Move one in Square.',
      })
    }
  }
  return out
}

function oversold(s: Scan): Warning[] {
  return s.classes.flatMap((c): Warning[] => {
    const { span, workshop } = c
    // Only fires if Square reports a NEGATIVE available_capacity; an exactly-full
    // class is indistinguishable from an oversold one. The roster's seats-sold
    // figure is the human check.
    const total = capacityOf(c)
    if (total === null) return []
    const sold = total - workshop.availableCapacity
    if (sold <= total) return []
    return [{
      code: 'oversold',
      eventKind: 'workshop',
      eventId: span.id,
      when: span.startIso,
      title: span.name,
      detail: `${span.name}: ${sold} seats sold, ${total} capacity.`,
      action: 'Sort it out in Square.',
    }]
  })
}

function partyOnClosedDay(s: Scan, closed: Closure[]): Warning[] {
  return s.parties
    .filter((p) => !studioOpenOn(studioDate(p.startIso), closed))
    .map((p): Warning => ({
      code: 'party-on-closed-day',
      eventKind: 'party',
      eventId: p.id,
      when: p.startIso,
      title: capitalize(partyName(p)),
      detail: `${capitalize(partyName(p))} ${formatTime(p.startIso)} is booked on a closed day.`,
      action: 'Move it in Square or open the day.',
    }))
}

/**
 * Seats sold against seats on record, both ways:
 * - picks-missing: sold minus recorded — someone booked outside our site.
 *   Only for a class that asks questions; with no capacity to count against,
 *   says so instead of going quiet.
 * - recorded-over-sold: recorded minus sold — a seat was recorded here (a
 *   comp, say) but never added in Square, so Square can still sell it.
 */
async function seatCounts(s: Scan): Promise<Warning[]> {
  const checked = await Promise.all(
    s.classes.map(async (c): Promise<Warning[]> => {
      const { span, workshop } = c
      const options = c.meta?.options ?? []
      const capacity = capacityOf(c)
      if (capacity === null) {
        if (options.length === 0) return []
        return [{
          code: 'capacity-unknown',
          eventKind: 'workshop',
          eventId: span.id,
          when: span.startIso,
          title: span.name,
          detail: `Can’t count seats sold for ${span.name}. Set its capacity (gear → Capacity) so seats booked on Square’s own page get flagged.`,
          action: 'Set the capacity.',
        }]
      }
      const sold = capacity - workshop.availableCapacity
      const records = await listSeatChoicesByEvent('workshop', span.id)
      if (options.length === 0 && records.length === 0) return []
      const recorded = records.reduce((n, r) => n + r.seats, 0)
      const out: Warning[] = []
      const missing = sold - recorded
      if (options.length > 0 && missing > 0) {
        out.push({
          code: 'picks-missing',
          eventKind: 'workshop',
          eventId: span.id,
          when: span.startIso,
          title: span.name,
          detail: `${span.name}: ${missing} seat${missing === 1 ? ' has' : 's have'} no ${options[0].label.toLowerCase()}.`,
          action: 'Call the customer.',
        })
      }
      // A simulated (preview) record never reached Square, so it can't be
      // "recorded but not added in Square" — count only real ones here.
      const extra = records.filter((r) => r.simulated !== true).reduce((n, r) => n + r.seats, 0) - sold
      if (extra > 0) {
        out.push({
          code: 'recorded-over-sold',
          eventKind: 'workshop',
          eventId: span.id,
          when: span.startIso,
          title: span.name,
          detail: `${span.name} · ${extra} recorded seat${extra === 1 ? '' : 's'} more than Square shows —`,
          action: 'someone was recorded here but not added in Square.',
        })
      }
      return out
    }),
  )
  return checked.flat()
}

/** Where the crew send anything about our own classes that needs a decision. */
export const OWNERS_DECIDE = 'An owner decides on /admin.'

/**
 * Our own classes, from the seat ledger and what Square told us (Task 14):
 * - oversold: a session with more seats than it holds ("41 of 40"), e.g. a
 *   paid seat whose hold ran out, a counter sale, or one more squeezed in
 * - below-minimum: fewer booked than the class needs to run, before its decide-by
 * - pos-unmatched / pos-needs-days: counter sales nobody has sorted out yet
 * - refund-flag: refunds made in Square, or ours still waiting on Square
 * - door-unpaid: a "pay at the counter" seat never rung up once its session ended (R32)
 * The last four aren't tied to the window: they stay until someone decides.
 * Read-only: nothing here frees, moves or refunds anything.
 */
async function ownClassWarnings(from: string, to: string, now: Date): Promise<Warning[]> {
  const startIso = studioDayUtcRange(from).startIso
  const endIso = studioDayUtcRange(to).endIso
  const [classes, unmatched, needsDays, flags, unpaid, matches, decided] = await Promise.all([
    listClasses({ fromIso: startIso, toIso: endIso }),
    listUnmatchedPos(),
    listPosNeedsDays(),
    listRefundFlags(),
    listDoorUnpaid(now),
    listCounterMatchChecks(now),
    // What owners already decided in /admin › To decide (e.g. "Keep it running") stops showing here.
    decidedIds(),
  ])
  const shown = classes.filter(onStaffConsole)
  const byId = new Map<string, ScheduledClass>(shown.map((c) => [c.id, c]))
  const out: Warning[] = []
  for (const cls of shown) {
    const ledger = await getLedger(cls.id)
    const name = cls.content.name
    const sessions = [...cls.sessions].sort((a, b) => a.startIso.localeCompare(b.startIso))
    for (const s of sessions) {
      if (s.startIso > endIso || s.endIso < startIso) continue
      const sold = seatsTaken(ledger, s.id, now)
      if (sold > s.capacity) {
        out.push({
          code: 'oversold', eventKind: 'workshop', eventId: cls.id, when: s.startIso, title: name,
          detail: `${name} ${formatTime(s.startIso)}: ${sold} of ${s.capacity} booked.`, action: OWNERS_DECIDE,
        })
      }
    }
    const min = cls.content.rules.minimumToRun
    const first = sessions[0]
    if (min && first && Date.parse(first.startIso) > now.getTime() && first.startIso <= endIso && !decided.has(minimumItemId(cls.id))) {
      const booked = seatsTaken(ledger, first.id, now)
      if (booked < min.count) {
        out.push({
          code: 'below-minimum', eventKind: 'workshop', eventId: cls.id, when: first.startIso, title: name,
          detail: `${name} has ${booked} of the ${min.count} it needs to run, decide by ${formatCalendarDay(studioDate(min.decideByIso))} ${formatTime(min.decideByIso)}.`,
          action: OWNERS_DECIDE,
        })
      }
    }
  }
  for (const u of unmatched) {
    out.push({
      code: 'pos-unmatched', eventKind: 'workshop', eventId: '', when: u.at, title: u.name, itemId: `unmatched-${u.orderId}-${u.lineUid}`,
      detail: `A counter sale of ${u.name}${u.qty > 1 ? ` ×${u.qty}` : ''} didn’t match a class.`, action: OWNERS_DECIDE,
    })
  }
  const nameOf = async (classId: string) => byId.get(classId)?.content.name ?? (await getClass(classId))?.content.name ?? 'A class'
  for (const d of needsDays) {
    const name = await nameOf(d.classId)
    out.push({
      code: 'pos-needs-days', eventKind: 'workshop', eventId: d.classId, when: d.at, title: name, itemId: d.id,
      detail: `A counter sale of ${name} needs its day picked.`, action: OWNERS_DECIDE,
    })
  }
  for (const u of unpaid) {
    out.push({
      code: 'door-unpaid', eventKind: 'workshop', eventId: u.classId, when: u.sessionStartIso, title: u.className, itemId: u.id,
      detail: `${u.name || 'A door seat'} · ${u.className} · ${formatCalendarDay(u.day)} · not paid at the counter yet`, action: OWNERS_DECIDE,
    })
  }
  for (const m of matches) {
    out.push({
      code: 'counter-match-check', eventKind: 'workshop', eventId: m.classId, when: m.at, title: m.className, itemId: m.id,
      detail: `Counter sale of ${m.className} on ${formatCalendarDay(m.day)} was matched to ${m.name}. Check it was them.`, action: OWNERS_DECIDE,
    })
  }
  for (const f of flags) {
    const name = await nameOf(f.classId)
    out.push({ code: 'refund-flag', eventKind: 'workshop', eventId: f.classId, when: f.at, title: name, itemId: f.id, detail: refundFlagDetail(f, name), action: OWNERS_DECIDE })
  }
  return out
}

function refundFlagDetail(f: RefundFlag, name: string): string {
  const money = formatMoney(f.refundCents ?? f.cents)
  switch (f.kind) {
    case 'plain-refund': return `${name}: ${money} was refunded in Square. Should a seat be freed?`
    case 'refund-failed': return `${name}: Square couldn’t finish a ${money} refund.`
    case 'refund-unconfirmed': return `${name}: a ${money} refund is still waiting on Square.`
    case 'refund-unfinished': return `${name}: a ${money} refund checked in Square was never finished.`
    default: return `${name}: a refund needs a look.`
  }
}

export async function listWarnings({ from, to }: { from: string; to: string }, opts: { now?: Date } = {}): Promise<Warning[]> {
  const now = opts.now ?? new Date()
  // Our classes can't be read: say so in one line rather than hiding the Square and party warnings (never an all clear).
  const ownOrError = ownClassWarnings(from, to, now).catch((e): Warning[] => {
    logger.error('Class warnings scan failed', { error: e instanceof Error ? e.message : String(e) })
    return [{
      code: 'classes-unreadable', eventKind: 'workshop', eventId: '', when: now.toISOString(), title: 'Classes',
      detail: 'Our classes couldn’t be checked for problems.', action: 'Refresh to try again.',
    }]
  })
  // The owners' closed days (config until they first save on /admin).
  const [s, own, closed] = await Promise.all([scan(from, to), ownOrError, getClosures()])
  return [...classOverParty(s), ...classOverClass(s), ...oversold(s), ...partyOnClosedDay(s, closed), ...(await seatCounts(s)), ...own].sort((a, b) =>
    a.when.localeCompare(b.when),
  )
}
