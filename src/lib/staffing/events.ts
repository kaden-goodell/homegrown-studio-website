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
import { legacyClassSpans, partyBusy } from '@lib/classes/studio-schedule'
import { getPartyRecord, type PartyRecord } from '@lib/party-store'
import { onSandbox } from '@lib/parties/legacy-square'
import { getPartySettings } from '@lib/parties/settings-store'
import { localDate } from '@lib/parties/party-times'
import { teamWithContacts } from '@lib/staff-directory'
import type { ScheduledClass } from '@lib/classes/types'
import { getAvailabilityMany } from './availability-store'
import { getEntries, listAllEntryKeys } from './staffing-store'
import { neededFor, staffedState, verdict } from './rules'
import type { EventKey, StaffableEvent, StaffedState, StaffingEntry, Verdict } from './types'

export interface StaffingRow {
  event: StaffableEvent
  entry: StaffingEntry | null
  state: StaffedState
  needed: number
  people: { staffId: string; name: string; verdict: Verdict; asked: boolean; assigned: boolean }[]
  /** Owner views: people still on this event who are no longer on the team (they don't count, S3-R6). Always [] for crew. */
  leftTeam: { staffId: string; name: string }[]
}

const DAY_MS = 86_400_000
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

function sessionEvent(c: ScheduledClass, s: ScheduledClass['sessions'][number], status: StaffableEvent['status']): StaffableEvent {
  return {
    key: `ses:${s.id}`, kind: 'class', title: c.content.name, startIso: s.startIso, endIso: s.endIso,
    status, openHref: href({ kind: 'class', id: c.id }), detail: {},
  }
}

function partyEvent(id: string, startIso: string, endIso: string, rec: PartyRecord | null, status: StaffableEvent['status']): StaffableEvent {
  return {
    key: `party:${id}`, kind: 'party', title: partyTitle(rec?.guestCount), startIso, endIso, status,
    openHref: href({ kind: 'party', day: localDate(startIso), id }),
    detail: { ...(typeof rec?.guestCount === 'number' ? { guests: rec.guestCount } : {}), hostFirst: firstName(rec?.hostName) },
  }
}

/** The events in range plus every staffing entry they have (one read of each). */
async function collect(fromIso: string, toIso: string, now: Date): Promise<{ events: StaffableEvent[]; entries: Map<EventKey, StaffingEntry> }> {
  const from = Date.parse(fromIso), to = Date.parse(toIso)
  const [classes, parties, legacy, allKeys] = await Promise.all([
    listClasses({ fromIso, toIso }),
    partyBusy(fromIso, toIso, now, { labels: false }),
    legacyClassSpans(fromIso, toIso),
    listAllEntryKeys(),
  ])

  const on: StaffableEvent[] = []
  const cancelledSessions: StaffableEvent[] = []
  for (const c of classes) {
    if (c.status === 'draft') continue
    for (const s of c.sessions) {
      if (!overlapsRange(s.startIso, s.endIso, from, to)) continue
      if (c.status === 'cancelled') cancelledSessions.push(sessionEvent(c, s, 'cancelled'))
      else on.push(sessionEvent(c, s, 'on'))
    }
  }

  const records = await Promise.all(parties.map((b) => getPartyRecord(b.id)))
  parties.forEach((b, i) => {
    const rec = records[i]
    if (rec?.status === 'cancelled') return
    // A party-book time with no record is someone paying right now (a few minutes' hold): not a party yet.
    if (b.party && !rec) return
    on.push(partyEvent(b.id, b.startIso, b.endIso, rec, 'on'))
  })

  for (const l of legacy) {
    on.push({
      key: `legacy:${l.id}`, kind: 'legacy-class', title: l.name, startIso: l.startIso, endIso: l.endIso, status: 'on',
      openHref: href({ kind: 'legacy', day: localDate(l.startIso), id: l.id }), detail: {},
    })
  }

  // Our parties with staffing that are no longer on the schedule: maybe cancelled.
  const onKeys = new Set(on.map((e) => e.key))
  const partyCandidates = allKeys.filter((k) => k.startsWith('party:pty_') && !onKeys.has(k))
  const entries = await getEntries([...on.map((e) => e.key), ...cancelledSessions.map((e) => e.key), ...partyCandidates])

  const cancelled = cancelledSessions.filter((e) => hasPeople(entries.get(e.key)))
  const withPeople = partyCandidates.filter((k) => hasPeople(entries.get(k)))
  const candRecords = await Promise.all(withPeople.map((k) => getPartyRecord(k.slice('party:'.length))))
  withPeople.forEach((k, i) => {
    const rec = candRecords[i]
    if (rec?.status !== 'cancelled') return
    const endIso = partyEnd(rec)
    if (overlapsRange(rec.startIso, endIso, from, to)) cancelled.push(partyEvent(rec.bookingId, rec.startIso, endIso, rec, 'cancelled'))
  })

  const events = [...on, ...cancelled].sort((a, b) => Date.parse(a.startIso) - Date.parse(b.startIso) || a.key.localeCompare(b.key))
  return { events, entries }
}

export async function staffableBetween(fromIso: string, toIso: string): Promise<StaffableEvent[]> {
  return (await collect(fromIso, toIso, new Date())).events
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

export async function staffingRows(fromIso: string, toIso: string, opts: { onlyStaffId?: string } = {}): Promise<StaffingRow[]> {
  const [{ events, entries }, { people: team }] = await Promise.all([collect(fromIso, toIso, new Date()), teamWithContacts()])
  const active = team.filter((p) => p.active)
  const activeIds = new Set(active.map((p) => p.id))
  const only = opts.onlyStaffId
  const shown = only ? active.filter((p) => p.id === only) : active
  const availability = await getAvailabilityMany(shown.map((p) => p.id))

  const rows: StaffingRow[] = []
  for (const event of events) {
    const entry = entries.get(event.key) ?? null
    if (only && !(entry?.assigned.some((a) => a.staffId === only) || entry?.asks.some((a) => a.staffId === only))) continue
    const people = shown.map((p) => ({
      staffId: p.id,
      name: p.name,
      verdict: verdict(availability.get(p.id) ?? null, event),
      asked: !!entry?.asks.some((a) => a.staffId === p.id),
      assigned: !!entry?.assigned.some((a) => a.staffId === p.id),
    }))
    rows.push({
      event: only ? { ...event, detail: { ...event.detail, hostFirst: undefined } } : event,
      entry: entry && only ? entryForCrew(entry, only) : entry,
      state: staffedState(entry, event.kind, (id) => activeIds.has(id)),
      needed: neededFor(entry, event.kind),
      people,
      leftTeam: only ? [] : (entry?.assigned ?? []).filter((a) => !activeIds.has(a.staffId)).map((a) => ({ staffId: a.staffId, name: a.name })),
    })
  }
  return rows
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
  const staffed = [...all.values()].filter((e) => e.assigned.length > 0 && !(e.seen && Date.parse(e.seen.endIso) < fromMs))
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
