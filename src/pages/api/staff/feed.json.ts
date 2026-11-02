import type { APIRoute } from 'astro'
import { staffAuthorized, byOf } from '@lib/staff-auth'
import { isActiveStaffId } from '@lib/staff-directory'
import { recordAudit } from '@lib/audit'
import { rateLimited } from '@lib/rate-limit'
import { makeFeed, revokeFeed } from '@lib/staffing/feed-store'
import { feedUrls } from '@lib/staffing/feed-urls'
import { json, staffingReply } from '@lib/staffing/http'

export const prerender = false

const NOT_ON_TEAM = "You're not on the team list any more. Ask an owner."

/**
 * The signed-in person's own calendar link (their shifts only).
 * POST → makes a link (or a new one; the old one stops) and shows it once.
 * DELETE → stops it.
 */
async function me(request: Request) {
  const m = staffAuthorized(request)
  if (!m) return json(401, { error: 'Sign in first.' })
  if (!(await isActiveStaffId(m.id))) return json(403, { error: NOT_ON_TEAM })
  if (rateLimited(`staff-feed:${m.id}`, 10, 60_000)) return json(429, { error: "That's a lot of new links at once. Wait a minute and try again." })
  return m
}

export const POST: APIRoute = async ({ request }) => {
  const m = await me(request)
  if (m instanceof Response) return m
  return staffingReply(async () => {
    const { token } = await makeFeed({ staffId: m.id }, byOf(m))
    await recordAudit({ by: { ...byOf(m), role: m.role }, action: 'feed.make', target: { kind: 'calendar-link', id: m.id, label: m.name } })
    return { data: feedUrls(new URL(request.url).origin, token) }
  })
}

export const DELETE: APIRoute = async ({ request }) => {
  const m = await me(request)
  if (m instanceof Response) return m
  return staffingReply(async () => {
    await revokeFeed({ staffId: m.id }, byOf(m))
    await recordAudit({ by: { ...byOf(m), role: m.role }, action: 'feed.revoke', target: { kind: 'calendar-link', id: m.id, label: m.name } })
    return { data: { stopped: true } }
  })
}
