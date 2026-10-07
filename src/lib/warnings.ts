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
import { studioOpenOn } from '@config/closures'
import { getEventMeta, type EventMeta } from '@lib/event-meta'
import { listSeatChoicesByEvent } from '@lib/seat-choices'
import { getPartyRecord } from '@lib/party-store'
import { createLogger } from '@lib/logger'
import { formatCalendarDay, formatTime, formatTimeSpan, studioDate, studioDayUtcRange } from '@lib/studio-time'
import { classSpanOf, classesOverlap, partyBlocksClass, partyName, partySpanOf, type ClassSpan, type PartySpan } from '@lib/conflicts'
import type { Workshop } from '@providers/interfaces/workshop'

const logger = createLogger('warnings')

export type WarningCode = 'class-over-party' | 'class-over-class' | 'oversold' | 'party-on-closed-day' | 'picks-missing' | 'capacity-unknown'

export interface Warning {
  code: WarningCode
  eventKind: 'workshop' | 'party'
  /** Class schedule id or party booking id: what the panel opens. */
  eventId: string
  /** ISO start of the event the line is about. */
  when: string
  title: string
  /** "Pumpkin Pails 1–3 PM is within an hour of the Rivera party 1:00 PM." */
  detail: string
  /** What a person does about it: "Move one in Square." */
  action: string
}

/** Days ahead the panel and the daily email look. */
export const WARNING_WINDOW_DAYS = 60

/** "Sun Oct 18 · <detail> <action>" — the one line format, on the panel and in the email. */
export function warningLine(w: Warning): string {
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

function partyOnClosedDay(s: Scan): Warning[] {
  return s.parties
    .filter((p) => !studioOpenOn(studioDate(p.startIso)))
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
 * Seats sold, minus seats with a pick on record: someone booked outside our
 * site. With no capacity to count against, says so instead of going quiet.
 */
async function picksMissing(s: Scan): Promise<Warning[]> {
  const checked = await Promise.all(
    s.classes.map(async (c): Promise<Warning[]> => {
      const { span, workshop } = c
      const options = c.meta?.options ?? []
      if (options.length === 0) return []
      const capacity = capacityOf(c)
      if (capacity === null) {
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
      const picked = (await listSeatChoicesByEvent('workshop', span.id)).reduce((n, r) => n + r.seats, 0)
      const missing = sold - picked
      if (missing <= 0) return []
      return [{
        code: 'picks-missing',
        eventKind: 'workshop',
        eventId: span.id,
        when: span.startIso,
        title: span.name,
        detail: `${span.name}: ${missing} seat${missing === 1 ? ' has' : 's have'} no ${options[0].label.toLowerCase()}.`,
        action: 'Call the customer.',
      }]
    }),
  )
  return checked.flat()
}

export async function listWarnings({ from, to }: { from: string; to: string }): Promise<Warning[]> {
  const s = await scan(from, to)
  return [...classOverParty(s), ...classOverClass(s), ...oversold(s), ...partyOnClosedDay(s), ...(await picksMissing(s))].sort((a, b) =>
    a.when.localeCompare(b.when),
  )
}
