import type { APIRoute } from 'astro'
import { adminActor, adminAuthorized } from '@lib/admin-auth'
import { recordAudit } from '@lib/audit'
import { toIso } from '@lib/classes/validate'
import { everyoneWithContacts, teamWithContacts, type StaffPerson } from '@lib/staff-directory'
import type { By } from '@lib/staff-auth'
import { getEntries, updateEntry } from '@lib/staffing/staffing-store'
import { refreshRow, rememberSeen, rowByKey, staffingRows, type StaffingRow } from '@lib/staffing/events'
import { isEventKey, MAX_NEEDED, seenOf, withAssigned, withoutAssigned } from '@lib/staffing/rules'
import { storableStaffId } from '@lib/staffing/ids'
import { StaffingError } from '@lib/staffing/errors'
import { shiftDay, tellPerson } from '@lib/staffing/notify'
import { json, staffingReply } from '@lib/staffing/http'
import { staffingWarnings, UNSTAFFED_HORIZON_DAYS } from '@lib/staffing/warnings'
import { addDays } from '@lib/kit-dates'
import { studioDate } from '@lib/studio-time'
import type { Assignment, EventKey, StaffingEntry } from '@lib/staffing/types'

export const prerender = false

const DAY_MS = 86_400_000
const MAX_RANGE_MS = 70 * DAY_MS

export const NOT_FOUND = "We couldn't find that class or party. Refresh and try again."
export const WAS_CANCELLED = "That one was cancelled, so nobody can go on it. You can still take people off."
export const notOnTeam = (name: string | null) => (name ? `${name} isn't on the staff list.` : "That person isn't on the staff list.")
export const NEEDED_RANGE = `Pick a number from 0 to ${MAX_NEEDED}, or Usual.`

const auditBy = (by: By) => ({ ...by, role: 'owner' as const })
const shownTeam = (people: StaffPerson[]) => people.filter((p) => p.active).map((p) => ({ id: p.id, name: p.name, role: p.role }))
/** Owners only: how to reach each person (Call / Text on "Check with Jessica"), those who left too (`left: true`). */
const contactsOf = (people: StaffPerson[]) =>
  Object.fromEntries(people.map((p) => [p.id, { phone: p.phone, email: p.email, ...(p.active ? {} : { left: true }) }]))

/**
 * Owners only.
 * GET ?from&to (ISO, at most ten weeks) → { rows, team, teamSource }: every
 *   class session and party with who can work, who asked and who is on.
 * GET ?lines=1 → { lines }: the owners' staffing lines for today and the next
 *   13 days (nobody on, on but marked Can't, still on something cancelled),
 *   each with the event key and the /admin address that opens it, for Home.
 *   Never fails quietly: an unreadable store is one "Couldn't check staffing" line.
 * Every reply carries `contacts` ({ [staffId]: { phone, email } }, owners only).
 * GET ?key=<eventKey>[&start=<iso>] → { row } for a class or party sheet's
 *   Staff section, on any date (last week's class shows who worked it).
 *   `start` (the time the sheet shows) only helps find a Square-booked party
 *   or a legacy Square class.
 * Reading a row also remembers its times, so a moved event updates in phone calendars.
 */
export const GET: APIRoute = async ({ request, url }) => {
  if (!adminAuthorized(request)) return json(401, { error: 'Sign in first.' })
  if (url.searchParams.get('lines') === '1') {
    const now = new Date()
    const from = studioDate(now.toISOString())
    const [lines, team] = await Promise.all([
      staffingWarnings(from, addDays(from, UNSTAFFED_HORIZON_DAYS - 1), now),
      everyoneWithContacts().catch(() => null),
    ])
    return json(200, { data: { lines, contacts: team ? contactsOf(team) : {} } })
  }
  const key = url.searchParams.get('key')
  if (key !== null) {
    if (!isEventKey(key)) return json(400, { error: NOT_FOUND })
    return staffingReply(async () => {
      const [row, everyone] = await Promise.all([rowByKey(key, new Date(), url.searchParams.get('start')), everyoneWithContacts()])
      if (!row) throw new StaffingError(404, NOT_FOUND)
      await rememberSeen([row])
      return { data: { row, contacts: contactsOf(everyone) } }
    })
  }
  const from = toIso(url.searchParams.get('from')), to = toIso(url.searchParams.get('to'))
  if (!from || !to || Date.parse(to) <= Date.parse(from)) return json(400, { error: 'Pick a start and an end for the range.' })
  if (Date.parse(to) - Date.parse(from) > MAX_RANGE_MS) return json(400, { error: 'Pick ten weeks or less.' })
  return staffingReply(async () => {
    const [rows, everyone] = await Promise.all([staffingRows(from, to, { seats: true }), everyoneWithContacts()])
    await rememberSeen(rows)
    return { data: { rows, team: shownTeam(everyone), teamSource: 'local', contacts: contactsOf(everyone) } }
  })
}

