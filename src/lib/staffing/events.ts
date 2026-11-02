/**
 * Staffable events (stage 3): the shared studio schedule joined with who can
 * work, who asked and who is on.
 *
 *   staffableBetween(from, to)  every class session (open or closed; drafts
 *       never), party and legacy Square class in the range, read from the
 *       shared schedule readers every time (a moved class takes its staff
 *       with it). Cancelled class sessions and cancelled parties are listed
 *       only while someone is on them or asked (status 'cancelled'), so
 *       owners can tell those people. Parties: booked ones, and phone
 *       bookings waiting on a payment link (they have a party record); a
 *       time held for a few minutes while someone pays is not staffable.
 *   staffingRows(from, to)  one row per event: the entry, staffed / short /
 *       none, how many are needed, and every active team member with their
 *       verdict, whether they asked and whether they are on.
 *       `onlyStaffId` (crew screens and feeds): only events that person is on
 *       or asked for, and nobody else's availability, asks, notes or history;
 *       the names of others on the same event stay ("With Catherine").
 *   orphanEntries(now)  entries with people on them whose event is cancelled
 *       or gone, from 30 days back on, for the owners' warnings.
 *
 * Every read fails loud: a source that can't be read throws, never an empty
 * "nobody's on" list. Titles never carry a customer's name; a party host's
 * first name is in `detail.hostFirst` for owner views only. Server only.
 */
import { partyConfig } from '@config/party.config'
import { sheetToken, type Sheet } from '@components/admin/shell/router'
import { listClasses } from '@lib/classes/class-store'
import { getLedger, seatsTaken } from '@lib/classes/seat-ledger'
import { legacyClassSpans, partyBusy } from '@lib/classes/studio-schedule'
import { getPartyRecord, type PartyRecord } from '@lib/party-store'
import { onSandbox } from '@lib/parties/legacy-square'
import { getPartySettings } from '@lib/parties/settings-store'
import { localDate } from '@lib/parties/party-times'
import { teamWithContacts } from '@lib/staff-directory'
import { createLogger } from '@lib/logger'
import { classWritesRefusal } from '@lib/classes/test-site-guard'
import type { ScheduledClass } from '@lib/classes/types'
import { getAvailabilityMany } from './availability-store'
import { getEntries, listAllEntryKeys, noteSeen, readPartyIndex } from './staffing-store'
import { eventKeyOf, neededFor, staffedState, verdictWithNote } from './rules'
import type { Availability, EventKey, StaffableEvent, StaffedState, StaffingEntry, Verdict } from './types'

export interface StaffPersonRow {
  staffId: string
  name: string
  verdict: Verdict
  asked: boolean
  assigned: boolean
  /** what they wrote when they asked ('' when none) */
  askNote: string
  /** the note on their "can't" for this time ("dentist"), '' when none */
  markNote: string
}

export interface StaffingRow {
  event: StaffableEvent
  entry: StaffingEntry | null
  state: StaffedState
  needed: number
  /** Assigned first, then the people who asked, then everyone else; by name within each. */
  people: StaffPersonRow[]
  /** Owner views: people still on this event who are no longer on the team (they don't count, S3-R6). Always [] for crew. */
  leftTeam: { staffId: string; name: string }[]
}

/** An event a crew member could ask to work, with whether they already asked. */
export type OpenEvent = StaffableEvent & { asked: boolean; askNote: string }

const logger = createLogger('staffing-events')
const DAY_MS = 86_400_000
/** How far a party's last-seen start may be from the range and still be checked for a cancellation (a party can move). */
const INDEX_MARGIN_MS = 62 * DAY_MS
const ORPHAN_LOOK_BACK_MS = 30 * DAY_MS
const ORPHAN_LOOK_AHEAD_MS = 366 * DAY_MS

