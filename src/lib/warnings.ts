/**
 * The staff console's "Needs attention" scan (spec G). Read-only: it reports
 * and says what a person does about it, in Square. Nothing here may cancel,
 * move or release a booking.
 *
 * Throws when classes or bookings can't be read: an empty list must only ever
 * mean "checked, and nothing is wrong".
 */
import { providers } from '@config/providers'
import { siteConfig } from '@config/site.config'
import { studioOpenOn } from '@config/closures'
import { getPartyRecord } from '@lib/party-store'
import { formatCalendarDay, formatTime, formatTimeSpan, studioDate, studioDayUtcRange } from '@lib/studio-time'
import { classSpanOf, classesOverlap, partyBlocksClass, partyName, partySpanOf, type ClassSpan, type PartySpan } from '@lib/conflicts'
import type { Workshop } from '@providers/interfaces/workshop'

export type WarningCode = 'class-over-party' | 'class-over-class' | 'oversold' | 'party-on-closed-day' | 'picks-missing'

export interface Warning {
  code: WarningCode
  eventKind: 'workshop' | 'party'
  /** Class schedule id or party booking id: what the panel opens. */
  eventId: string
  /** ISO start of the event the line is about. */
  when: string
  title: string
  /** "Pumpkin Pails 1–3 PM overlaps the Rivera party 1:00 PM." */
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
}

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
  const [workshops, bookings] = await Promise.all([
    w.listAllWorkshops?.() ?? w.listWorkshops(),
    providers.booking.listBookings
      ? providers.booking.listBookings({
          startDate: startIso,
          endDate: endIso,
          locationId: siteConfig.providers.booking.config.locationId || '',
        })
      : Promise.resolve([]),
  ])
  const classes = workshops
    .filter((x) => {
      const t = Date.parse(x.startAt)
      return t >= lo && t <= hi
    })
    .map((workshop) => ({ span: classSpanOf(workshop), workshop }))
    .sort((a, b) => a.span.startIso.localeCompare(b.span.startIso))
  const parties = await Promise.all(
    bookings
      .filter((b) => b.status !== 'cancelled')
      .map(async (b) => {
        const record = await getPartyRecord(b.id).catch(() => null)
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
      detail: `${span.name} ${formatTimeSpan(span.startIso, span.endIso)} overlaps ${partyName(p)} ${formatTime(p.startIso)}.`,
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
        detail: `${a.name} ${formatTimeSpan(a.startIso, a.endIso)} overlaps ${b.name} ${formatTimeSpan(b.startIso, b.endIso)}.`,
        action: 'Move one in Square.',
      })
    }
  }
  return out
}

function oversold(s: Scan): Warning[] {
  return s.classes.flatMap(({ span, workshop }): Warning[] => {
    const total = workshop.totalCapacity
    if (typeof total !== 'number') return []
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

export async function listWarnings({ from, to }: { from: string; to: string }): Promise<Warning[]> {
  const s = await scan(from, to)
  return [...classOverParty(s), ...classOverClass(s), ...oversold(s), ...partyOnClosedDay(s)].sort((a, b) =>
    a.when.localeCompare(b.when),
  )
}
