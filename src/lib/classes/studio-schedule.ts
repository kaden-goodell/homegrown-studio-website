/**
 * One shared studio schedule: the single answer to "is this time free?" for
 * every kind of booking in the one room.
 *
 *   busyBetween(from, to)  gathers everything that holds the room: our classes,
 *                          the legacy Square classes, booked parties, Craft Café,
 *                          blocked time and whole closed days. Fails closed: if
 *                          any source can't be read it throws, never "free".
 *   clashes(candidate, busy)  pure. Which of those a candidate class or party
 *                          would clash with, by the existing room rules:
 *     - party next to anything class-or-party: `partyConfig.cleanupBufferMinutes`
 *       either side (exactly that gap is fine), as `@lib/conflicts`.
 *     - class next to a class: plain overlap, unless both can share the room.
 *     - Craft Café: a class by plain overlap; a party keeps CAFE_PARTY_GAP_MINUTES
 *       either side, exactly as `partyStartsForDate` in `@lib/party-slots`.
 *     - blocked time and closed days: plain overlap, for anything.
 *   clashMessage(list)     the plain sentence an owner reads.
 *
 * All times are real instants (UTC ISO); a Chicago clock change can't shift them.
 */
import { providers } from '@config/providers'
import { siteConfig } from '@config/site.config'
import { partyConfig, CAFE_PARTY_GAP_MINUTES } from '@config/party.config'
import { closureOn } from '@config/closures'
import type { StudioDays } from '@config/studio-days'
import { cafeOn } from '@lib/cafe-days'
import { getStudioDays } from '@lib/studio-settings'
import { classSpanOf, intervalOf, overlaps, partyName, partySpanOf, type ClassSpan } from '@lib/conflicts'
import { getPartyRecord } from '@lib/party-store'
import { localDate, localToUtcISO } from '@lib/party-slots'
import { formatDay, formatTime } from '@lib/studio-time'
import { listClasses } from './class-store'
import { listBlocked } from './blocked-time'

export type BusyKind = 'class' | 'legacy-class' | 'party' | 'cafe' | 'blocked' | 'closed'
export interface Busy {
  kind: BusyKind
  /** Class id (cls_…) for our classes, so a whole class can be ignored while it moves; Square schedule id, booking id, block id, or a day key otherwise. */
  id: string
  label: string
  startIso: string
  endIso: string
  canShareRoom?: boolean
  /** Our classes only: the session (ses_…) this entry is. */
  sessionId?: string
}

export interface Candidate {
  startIso: string
  endIso: string
  kind: 'class' | 'party'
  canShareRoom?: boolean
  /** Busy entries to skip, by `id` or `sessionId` (a class moving past itself). */
  ignoreIds?: string[]
}

const iso = (ms: number) => new Date(ms).toISOString()

function dayAfter(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + 1, 12)).toISOString().slice(0, 10)
}

/** Studio-local days touched by [fromIso, toIso). */
function daysBetween(fromIso: string, toIso: string): string[] {
  const last = localDate(iso(Math.max(Date.parse(fromIso), Date.parse(toIso) - 1)))
  const out: string[] = []
  // The bound only guards a silly range.
  for (let d = localDate(fromIso); d <= last && out.length < 400; d = dayAfter(d)) out.push(d)
  return out
}

function inRange(b: { startIso: string; endIso: string }, from: number, to: number): boolean {
  return Date.parse(b.endIso) > from && Date.parse(b.startIso) < to
}

/** Our class sessions (every status but cancelled; drafts hold the room too). Throws when the store can't be read. */
export async function ourClassBusy(fromIso: string, toIso: string): Promise<Busy[]> {
  const from = Date.parse(fromIso), to = Date.parse(toIso)
  const out: Busy[] = []
  for (const c of await listClasses({ fromIso, toIso })) {
    if (c.status === 'cancelled') continue
    for (const s of c.sessions) {
      if (!inRange(s, from, to)) continue
      out.push({ kind: 'class', id: c.id, sessionId: s.id, label: c.content.name, startIso: s.startIso, endIso: s.endIso, canShareRoom: c.content.rules.canShareRoom })
    }
  }
  return out
}

/**
 * Blocked time and whole closed days (studio midnight to midnight). Throws
 * when blocked time, or the owners' closed days, can't be read. `days`: the
 * closed days in use, when the caller already loaded them.
 */
export async function blockedAndClosedBusy(fromIso: string, toIso: string, days?: StudioDays): Promise<Busy[]> {
  const from = Date.parse(fromIso), to = Date.parse(toIso)
  const [list, studio] = await Promise.all([listBlocked({ fromIso, toIso }), days ?? getStudioDays({ strict: true })])
  const blocked: Busy[] = list.map((b) => ({
    kind: 'blocked', id: b.id, label: b.reason || 'blocked time', startIso: b.startIso, endIso: b.endIso,
  }))
  const closed: Busy[] = []
  for (const day of daysBetween(fromIso, toIso)) {
    const closure = closureOn(day, studio.closures)
    if (!closure) continue
    const span = { startIso: localToUtcISO(day, '00:00'), endIso: localToUtcISO(dayAfter(day), '00:00') }
    if (inRange(span, from, to)) closed.push({ kind: 'closed', id: `closed-${day}`, label: `Closed for ${closure.name}`, ...span })
  }
  return [...blocked, ...closed]
}