const href = (s: Sheet): string => {
  const t = sheetToken(s)
  return t ? `#${t}` : '#calendar'
}
const overlapsRange = (startIso: string, endIso: string, from: number, to: number) =>
  Date.parse(endIso) > from && Date.parse(startIso) < to
const hasPeople = (e: StaffingEntry | undefined | null) => !!e && (e.assigned.length > 0 || e.asks.length > 0)
const firstName = (name: string | undefined | null): string | null => (name ?? '').trim().split(/\s+/)[0] || null
const partyTitle = (guests: number | undefined) =>
  typeof guests === 'number' && guests > 0 ? `Party · ${guests} ${guests === 1 ? 'guest' : 'guests'}` : 'Party'

function partyEnd(r: PartyRecord): string {
  if (r.endIso) return r.endIso
  return new Date(Date.parse(r.startIso) + (r.durationMinutes ?? partyConfig.durationMinutes) * 60_000).toISOString()
}

/** The staffing key, or null (logged) for an id that can't be a key: the event then can't be staffed. */
function keyOrSkip(b: { kind: string; id: string; sessionId?: string }): EventKey | null {
  const key = eventKeyOf(b)
  if (!key) logger.warn('An event id cannot be a staffing key; it is left off the staffing board', { kind: b.kind, id: b.id, sessionId: b.sessionId })
  return key
}

function sessionEvent(key: EventKey, c: ScheduledClass, s: ScheduledClass['sessions'][number], status: StaffableEvent['status']): StaffableEvent {
  return {
    key, kind: 'class', title: c.content.name, startIso: s.startIso, endIso: s.endIso,
    status, openHref: href({ kind: 'class', id: c.id }), detail: {},
  }
}

function partyEvent(key: EventKey, id: string, startIso: string, endIso: string, rec: PartyRecord | null, status: StaffableEvent['status']): StaffableEvent {
  return {
    key, kind: 'party', title: partyTitle(rec?.guestCount), startIso, endIso, status,
    openHref: href({ kind: 'party', day: localDate(startIso), id }),
    detail: { ...(typeof rec?.guestCount === 'number' ? { guests: rec.guestCount } : {}), hostFirst: firstName(rec?.hostName) },
  }
}