/** Days of one class assigned in one go (S3-R1 "every day"): a two-week camp at most. */
const MAX_KEYS = 14
export const NOT_SAME_CLASS = "Those aren't days of the same class."

/** The keys a POST is about: `keys` (several days of one class) or `key`. Null when malformed. */
function keysOf(body: Record<string, unknown>): EventKey[] | null {
  if (Array.isArray(body.keys)) {
    const keys = body.keys
    if (keys.length < 1 || keys.length > MAX_KEYS || !keys.every(isEventKey) || new Set(keys).size !== keys.length) return null
    return keys as EventKey[]
  }
  return isEventKey(body.key) ? [body.key] : null
}

/** The start the screen showed for each key: only says where to look (the schedule is still read). */
function hintFor(body: Record<string, unknown>, key: EventKey): string | null {
  if (Array.isArray(body.keys)) {
    const h = body.hints && typeof body.hints === 'object' ? (body.hints as Record<string, unknown>)[key] : null
    return typeof h === 'string' ? h : null
  }
  return typeof body.startIso === 'string' ? body.startIso : null
}

/**
 * Owners only (crew can never do any of this, /staff has no route for it).
 *   { action: 'assign' | 'unassign', key, staffId, tell, startIso? } → { row }, maybe { warning }.
 *   { action: 'assign' | 'unassign', keys: [...], staffId, tell, hints? } → { rows }:
 *     several days of one class in one go, and ONE message listing the days.
 *     Any date works (`startIso` / `hints` only help find a Square-booked
 *     party or a legacy class). A class or party that already happened can
 *     still be changed, for the record; nobody is messaged about it.
 *     Merge-safe: two owners putting different people on at once both stay,
 *     so no stale check here. Telling the person never undoes the change.
 *   { action: 'needed', key, needed: 0..6 | null, expectedUpdatedAt } → { row };
 *     someone else changed it since the sheet loaded → 409 with the latest.
 */
export const POST: APIRoute = async ({ request }) => {
  if (!adminAuthorized(request)) return json(401, { error: 'Sign in first.' })
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') return json(400, { error: "We couldn't read that. Try again." })
  const by = adminActor(request)
  const origin = new URL(request.url).origin
  const keys = keysOf(body)
  if (!keys) return json(400, { error: NOT_FOUND })
  const many = Array.isArray(body.keys)
  const hints = new Map(keys.map((k) => [k, hintFor(body, k)]))

  switch (body.action) {
    case 'assign': return staffingReply(() => assign(keys, hints, many, body.staffId, body.tell !== false, by, origin))
    case 'unassign': return staffingReply(() => unassign(keys, hints, many, body.staffId, body.tell !== false, by, origin))
    case 'needed':
      if (many) return json(400, { error: "That isn't something the Staff section can do." })
      return staffingReply(() => setNeeded(keys[0], hints.get(keys[0]) ?? null, body.needed, body.expectedUpdatedAt, by))
    default: return json(400, { error: "That isn't something the Staff section can do." })
  }
}

async function findRow(key: EventKey, now: Date, hint: string | null): Promise<StaffingRow> {
  const row = await rowByKey(key, now, hint)
  if (!row) throw new StaffingError(404, NOT_FOUND)
  return row
}

const seenOfRow = (row: StaffingRow) => seenOf(row.event)
const upcoming = (row: StaffingRow, now: Date) => Date.parse(row.event.endIso) > now.getTime()
const sameClass = (rows: StaffingRow[]) => rows.every((r) => r.event.kind === rows[0].event.kind && r.event.title === rows[0].event.title)
export const PAST_NOT_TOLD = 'Saved for the record. Nobody was told, because it has already happened.'

/** "Mon Dec 21 and Tue Dec 22" for an owner's warning. */
function daysList(rows: StaffingRow[]): string {
  const days = rows.map((r) => shiftDay(r.event.startIso))
  return days.length <= 1 ? (days[0] ?? '') : `${days.slice(0, -1).join(', ')} and ${days[days.length - 1]}`
}