/** Legacy Square classes, in-progress and sold-out ones included. Throws when they can't be read. */
export async function legacyClassSpans(fromIso: string, toIso: string): Promise<ClassSpan[]> {
  const w = providers.workshop
  const list = await (w.listAllWorkshops?.() ?? w.listWorkshops())
  const from = Date.parse(fromIso), to = Date.parse(toIso)
  return list.map(classSpanOf).filter((c) => inRange(c, from, to))
}

async function partyBusy(fromIso: string, toIso: string): Promise<Busy[]> {
  if (!providers.booking.listBookings) throw new Error('This booking provider cannot list bookings.')
  const bookings = await providers.booking.listBookings({
    startDate: fromIso,
    endDate: toIso,
    locationId: siteConfig.providers.booking.config.locationId || '',
  })
  const from = Date.parse(fromIso), to = Date.parse(toIso)
  const spans = await Promise.all(
    bookings
      .filter((b) => b.status !== 'cancelled')
      .map(async (b) => partySpanOf(b, (await getPartyRecord(b.id).catch(() => null))?.hostName)),
  )
  return spans
    .filter((p) => inRange(p, from, to))
    .map((p) => ({ kind: 'party' as const, id: p.id, label: partyName(p), startIso: p.startIso, endIso: p.endIso }))
}

function cafeBusy(fromIso: string, toIso: string, studio: StudioDays): Busy[] {
  const from = Date.parse(fromIso), to = Date.parse(toIso)
  const out: Busy[] = []
  for (const day of daysBetween(fromIso, toIso)) {
    const hours = cafeOn(day, studio)
    if (!hours) continue
    const span = { startIso: localToUtcISO(day, hours.opens), endIso: localToUtcISO(day, hours.closes) }
    if (inRange(span, from, to)) out.push({ kind: 'cafe', id: `cafe-${day}`, label: 'Craft Café', ...span })
  }
  return out
}

/**
 * Everything holding the room in [fromIso, toIso), sorted by start. Throws if
 * any source can't be read: a time is never reported free unchecked.
 */
export async function busyBetween(fromIso: string, toIso: string, days?: StudioDays): Promise<Busy[]> {
  // The owners' closed days and café hours: read once, never guessed (throws when unreadable).
  const studio = days ?? (await getStudioDays({ strict: true }))
  const [ours, legacy, parties, held] = await Promise.all([
    ourClassBusy(fromIso, toIso),
    legacyClassSpans(fromIso, toIso),
    partyBusy(fromIso, toIso),
    blockedAndClosedBusy(fromIso, toIso, studio),
  ])
  const legacyBusy: Busy[] = legacy.map((c) => ({ kind: 'legacy-class', id: c.id, label: c.name, startIso: c.startIso, endIso: c.endIso }))
  return [...ours, ...legacyBusy, ...parties, ...cafeBusy(fromIso, toIso, studio), ...held].sort(
    (a, b) => Date.parse(a.startIso) - Date.parse(b.startIso),
  )
}

/** Minutes the candidate must keep from `b` (0 = plain overlap), or null when they never clash. */
function gapNeeded(c: Candidate, b: Busy): number | null {
  switch (b.kind) {
    case 'blocked':
    case 'closed':
      return 0
    case 'cafe':
      return c.kind === 'party' ? CAFE_PARTY_GAP_MINUTES : 0
    case 'party':
      return partyConfig.cleanupBufferMinutes
    case 'class':
    case 'legacy-class':
      if (c.kind === 'party') return partyConfig.cleanupBufferMinutes
      return c.canShareRoom && b.canShareRoom ? null : 0
  }
}

/** The busy entries this candidate would clash with. Pure. */
export function clashes(candidate: Candidate, busy: Busy[]): Busy[] {
  const ignore = new Set(candidate.ignoreIds ?? [])
  const cand = intervalOf(candidate)
  return busy.filter((b) => {
    if (ignore.has(b.id) || (b.sessionId && ignore.has(b.sessionId))) return false
    const gap = gapNeeded(candidate, b)
    return gap !== null && overlaps(cand, intervalOf(b), gap)
  })
}

/** "Sun Oct 18 4 PM", studio time. */
function when(startIso: string): string {
  return `${formatDay(startIso).replace(',', '')} ${formatTime(startIso).replace(':00 ', ' ')}`
}

/** How one clash reads: "Pottery, Sun Oct 18 4 PM"; a closed day has no time. */
function clashPhrase(b: Busy): string {
  if (b.kind === 'closed') return `a day the studio is closed, ${formatDay(b.startIso).replace(',', '')}`
  return `${b.label}, ${when(b.startIso)}`
}

/** "Clashes with Kids Halloween Cookie Decorating, Sun Oct 18 4 PM." Up to three, then "and N more". */
export function clashMessage(list: Busy[]): string {
  if (list.length === 0) return ''
  const named = list.slice(0, 3).map(clashPhrase)
  const more = list.length - named.length
  if (more > 0) return `Clashes with ${named.join(', ')} and ${more} more.`
  if (named.length === 1) return `Clashes with ${named[0]}.`
  return `Clashes with ${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}.`
}