/** The events in range plus every staffing entry they have (one read of each). */
async function collect(fromIso: string, toIso: string, now: Date, opts: { seats?: boolean | EventKey } = {}): Promise<{ events: StaffableEvent[]; entries: Map<EventKey, StaffingEntry> }> {
  const from = Date.parse(fromIso), to = Date.parse(toIso)
  const [classes, parties, legacy, index] = await Promise.all([
    listClasses({ fromIso, toIso }),
    partyBusy(fromIso, toIso, now, { labels: false }),
    legacyClassSpans(fromIso, toIso),
    readPartyIndex(),
  ])

  const on: StaffableEvent[] = []
  const cancelledSessions: StaffableEvent[] = []
  const seatTargets: { ev: StaffableEvent; classId: string; sessionId: string; capacity: number }[] = []
  for (const c of classes) {
    if (c.status === 'draft') continue
    for (const s of c.sessions) {
      if (!overlapsRange(s.startIso, s.endIso, from, to)) continue
      const key = keyOrSkip({ kind: 'class', id: c.id, sessionId: s.id })
      if (!key) continue
      const ev = sessionEvent(key, c, s, c.status === 'cancelled' ? 'cancelled' : 'on')
      if (c.status === 'cancelled') cancelledSessions.push(ev)
      else {
        on.push(ev)
        seatTargets.push({ ev, classId: c.id, sessionId: s.id, capacity: s.capacity })
      }
    }
  }
  if (opts.seats) await fillSeats(opts.seats === true ? seatTargets : seatTargets.filter((t) => t.ev.key === opts.seats), now)

  const records = await Promise.all(parties.map((b) => getPartyRecord(b.id)))
  parties.forEach((b, i) => {
    const rec = records[i]
    if (rec?.status === 'cancelled') return
    // A party-book time still HELD with no record is someone paying right now
    // (a few minutes' hold): not a party yet. A BOOKED one with no record is a
    // paid party whose record didn't save: still a party to staff.
    if (b.party?.state === 'held' && !rec) return
    const key = keyOrSkip({ kind: 'party', id: b.id })
    if (key) on.push(partyEvent(key, b.id, b.startIso, b.endIso, rec, 'on'))
  })

  for (const l of legacy) {
    const key = keyOrSkip({ kind: 'legacy-class', id: l.id })
    if (!key) continue
    on.push({
      key, kind: 'legacy-class', title: l.name, startIso: l.startIso, endIso: l.endIso, status: 'on',
      openHref: href({ kind: 'legacy', day: localDate(l.startIso), id: l.id }), detail: {},
    })
  }

  // Our parties with staffing that are no longer on the schedule: maybe
  // cancelled. Only those last seen near this range (the party index), so a
  // read never grows with every party ever staffed.
  const onKeys = new Set(on.map((e) => e.key))
  const partyCandidates = Object.entries(index)
    .filter(([k, startIso]) => {
      const t = Date.parse(startIso)
      return !onKeys.has(k as EventKey) && Number.isFinite(t) && t >= from - INDEX_MARGIN_MS && t < to + INDEX_MARGIN_MS
    })
    .map(([k]) => k as EventKey)
  const entries = await getEntries([...on.map((e) => e.key), ...cancelledSessions.map((e) => e.key), ...partyCandidates])

  const cancelled = cancelledSessions.filter((e) => hasPeople(entries.get(e.key)))
  const withPeople = partyCandidates.filter((k) => hasPeople(entries.get(k)))
  const candRecords = await Promise.all(withPeople.map((k) => getPartyRecord(k.slice('party:'.length))))
  withPeople.forEach((k, i) => {
    const rec = candRecords[i]
    if (rec?.status !== 'cancelled') return
    const endIso = partyEnd(rec)
    if (overlapsRange(rec.startIso, endIso, from, to)) cancelled.push(partyEvent(k, rec.bookingId, rec.startIso, endIso, rec, 'cancelled'))
  })

  const events = [...on, ...cancelled].sort((a, b) => Date.parse(a.startIso) - Date.parse(b.startIso) || a.key.localeCompare(b.key))
  return { events, entries }
}

/** "8 of 12 seats" on each class session (owner views), from the seat ledger: one read per class. Throws when a ledger can't be read. */
async function fillSeats(targets: { ev: StaffableEvent; classId: string; sessionId: string; capacity: number }[], now: Date): Promise<void> {
  const classIds = [...new Set(targets.map((t) => t.classId))]
  const ledgers = new Map<string, Awaited<ReturnType<typeof getLedger>>>()
  for (let i = 0; i < classIds.length; i += 8) {
    const batch = classIds.slice(i, i + 8)
    const got = await Promise.all(batch.map((id) => getLedger(id)))
    got.forEach((l, j) => ledgers.set(batch[j], l))
  }
  for (const t of targets) {
    const taken = seatsTaken(ledgers.get(t.classId)!, t.sessionId, now)
    t.ev.detail = { ...t.ev.detail, seats: `${taken} of ${t.capacity} seats` }
  }
}

export async function staffableBetween(fromIso: string, toIso: string): Promise<StaffableEvent[]> {
  return (await collect(fromIso, toIso, new Date())).events
}

/** The window an ask, an assignment or a lookup by key searches: from a day back to ten weeks ahead (the screens never show further). */
export const LOOKUP_BACK_MS = DAY_MS
export const LOOKUP_AHEAD_MS = 70 * DAY_MS

/**
 * One event by its key, searched from a day back to ten weeks ahead, with its
 * entry (null when nobody touched it). Null when it isn't in that window.
 * Throws when a source can't be read.
 */
