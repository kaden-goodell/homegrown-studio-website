import type { APIRoute } from 'astro'
import { adminActor, adminAuthorized } from '@lib/admin-auth'
import { recordAudit } from '@lib/audit'
import { toIso } from '@lib/classes/validate'
import { teamWithContacts, type StaffPerson } from '@lib/staff-directory'
import type { By } from '@lib/staff-auth'
import { getEntries, updateEntry } from '@lib/staffing/staffing-store'
import { refreshRow, rememberSeen, rowByKey, staffingRows, type StaffingRow } from '@lib/staffing/events'
import { isEventKey, MAX_NEEDED, withAssigned, withoutAssigned } from '@lib/staffing/rules'
import { storableStaffId } from '@lib/staffing/ids'
import { StaffingError } from '@lib/staffing/errors'
import { tellPerson } from '@lib/staffing/notify'
import { json, staffingReply } from '@lib/staffing/http'
import type { Assignment, EventKey, StaffingEntry } from '@lib/staffing/types'

export const prerender = false

const DAY_MS = 86_400_000
const MAX_RANGE_MS = 70 * DAY_MS

export const NOT_FOUND = "We couldn't find that class or party. Refresh and try again."
export const ALREADY_HAPPENED = 'That one has already happened.'
export const WAS_CANCELLED = "That one was cancelled, so nobody can go on it. You can still take people off."
export const notOnTeam = (name: string | null) => (name ? `${name} isn't on the team list.` : "That person isn't on the team list.")
export const NEEDED_RANGE = `Pick a number from 0 to ${MAX_NEEDED}, or Usual.`

const auditBy = (by: By) => ({ ...by, role: 'owner' as const })
const shownTeam = (people: StaffPerson[]) => people.filter((p) => p.active).map((p) => ({ id: p.id, name: p.name, role: p.role }))

/**
 * Owners only.
 * GET ?from&to (ISO, at most ten weeks) → { rows, team, teamSource }: every
 *   class session and party with who can work, who asked and who is on.
 * GET ?key=<eventKey> → { row } for a class or party sheet's Staff section.
 * Reading a row also remembers its times, so a moved event updates in phone calendars.
 */
export const GET: APIRoute = async ({ request, url }) => {
  if (!adminAuthorized(request)) return json(401, { error: 'Sign in first.' })
  const key = url.searchParams.get('key')
  if (key !== null) {
    if (!isEventKey(key)) return json(400, { error: NOT_FOUND })
    return staffingReply(async () => {
      const row = await rowByKey(key)
      if (!row) throw new StaffingError(404, NOT_FOUND)
      await rememberSeen([row])
      return { data: { row } }
    })
  }
  const from = toIso(url.searchParams.get('from')), to = toIso(url.searchParams.get('to'))
  if (!from || !to || Date.parse(to) <= Date.parse(from)) return json(400, { error: 'Pick a start and an end for the range.' })
  if (Date.parse(to) - Date.parse(from) > MAX_RANGE_MS) return json(400, { error: 'Pick ten weeks or less.' })
  return staffingReply(async () => {
    const [rows, team] = await Promise.all([staffingRows(from, to), teamWithContacts()])
    await rememberSeen(rows)
    return { data: { rows, team: shownTeam(team.people), teamSource: team.source } }
  })
}