async function assign(keys: EventKey[], hints: Map<EventKey, string | null>, many: boolean, staffId: unknown, tell: boolean, by: By, origin: string) {
  const now = new Date()
  if (!storableStaffId(staffId)) throw new StaffingError(400, notOnTeam(null))
  const [{ people }, rows] = await Promise.all([teamWithContacts(), Promise.all(keys.map((k) => findRow(k, now, hints.get(k) ?? null)))])
  const person = people.find((p) => p.id === staffId && p.active)
  if (!person) throw new StaffingError(400, notOnTeam(rows.flatMap((r) => r.leftTeam).find((p) => p.staffId === staffId)?.name ?? null))
  if (rows.some((r) => r.event.status !== 'on')) throw new StaffingError(409, WAS_CANCELLED)
  if (many && !sameClass(rows)) throw new StaffingError(400, NOT_SAME_CLASS)

  const assignment: Assignment = { staffId: person.id, name: person.name, by, at: now.toISOString(), notified: null }
  const saved: StaffingEntry[] = []
  const added: StaffingRow[] = []
  for (const row of rows) {
    let wasAdded = false
    saved.push(await updateEntry(row.event.key, (e) => {
      wasAdded = !e.assigned.some((a) => a.staffId === person.id)
      return withAssigned(e, assignment)
    }, `${by.name} put ${person.name} on`, by, undefined, { event: seenOfRow(row) }))
    if (wasAdded) added.push(row)
  }

  const warnings: string[] = []
  let told: { email: boolean; text: boolean } | null = null
  let undelivered = false
  // A batch tells them about every upcoming day they're on and haven't been told about yet, not just the
  // days added now: when an earlier try saved Mon–Tue and then failed, the retry's one message lists them all (m2).
  // A single assign keeps to what was just added (a double tap never sends twice).
  const untold = (i: number) => saved[i].assigned.find((a) => a.staffId === person.id)?.notified == null
  const toTell = many
    ? rows.filter((r, i) => upcoming(r, now) && untold(i))
    : added.filter((r) => upcoming(r, now))
  if (tell && added.length > 0 && toTell.length === 0) warnings.push(PAST_NOT_TOLD)
  if (tell && toTell.length > 0) {
    // One message for every day they were just put on.
    const r = await tellPerson('on', person, toTell.map((x) => x.event), origin)
    told = { email: r.email, text: r.text }
    undelivered = r.failed
    if (r.warning) warnings.push(r.warning)
    if (r.email || r.text) {
      const how = [r.text ? 'text' : null, r.email ? 'email' : null].filter(Boolean).join(' and ')
      for (const row of toTell) {
        // Remember that they were told (best effort: the assignment already stands).
        try {
          const i = rows.indexOf(row)
          saved[i] = await updateEntry(row.event.key, (e) => ({ ...e, assigned: e.assigned.map((a) => (a.staffId === person.id ? { ...a, notified: told } : a)) }), `Told ${person.name} by ${how}`, by)
        } catch { /* the message went; only the note of it is missing */ }
      }
    }
  }
  const cant = rows.filter((r) => r.people.find((p) => p.staffId === person.id)?.verdict === 'cant')
  if (cant.length === 1 && rows.length === 1) {
    const note = cant[0].people.find((p) => p.staffId === person.id)!.markNote
    warnings.unshift(`${person.name} marked this time as Can't${note ? ` (${note})` : ''}.`)
  } else if (cant.length > 0) {
    warnings.unshift(`${person.name} marked Can't on ${daysList(cant)}.`)
  }
  for (const row of added) {
    await recordAudit({
      by: auditBy(by), action: 'staffing.assign', target: { kind: row.event.kind, id: row.event.key, label: row.event.title },
      details: { staffId: person.id, name: person.name, toldByEmail: told?.email ?? false, toldByText: told?.text ?? false, ...(upcoming(row, now) ? {} : { past: true }) },
    })
  }
  const fresh = rows.map((row, i) => refreshRow(row, saved[i]))
  const warning = warnings.length ? { warning: warnings.join(' ') } : {}
  // B5: a message that didn't go through → the sheet offers Call / Text for that person.
  const missed = undelivered ? { undelivered: { staffId: person.id, name: person.name } } : {}
  return many ? { data: { rows: fresh }, ...warning, ...missed } : { data: { row: fresh[0] }, ...warning, ...missed }
}

