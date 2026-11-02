import type { APIRoute } from 'astro'
import { adminActor, adminAuthorized } from '@lib/admin-auth'
import { ownerOf, ADMIN_WHO_HEADER } from '@lib/admin-who'
import { recordAudit } from '@lib/audit'
import { teamWithContacts } from '@lib/staff-directory'
import { feedStatus, makeFeed, revokeFeed } from '@lib/staffing/feed-store'
import { feedUrls } from '@lib/staffing/feed-urls'
import { storableStaffId } from '@lib/staffing/ids'
import { StaffingError } from '@lib/staffing/errors'
import { json, staffingReply } from '@lib/staffing/http'

export const prerender = false

export const PICK_WHO = 'Choose who you are at the top of /admin first.'

/**
 * Owners only. Calendar links for phones.
 * GET → { mine: status of the acting owner's whole-studio link, people: each team member's link status }.
 * POST → makes the acting owner's whole-studio link (the old one stops) and shows it once.
 * DELETE {} → stops the acting owner's link; DELETE { staffId } → stops that team member's link.
 */
export const GET: APIRoute = async ({ request }) => {
  if (!adminAuthorized(request)) return json(401, { error: 'Sign in first.' })
  const owner = ownerOf(request.headers.get(ADMIN_WHO_HEADER))
  return staffingReply(async () => {
    const { people } = await teamWithContacts()
    const active = people.filter((p) => p.active)
    const [mine, statuses] = await Promise.all([
      owner ? feedStatus({ owner }) : Promise.resolve(null),
      Promise.all(active.map((p) => feedStatus({ staffId: p.id }))),
    ])
    return { data: { mine, people: active.map((p, i) => ({ staffId: p.id, name: p.name, ...statuses[i] })) } }
  })
}

export const POST: APIRoute = async ({ request }) => {
  if (!adminAuthorized(request)) return json(401, { error: 'Sign in first.' })
  const owner = ownerOf(request.headers.get(ADMIN_WHO_HEADER))
  if (!owner) return json(400, { error: PICK_WHO })
  const by = adminActor(request)
  return staffingReply(async () => {
    const { token } = await makeFeed({ owner }, by)
    await recordAudit({ by: { ...by, role: 'owner' }, action: 'feed.make', target: { kind: 'calendar-link', id: `owner-${owner}`, label: owner } })
    return { data: feedUrls(new URL(request.url).origin, token) }
  })
}

export const DELETE: APIRoute = async ({ request }) => {
  if (!adminAuthorized(request)) return json(401, { error: 'Sign in first.' })
  const body = (await request.json().catch(() => ({}))) ?? {}
  const by = adminActor(request)
  const staffId = (body as { staffId?: unknown }).staffId
  return staffingReply(async () => {
    if (staffId !== undefined) {
      if (!storableStaffId(staffId)) throw new StaffingError(400, "That person isn't on the staff list.")
      const name = (await teamWithContacts().catch(() => ({ people: [] as { id: string; name: string }[] }))).people.find((p) => p.id === staffId)?.name ?? staffId
      await revokeFeed({ staffId }, by)
      await recordAudit({ by: { ...by, role: 'owner' }, action: 'feed.revoke', target: { kind: 'calendar-link', id: staffId, label: name } })
      return { data: { stopped: true } }
    }
    const owner = ownerOf(request.headers.get(ADMIN_WHO_HEADER))
    if (!owner) throw new StaffingError(400, PICK_WHO)
    await revokeFeed({ owner }, by)
    await recordAudit({ by: { ...by, role: 'owner' }, action: 'feed.revoke', target: { kind: 'calendar-link', id: `owner-${owner}`, label: owner } })
    return { data: { stopped: true } }
  })
}