/**
 * Owners only (crew can never do any of this, /staff has no route for it).
 *   { action: 'assign' | 'unassign', key, staffId, tell } → { row }, maybe { warning }.
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
  const key = body.key
  if (!isEventKey(key)) return json(400, { error: NOT_FOUND })

  switch (body.action) {
    case 'assign': return staffingReply(() => assign(key, body.staffId, body.tell !== false, by, origin))
    case 'unassign': return staffingReply(() => unassign(key, body.staffId, body.tell !== false, by, origin))
    case 'needed': return staffingReply(() => setNeeded(key, body.needed, body.expectedUpdatedAt, by))
    default: return json(400, { error: "That isn't something the Staff section can do." })
  }
}

async function findRow(key: EventKey, now: Date): Promise<StaffingRow> {
  const row = await rowByKey(key, now)
  if (!row) throw new StaffingError(404, NOT_FOUND)
  return row
}

const seenOf = (row: StaffingRow) => ({ startIso: row.event.startIso, endIso: row.event.endIso, title: row.event.title })

async function assign(key: EventKey, staffId: unknown, tell: boolean, by: By, origin: string) {
  const now = new Date()
  if (!storableStaffId(staffId)) throw new StaffingError(400, notOnTeam(null))
  const [{ people }, row] = await Promise.all([teamWithContacts(), findRow(key, now)])
  const person = people.find((p) => p.id === staffId && p.active)
  if (!person) throw new StaffingError(400, notOnTeam(row.leftTeam.find((p) => p.staffId === staffId)?.name ?? null))
  if (row.event.status !== 'on') throw new StaffingError(409, WAS_CANCELLED)
  if (Date.parse(row.event.endIso) <= now.getTime()) throw new StaffingError(409, ALREADY_HAPPENED)

  let added = false
  const assignment: Assignment = { staffId: person.id, name: person.name, by, at: now.toISOString(), notified: null }
  let entry = await updateEntry(key, (e) => {
    added = !e.assigned.some((a) => a.staffId === person.id)
    return withAssigned(e, assignment)
  }, `${by.name} put ${person.name} on`, by, undefined, { event: seenOf(row) })

  const warnings: string[] = []
  let told: { email: boolean; text: boolean } | null = null
  if (added && tell) {
    const r = await tellPerson('on', person, row.event, origin)
    told = { email: r.email, text: r.text }
    if (r.warning) warnings.push(r.warning)
    if (r.email || r.text) {
      // Remember that they were told (best effort: the assignment already stands).
      try {
        entry = await updateEntry(key, (e) => ({ ...e, assigned: e.assigned.map((a) => (a.staffId === person.id ? { ...a, notified: told } : a)) }), `Told ${person.name} by ${[r.text ? 'text' : null, r.email ? 'email' : null].filter(Boolean).join(' and ')}`, by)
      } catch { /* the message went; only the note of it is missing */ }
    }
  }
  const mine = row.people.find((p) => p.staffId === person.id)
  if (mine?.verdict === 'cant') warnings.unshift(`${person.name} marked this time as Can't${mine.markNote ? ` (${mine.markNote})` : ''}.`)
  if (added) {
    await recordAudit({
      by: auditBy(by), action: 'staffing.assign', target: { kind: row.event.kind, id: key, label: row.event.title },
      details: { staffId: person.id, name: person.name, toldByEmail: told?.email ?? false, toldByText: told?.text ?? false },
    })
  }
  return { data: { row: refreshRow(row, entry) }, ...(warnings.length ? { warning: warnings.join(' ') } : {}) }
}

async function unassign(key: EventKey, staffId: unknown, tell: boolean, by: By, origin: string) {
  const now = new Date()
  if (!storableStaffId(staffId)) throw new StaffingError(400, notOnTeam(null))
  const [{ people }, row] = await Promise.all([teamWithContacts(), rowByKey(key, now)])
  // A class or party that is gone from the schedule can still have people on it: owners take them off.
  const current: StaffingEntry | undefined = row?.entry ?? (await getEntries([key])).get(key)
  const was = current?.assigned.find((a) => a.staffId === staffId)
  if (!row && !current) throw new StaffingError(404, NOT_FOUND)
  if (row && row.event.status === 'on' && Date.parse(row.event.endIso) <= now.getTime()) throw new StaffingError(409, ALREADY_HAPPENED)
  const name = people.find((p) => p.id === staffId)?.name ?? was?.name ?? 'that person'

  let removed = false
  const entry = await updateEntry(key, (e) => {
    removed = e.assigned.some((a) => a.staffId === staffId)
    return withoutAssigned(e, staffId)
  }, `${by.name} took ${name} off`, by, undefined, row ? { event: seenOf(row) } : {})

  let warning: string | null = null
  let told: { email: boolean; text: boolean } | null = null
  const person = people.find((p) => p.id === staffId && p.active)
  // Only tell someone still on the team, about a class or party still on.
  if (removed && tell && person && row && row.event.status === 'on') {
    const r = await tellPerson('off', person, row.event, origin)
    told = { email: r.email, text: r.text }
    warning = r.warning
  }
  if (removed) {
    await recordAudit({
      by: auditBy(by), action: 'staffing.unassign', target: { kind: row?.event.kind ?? 'event', id: key, label: row?.event.title ?? key },
      details: { staffId, name, toldByEmail: told?.email ?? false, toldByText: told?.text ?? false },
    })
  }
  return { data: { row: row ? refreshRow(row, entry) : null, entry }, ...(warning ? { warning } : {}) }
}

async function setNeeded(key: EventKey, raw: unknown, expectedRaw: unknown, by: By) {
  const needed = raw === null ? null : raw
  if (needed !== null && (typeof needed !== 'number' || !Number.isInteger(needed) || needed < 0 || needed > MAX_NEEDED)) {
    throw new StaffingError(400, NEEDED_RANGE)
  }
  // What the sheet loaded (null = nothing saved yet); left out = no check.
  const expected = expectedRaw === undefined ? undefined : typeof expectedRaw === 'string' ? expectedRaw : null
  const row = await findRow(key, new Date())
  const change = needed === null ? `${by.name} set people needed back to usual` : `${by.name} set people needed to ${needed}`
  const entry = await updateEntry(key, (e) => ({ ...e, needed }), change, by, expected, { event: seenOf(row) })
  if (entry.updatedAt !== (row.entry?.updatedAt ?? null)) await recordAudit({
    by: auditBy(by), action: 'staffing.needed', target: { kind: row.event.kind, id: key, label: row.event.title },
    details: { needed },
  })
  return { data: { row: refreshRow(row, entry) } }
}