export async function eventByKey(key: EventKey, now: Date = new Date()): Promise<{ event: StaffableEvent; entry: StaffingEntry | null } | null> {
  const { events, entries } = await collect(new Date(now.getTime() - LOOKUP_BACK_MS).toISOString(), new Date(now.getTime() + LOOKUP_AHEAD_MS).toISOString(), now)
  const event = events.find((e) => e.key === key)
  return event ? { event, entry: entries.get(key) ?? null } : null
}

// ---------------------------------------------------------------- what crew may see

/** An event as crew may see it: never the party host's name. */
export function eventForCrew(e: StaffableEvent): StaffableEvent {
  const { hostFirst: _host, ...detail } = e.detail
  return { ...e, detail }
}

/** What a crew member may see of an entry: everyone on it (names), only their own ask, no history. */
function entryForCrew(e: StaffingEntry, staffId: string): StaffingEntry {
  return {
    ...e,
    assigned: e.assigned.map((a) => (a.staffId === staffId ? a : { ...a, notified: null })),
    asks: e.asks.filter((a) => a.staffId === staffId),
    history: [],
  }
}

/**
 * A row as one crew member may see it: only them in `people`, only their own
 * ask, no history, no host name, nobody's availability but theirs, no
 * left-the-team list. The one place this rule lives (screens, feeds, APIs).
 */
export function rowForCrew(row: StaffingRow, staffId: string): StaffingRow {
  return {
    ...row,
    event: eventForCrew(row.event),
    entry: row.entry ? entryForCrew(row.entry, staffId) : null,
    people: row.people.filter((p) => p.staffId === staffId),
    leftTeam: [],
  }
}

const peopleOrder = (a: StaffPersonRow, b: StaffPersonRow) =>
  Number(b.assigned) - Number(a.assigned) || Number(b.asked) - Number(a.asked) || a.name.localeCompare(b.name)

function buildRows(events: StaffableEvent[], entries: Map<EventKey, StaffingEntry>, active: { id: string; name: string }[], availability: Map<string, Availability>): StaffingRow[] {
  const activeIds = new Set(active.map((p) => p.id))
  return events.map((event) => {
    const entry = entries.get(event.key) ?? null
    const people = active.map((p): StaffPersonRow => {
      const v = verdictWithNote(availability.get(p.id) ?? null, event)
      const ask = entry?.asks.find((a) => a.staffId === p.id)
      return {
        staffId: p.id, name: p.name, verdict: v.verdict,
        asked: !!ask, assigned: !!entry?.assigned.some((a) => a.staffId === p.id),
        askNote: ask?.note ?? '', markNote: v.note,
      }
    }).sort(peopleOrder)
    return {
      event, entry,
      state: staffedState(entry, event.kind, (id) => activeIds.has(id)),
      needed: neededFor(entry, event.kind),
      people,
      leftTeam: (entry?.assigned ?? []).filter((a) => !activeIds.has(a.staffId)).map((a) => ({ staffId: a.staffId, name: a.name })),
    }
  })
}

/**
 * Owner rows for every event in range. `onlyStaffId` (crew): only events
 * that person is on or asked for, each passed through rowForCrew.
 */
export async function staffingRows(fromIso: string, toIso: string, opts: { onlyStaffId?: string; seats?: boolean } = {}): Promise<StaffingRow[]> {
  const [{ events, entries }, { people: team }] = await Promise.all([collect(fromIso, toIso, new Date(), { seats: opts.seats && !opts.onlyStaffId }), teamWithContacts()])
  const active = team.filter((p) => p.active)
  const only = opts.onlyStaffId
  const shown = only ? active.filter((p) => p.id === only) : active
  const availability = await getAvailabilityMany(shown.map((p) => p.id))
  if (!only) return buildRows(events, entries, active, availability)
  const theirs = events.filter((ev) => {
    const e = entries.get(ev.key)
    return !!(e?.assigned.some((a) => a.staffId === only) || e?.asks.some((a) => a.staffId === only))
  })
  return buildRows(theirs, entries, active, availability).map((r) => rowForCrew(r, only))
}