async function unassign(keys: EventKey[], hints: Map<EventKey, string | null>, many: boolean, staffId: unknown, tell: boolean, by: By, origin: string) {
  const now = new Date()
  if (!storableStaffId(staffId)) throw new StaffingError(400, notOnTeam(null))
  const [{ people }, rows] = await Promise.all([teamWithContacts(), Promise.all(keys.map((k) => rowByKey(k, now, hints.get(k) ?? null)))])
  // A class or party that is gone from the schedule can still have people on it: owners take them off.
  const goneKeys = keys.filter((_, i) => !rows[i])
  const stored = goneKeys.length ? await getEntries(goneKeys) : new Map<EventKey, StaffingEntry>()
  if (goneKeys.some((k) => !stored.has(k))) throw new StaffingError(404, NOT_FOUND)
  const present = rows.filter((r): r is StaffingRow => !!r)
  if (many && present.length > 1 && !sameClass(present)) throw new StaffingError(400, NOT_SAME_CLASS)
  const was = [...present.map((r) => r.entry), ...stored.values()].flatMap((e) => e?.assigned ?? []).find((a) => a.staffId === staffId)
  const name = people.find((p) => p.id === staffId)?.name ?? was?.name ?? 'that person'

  const saved: StaffingEntry[] = []
  const removed: StaffingRow[] = []
  let removedAny = false
  for (let i = 0; i < keys.length; i++) {
    const row = rows[i]
    let wasRemoved = false
    saved.push(await updateEntry(keys[i], (e) => {
      wasRemoved = e.assigned.some((a) => a.staffId === staffId)
      return withoutAssigned(e, staffId)
    }, `${by.name} took ${name} off`, by, undefined, row ? { event: seenOfRow(row) } : {}))
    if (wasRemoved) {
      removedAny = true
      if (row) removed.push(row)
    }
  }

  let warning: string | null = null
  let told: { email: boolean; text: boolean } | null = null
  let undelivered = false
  const person = people.find((p) => p.id === staffId && p.active)
  // Only tell someone still on the team, about classes or parties still on and still to come, in one message.
  const toTell = removed.filter((r) => r.event.status === 'on' && upcoming(r, now))
  if (removedAny && tell && person && toTell.length > 0) {
    const r = await tellPerson('off', person, toTell.map((x) => x.event), origin)
    told = { email: r.email, text: r.text }
    undelivered = r.failed
    warning = r.warning
  }
  for (let i = 0; i < keys.length; i++) {
    const row = rows[i]
    if (!(row ? removed.includes(row) : stored.get(keys[i])?.assigned.some((a) => a.staffId === staffId))) continue
    await recordAudit({
      by: auditBy(by), action: 'staffing.unassign', target: { kind: row?.event.kind ?? 'event', id: keys[i], label: row?.event.title ?? keys[i] },
      details: { staffId, name, toldByEmail: told?.email ?? false, toldByText: told?.text ?? false },
    })
  }
  const w = { ...(warning ? { warning } : {}), ...(undelivered && person ? { undelivered: { staffId: person.id, name: person.name } } : {}) }
  if (many) return { data: { rows: rows.map((r, i) => (r ? refreshRow(r, saved[i]) : null)), entries: saved }, ...w }
  return { data: { row: rows[0] ? refreshRow(rows[0], saved[0]) : null, entry: saved[0] }, ...w }
}

async function setNeeded(key: EventKey, hint: string | null, raw: unknown, expectedRaw: unknown, by: By) {
  const needed = raw === null ? null : raw
  if (needed !== null && (typeof needed !== 'number' || !Number.isInteger(needed) || needed < 0 || needed > MAX_NEEDED)) {
    throw new StaffingError(400, NEEDED_RANGE)
  }
  // What the sheet loaded (null = nothing saved yet); left out = no check.
  const expected = expectedRaw === undefined ? undefined : typeof expectedRaw === 'string' ? expectedRaw : null
  const row = await findRow(key, new Date(), hint)
  const change = needed === null ? `${by.name} set people needed back to usual` : `${by.name} set people needed to ${needed}`
  const entry = await updateEntry(key, (e) => ({ ...e, needed }), change, by, expected, { event: seenOfRow(row) })
  if (entry.updatedAt !== (row.entry?.updatedAt ?? null)) await recordAudit({
    by: auditBy(by), action: 'staffing.needed', target: { kind: row.event.kind, id: key, label: row.event.title },
    details: { needed },
  })
  return { data: { row: refreshRow(row, entry) } }
}
