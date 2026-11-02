import type { APIRoute } from 'astro'
import { adminActor, adminAuthorized } from '@lib/admin-auth'
import { recordAudit } from '@lib/audit'
import {
  addPerson, canStartFresh, editPerson, setWorking, staffListForOwners, startFresh,
  StaffInputError, StaffListUnavailable, StaleStaffError, type StaffRecord,
} from '@lib/staff-directory'
import { feedStatus, revokeFeed } from '@lib/staffing/feed-store'
import { staffingRows } from '@lib/staffing/events'
import { json, staffingFailure } from '@lib/staffing/http'
import { createLogger } from '@lib/logger'

export const prerender = false

const logger = createLogger('api:staff-people')
const DAY_MS = 86_400_000

/**
 * Owners only: our own staff list (D5), /admin › More › Staff › People.
 * GET → { people: [...with phone, email, calendar link status], saved, startedFrom }.
 *   The first look brings in the Square team once (same ids). When that
 *   fails: 503 { error, canStartFresh: true }.
 * POST
 *   { action: 'add', givenName, familyName, role, phone, email } → { person }
 *   { action: 'edit', id, givenName, familyName, role, phone, email, expectedUpdatedAt } → { person }
 *       someone else changed them first → 409 { error, stale: true, current }
 *   { action: 'leave', id } → { person } "No longer working here": kept for the
 *       record, gone from every picker, their calendar link stopped; a warning
 *       when they are still on something coming up.
 *   { action: 'return', id } → { person } "Working here again".
 *   { action: 'start-fresh' } → only when there's no list and the Square team
 *       can't be brought in: starts it with the two owners.
 * Every change is audited. Contact details only ever go to owners.
 */
export const GET: APIRoute = async ({ request }) => {
  if (!adminAuthorized(request)) return json(401, { error: 'Sign in first.' })
  try {
    const list = await staffListForOwners()
    const statuses = await Promise.all(list.people.map((p) => feedStatus({ staffId: p.id }).catch(() => null)))
    return json(200, {
      data: {
        people: list.people.map((p, i) => ({ ...p, feed: statuses[i] })),
        saved: list.saved,
        startedFrom: list.startedFrom,
      },
    })
  } catch (e) {
    if (e instanceof StaffListUnavailable) return json(503, { error: e.message, canStartFresh: await canStartFresh() })
    return staffingFailure(e)
  }
}

/** Stop someone's calendar link; false (logged) when it couldn't be stopped. */
async function stopLink(r: StaffRecord, by: { id: string; name: string }): Promise<boolean> {
  try {
    await revokeFeed({ staffId: r.id }, by)
    return true
  } catch (err) {
    logger.warn('Could not stop the calendar link of someone leaving or coming back', { error: err instanceof Error ? err.message : String(err) })
    return false
  }
}

const shown = (r: StaffRecord) => ({
  id: r.id, givenName: r.givenName, familyName: r.familyName, role: r.role, phone: r.phone, email: r.email,
  active: r.active, leftAt: r.leftAt, updatedAt: r.updatedAt,
})
const label = (r: StaffRecord) => `${r.givenName} ${r.familyName}`.trim()

/** "Jessica is still on 2 classes or parties coming up…" or null (best effort). */
async function stillOn(r: StaffRecord): Promise<string | null> {
  try {
    const now = Date.now()
    const rows = await staffingRows(new Date(now).toISOString(), new Date(now + 70 * DAY_MS).toISOString())
    const n = rows.filter((row) => row.event.status === 'on' && Date.parse(row.event.endIso) > now && row.entry?.assigned.some((a) => a.staffId === r.id)).length
    if (n === 0) return null
    return `${r.givenName} is still on ${n === 1 ? 'one class or party' : `${n} classes or parties`} coming up. They now show as needing someone. Take ${r.givenName} off in Who’s on.`
  } catch (err) {
    logger.warn('Could not check upcoming shifts of someone who left', { error: err instanceof Error ? err.message : String(err) })
    return null
  }
}

export const POST: APIRoute = async ({ request }) => {
  if (!adminAuthorized(request)) return json(401, { error: 'Sign in first.' })
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') return json(400, { error: "We couldn't read that. Try again." })
  const by = adminActor(request)
  const auditBy = { ...by, role: 'owner' as const }
  const id = typeof body.id === 'string' ? body.id : ''
  try {
    switch (body.action) {
      case 'add': {
        const r = await addPerson(body, by)
        await recordAudit({ by: auditBy, action: 'staff.add', target: { kind: 'staff', id: r.id, label: label(r) }, details: { role: r.role, phone: !!r.phone, email: !!r.email } })
        return json(200, { data: { person: shown(r) } })
      }
      case 'edit': {
        const expected = typeof body.expectedUpdatedAt === 'string' ? body.expectedUpdatedAt : undefined
        const r = await editPerson(id, body, by, expected)
        await recordAudit({ by: auditBy, action: 'staff.edit', target: { kind: 'staff', id: r.id, label: label(r) }, details: { change: r.history[0]?.change ?? '' } })
        return json(200, { data: { person: shown(r) } })
      }
      case 'leave': {
        const { person, changed } = await setWorking(id, false, by)
        let linkWarning: string | null = null
        if (changed) {
          // Their calendar link stops now (it already shows nothing while they're gone).
          // It's stopped again if they come back, so an old link never wakes up.
          if (!(await stopLink(person, by))) linkWarning = `${person.givenName}’s calendar link couldn’t be stopped just now. It shows nothing while ${person.givenName} isn’t working here, and it’s stopped for good if ${person.givenName} comes back.`
          await recordAudit({ by: auditBy, action: 'staff.leave', target: { kind: 'staff', id: person.id, label: label(person) }, details: { linkStopped: !linkWarning } })
        }
        const warning = [changed ? await stillOn(person) : null, linkWarning].filter(Boolean).join(' ')
        return json(200, { data: { person: shown(person) }, ...(warning ? { warning } : {}) })
      }
      case 'return': {
        const { person, changed } = await setWorking(id, true, by)
        let warning: string | null = null
        if (changed) {
          // An old calendar link stays stopped: they make a new one in /staff, My shifts.
          if (!(await stopLink(person, by))) warning = `${person.givenName}’s old calendar link couldn’t be stopped. Tap Stop their calendar link on ${person.givenName}’s row.`
          await recordAudit({ by: auditBy, action: 'staff.return', target: { kind: 'staff', id: person.id, label: label(person) }, details: { linkStopped: !warning } })
        }
        return json(200, { data: { person: shown(person) }, ...(warning ? { warning } : {}) })
      }
      case 'start-fresh': {
        const doc = await startFresh(by)
        await recordAudit({ by: auditBy, action: 'staff.start-fresh', target: { kind: 'staff', id: 'list', label: 'Staff list' } })
        return json(200, { data: { people: doc.people.map(shown) } })
      }
      default:
        return json(400, { error: "That isn't something the staff list can do." })
    }
  } catch (e) {
    if (e instanceof StaleStaffError) return json(409, { error: e.message, stale: true, current: shown(e.current) })
    if (e instanceof StaffInputError) return json(400, { error: e.message, field: e.field })
    if (e instanceof StaffListUnavailable) return json(503, { error: e.message, canStartFresh: true })
    return staffingFailure(e)
  }
}