/**
 * One owner row by key (searched from a day back to ten weeks ahead, like
 * eventByKey), with its seat count, or null. Throws when a source or the team can't be read.
 */
export async function rowByKey(key: EventKey, now: Date = new Date()): Promise<StaffingRow | null> {
  const fromIso = new Date(now.getTime() - LOOKUP_BACK_MS).toISOString(), toIso = new Date(now.getTime() + LOOKUP_AHEAD_MS).toISOString()
  const [{ events, entries }, { people: team }] = await Promise.all([collect(fromIso, toIso, now, { seats: key }), teamWithContacts()])
  const event = events.find((e) => e.key === key)
  if (!event) return null
  const active = team.filter((p) => p.active)
  const availability = await getAvailabilityMany(active.map((p) => p.id))
  return buildRows([event], entries, active, availability)[0]
}

/** The same owner row with a just-saved entry (verdicts and names kept; who's on, who asked and the counts redone). */
export function refreshRow(row: StaffingRow, entry: StaffingEntry): StaffingRow {
  const activeIds = new Set(row.people.map((p) => p.staffId))
  const people = row.people.map((p): StaffPersonRow => {
    const ask = entry.asks.find((a) => a.staffId === p.staffId)
    return { ...p, asked: !!ask, askNote: ask?.note ?? '', assigned: entry.assigned.some((a) => a.staffId === p.staffId) }
  }).sort(peopleOrder)
  return {
    ...row, entry, people,
    state: staffedState(entry, row.event.kind, (id) => activeIds.has(id)),
    needed: neededFor(entry, row.event.kind),
    leftTeam: entry.assigned.filter((a) => !activeIds.has(a.staffId)).map((a) => ({ staffId: a.staffId, name: a.name })),
  }
}

/**
 * One crew member's view, from one read of the schedule: `mine` = rows they
 * are on (crew-safe, cancelled ones too so they hear about it); `open` =
 * events still to come that are on and not theirs, with whether they asked.
 * Nobody else's availability, asks or notes; no host names.
 */
export async function crewView(fromIso: string, toIso: string, staffId: string, now: Date = new Date()): Promise<{ mine: StaffingRow[]; open: OpenEvent[] }> {
  const [{ events, entries }, { people: team }] = await Promise.all([collect(fromIso, toIso, now), teamWithContacts()])
  const active = team.filter((p) => p.active)
  const availability = await getAvailabilityMany(active.some((p) => p.id === staffId) ? [staffId] : [])
  const isMine = (ev: StaffableEvent) => !!entries.get(ev.key)?.assigned.some((a) => a.staffId === staffId)
  const mine = buildRows(events.filter(isMine), entries, active, availability).map((r) => rowForCrew(r, staffId))
  const open = events
    .filter((ev) => ev.status === 'on' && !isMine(ev) && Date.parse(ev.startIso) > now.getTime())
    .map((ev): OpenEvent => {
      const ask = entries.get(ev.key)?.asks.find((a) => a.staffId === staffId)
      return { ...eventForCrew(ev), asked: !!ask, askNote: ask?.note ?? '' }
    })
  return { mine, open }
}

/**
 * Remembers each row's times as seen (calendar SEQUENCE goes up when an event
 * moved), for entries that exist and only when something differs. Best
 * effort: never throws, skipped on a test site sharing the live stores.
 * Updates the rows' entries in place with what was saved.
 */
