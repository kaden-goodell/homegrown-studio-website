import type { APIRoute } from 'astro'
import { staffAuthorized, byOf, type StaffMember } from '@lib/staff-auth'
import { isActiveStaffId } from '@lib/staff-directory'
import { recordAudit } from '@lib/audit'
import { rateLimited } from '@lib/rate-limit'
import { toIso } from '@lib/classes/validate'
import { getAvailability, saveAvailability, emptyAvailability, describeAvailabilityChange } from '@lib/staffing/availability-store'
import { updateEntry } from '@lib/staffing/staffing-store'
import { hasFeed } from '@lib/staffing/feed-store'
import { crewView, eventByKey } from '@lib/staffing/events'
import { isEventKey, MAX_NOTE, validateAvailability, withAsk, withoutAsk } from '@lib/staffing/rules'
import { StaffingError } from '@lib/staffing/errors'
import { json, staffingReply } from '@lib/staffing/http'
import { OWNERS_ASSIGN } from '@lib/staffing/crew-copy'

export const prerender = false

const DAY_MS = 86_400_000
const MAX_RANGE_MS = 70 * DAY_MS // ten weeks
const DEFAULT_AHEAD_MS = 56 * DAY_MS // eight weeks

export const NOT_ON_TEAM = "You're not on the team list any more. Ask an owner."
export { OWNERS_ASSIGN }
export const ALREADY_HAPPENED = 'That one has already happened.'
export const WAS_CANCELLED = 'That one was cancelled.'
export const NOT_FOUND = "We couldn't find that class or party. Refresh and try again."
export const ALREADY_ON = "You're already on this one."
export const TOO_MANY = "That's a lot of changes at once. Wait a minute and try again."

const OWNER_ONLY = new Set(['assign', 'unassign', 'needed'])

/** The signed-in person, checked against the team (a fallback id or someone who left can't use My shifts). */
async function who(request: Request): Promise<StaffMember | Response> {
  const me = staffAuthorized(request)
  if (!me) return json(401, { error: 'Sign in first.' })
  if (!(await isActiveStaffId(me.id))) return json(403, { error: NOT_ON_TEAM })
  return me
}

const auditBy = (me: StaffMember) => ({ id: me.id, name: me.name, role: me.role })

/**
 * GET ?from&to (ISO, at most ten weeks; default today to eight weeks on):
 * the signed-in person's own view. `mine` = what they're on (with who else
 * is on, "With Catherine"); `open` = classes and parties still to come that
 * aren't theirs, with whether they asked; their own times; whether they have
 * a calendar link. Nobody else's availability, asks or notes, and no
 * customer names.
 */
export const GET: APIRoute = async ({ request, url }) => {
  const me = await who(request)
  if (me instanceof Response) return me
  const now = new Date()
  const fromRaw = url.searchParams.get('from'), toRaw = url.searchParams.get('to')
  const from = fromRaw ? toIso(fromRaw) : new Date(now.getTime() - DAY_MS).toISOString()
  const to = toRaw ? toIso(toRaw) : new Date(now.getTime() + DEFAULT_AHEAD_MS).toISOString()
  if (!from || !to || Date.parse(to) <= Date.parse(from)) return json(400, { error: 'Pick a start and an end for the range.' })
  if (Date.parse(to) - Date.parse(from) > MAX_RANGE_MS) return json(400, { error: 'Pick ten weeks or less.' })
  return staffingReply(async () => {
    const [view, availability, feed] = await Promise.all([
      crewView(from, to, me.id, now),
      getAvailability(me.id),
      hasFeed({ staffId: me.id }),
    ])
    return {
      data: {
        me: { id: me.id, name: me.name },
        availability: availability ?? emptyAvailability(me.id, me.name),
        mine: view.mine,
        open: view.open,
        feed: { has: feed },
      },
    }
  })
}

/**
 * POST, for the signed-in person only (a `staffId` in the body is ignored):
 *   { action: 'availability', weekly, dates, expectedUpdatedAt } → their times
 *   { action: 'ask', key, note? } / { action: 'unask', key } → "I'd like to work this"
 * Putting people on, taking them off and how many are needed are /admin only (403, nothing written).
 */
export const POST: APIRoute = async ({ request }) => {
  const me = await who(request)
  if (me instanceof Response) return me
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') return json(400, { error: "We couldn't read that. Try again." })
  const action = (body as { action?: unknown }).action
  if (typeof action === 'string' && OWNER_ONLY.has(action)) return json(403, { error: OWNERS_ASSIGN })
  if (action !== 'availability' && action !== 'ask' && action !== 'unask') return json(400, { error: "That isn't something My shifts can do." })
  if (rateLimited(`staff-shifts:${me.id}`, 30, 60_000)) return json(429, { error: TOO_MANY })

  if (action === 'availability') {
    const checked = validateAvailability(body, new Date())
    if (!checked.ok) return json(400, { error: checked.error, field: checked.field })
    const expected = typeof body.expectedUpdatedAt === 'string' ? body.expectedUpdatedAt : null
    return staffingReply(async () => {
      const before = await getAvailability(me.id)
      const saved = await saveAvailability(me.id, me.name, checked.value, byOf(me), expected)
      await recordAudit({
        by: auditBy(me), action: 'staff.availability', target: { kind: 'staff', id: me.id, label: me.name },
        details: { change: describeAvailabilityChange(before, checked.value) },
      })
      return { data: { availability: saved } }
    })
  }

  const key = body.key
  if (!isEventKey(key)) return json(400, { error: NOT_FOUND })
  const note = typeof body.note === 'string' ? body.note.trim() : ''
  // The start the screen showed: only says where to look (the schedule is still read).
  const hint = typeof body.startIso === 'string' ? body.startIso : null
  if (note.length > MAX_NOTE) return json(400, { error: 'Keep the note under 120 characters.' })

  return staffingReply(async () => {
    const now = new Date()
    const found = await eventByKey(key, now, hint)
    if (!found) throw new StaffingError(404, NOT_FOUND)
    const { event, entry } = found
    if (Date.parse(event.startIso) <= now.getTime()) throw new StaffingError(409, ALREADY_HAPPENED)
    const seen = { startIso: event.startIso, endIso: event.endIso, title: event.title }
    if (action === 'ask') {
      if (event.status !== 'on') throw new StaffingError(409, WAS_CANCELLED)
      if (entry?.assigned.some((a) => a.staffId === me.id)) throw new StaffingError(409, ALREADY_ON)
      await updateEntry(key, (e) => withAsk(e, { staffId: me.id, name: me.name, at: now.toISOString(), note }), `${me.name} asked to work this`, byOf(me), undefined, { event: seen })
    } else {
      await updateEntry(key, (e) => withoutAsk(e, me.id), `${me.name} took the ask back`, byOf(me), undefined, { event: seen })
    }
    await recordAudit({
      by: auditBy(me), action: action === 'ask' ? 'staff.ask' : 'staff.unask',
      target: { kind: event.kind, id: key, label: event.title },
      details: action === 'ask' && note ? { note } : undefined,
    })
    return { data: { key, asked: action === 'ask' } }
  })
}