export async function rememberSeen(rows: StaffingRow[]): Promise<void> {
  if (classWritesRefusal()) return
  const todo = rows.filter((r) => r.entry && r.event.status === 'on' && (
    !r.entry.seen || r.entry.seen.title !== r.event.title
    || Date.parse(r.entry.seen.startIso) !== Date.parse(r.event.startIso) || Date.parse(r.entry.seen.endIso) !== Date.parse(r.event.endIso)))
  for (let i = 0; i < todo.length; i += 4) {
    await Promise.all(todo.slice(i, i + 4).map(async (r) => {
      try {
        const saved = await noteSeen(r.event.key, { startIso: r.event.startIso, endIso: r.event.endIso, title: r.event.title })
        if (saved && r.entry) { r.entry.seen = saved.seen; r.entry.sequence = saved.sequence }
      } catch (err) {
        logger.warn('Could not note when an event was seen', { key: r.event.key, error: err instanceof Error ? err.message : String(err) })
      }
    }))
  }
}

/**
 * Entries with people on them whose event is cancelled or gone, from 30 days
 * back on. Square-booked parties and legacy Square classes are only called
 * gone when they were still to come and Square was really read for them
 * (a Square-booked party: the owners' read switch on, not the sandbox).
 */
export async function orphanEntries(now: Date): Promise<{ key: EventKey; entry: StaffingEntry; status: 'cancelled' | 'gone' }[]> {
  const fromMs = now.getTime() - ORPHAN_LOOK_BACK_MS
  const keys = await listAllEntryKeys()
  const all = await getEntries(keys)
  // Long past: by when it was last seen, or (never seen) when it was last changed.
  const lastKnown = (e: StaffingEntry) => (e.seen ? Date.parse(e.seen.endIso) : e.updatedAt ? Date.parse(e.updatedAt) : Infinity)
  const staffed = [...all.values()].filter((e) => e.assigned.length > 0 && !(lastKnown(e) < fromMs))
  if (staffed.length === 0) return []

  const { events } = await collect(new Date(fromMs).toISOString(), new Date(now.getTime() + ORPHAN_LOOK_AHEAD_MS).toISOString(), now)
  const statusOf = new Map(events.map((e) => [e.key, e.status]))
  const stillToCome = (e: StaffingEntry) => !!e.seen && Date.parse(e.seen.endIso) > now.getTime()

  let sessions: Map<string, ScheduledClass> | null = null
  const classOfSession = async (sessionId: string) => {
    if (!sessions) {
      sessions = new Map()
      for (const c of await listClasses()) for (const s of c.sessions) sessions.set(s.id, c)
    }
    return sessions.get(sessionId) ?? null
  }
  let legacyPartiesRead: boolean | null = null
  const squarePartiesRead = async () => {
    if (legacyPartiesRead === null) legacyPartiesRead = !onSandbox() && (await getPartySettings({ strict: true })).readSquareBookings
    return legacyPartiesRead
  }

  const out: { key: EventKey; entry: StaffingEntry; status: 'cancelled' | 'gone' }[] = []
  for (const entry of staffed) {
    const key = entry.key
    const known = statusOf.get(key)
    if (known === 'on') continue
    if (known === 'cancelled' || known === 'gone') { out.push({ key, entry, status: known }); continue }
    const id = key.slice(key.indexOf(':') + 1)
    if (key.startsWith('ses:')) {
      const c = await classOfSession(id)
      if (!c) out.push({ key, entry, status: 'gone' })
      else if (c.status === 'cancelled') {
        const s = c.sessions.find((x) => x.id === id)!
        if (Date.parse(s.endIso) >= fromMs) out.push({ key, entry, status: 'cancelled' })
      }
    } else if (key.startsWith('party:pty_')) {
      const rec = await getPartyRecord(id)
      if (!rec) out.push({ key, entry, status: 'gone' })
      else if (rec.status === 'cancelled' && Date.parse(partyEnd(rec)) >= fromMs) out.push({ key, entry, status: 'cancelled' })
    } else if (key.startsWith('party:')) {
      if (stillToCome(entry) && (await squarePartiesRead())) out.push({ key, entry, status: 'gone' })
    } else if (key.startsWith('legacy:')) {
      if (stillToCome(entry)) out.push({ key, entry, status: 'gone' })
    }
  }
  return out
}
