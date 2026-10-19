import type { APIRoute } from 'astro'
import { adminAuthorized } from '@lib/admin-auth'
import { toIso } from '@lib/classes/validate'
import { ActionError, blockTime, json, listBlocked, reply, unblockTime } from '@lib/classes/admin-actions'

export const prerender = false

/** GET ?from=&to= (ISO): blocked time in that range (all when no range). Owners only. */
export const GET: APIRoute = async ({ request, url }) => {
  if (!adminAuthorized(request)) return json(401, { error: 'Sign in first.' })
  const fromRaw = url.searchParams.get('from'), toRaw = url.searchParams.get('to')
  const from = fromRaw ? toIso(fromRaw) : null, to = toRaw ? toIso(toRaw) : null
  if ((fromRaw || toRaw) && (!from || !to)) return json(400, { error: 'Pick a start and an end for the range.' })
  return reply(async () => ({ data: { blocked: await listBlocked(from && to ? { fromIso: from, toIso: to } : undefined) } }))
}

/**
 * POST { action: 'add', startIso, endIso, reason, confirm? } → { blocked, clashes };
 * over a class or party it is a 409 with the clashes unless confirm is true. Or { action: 'remove', id }. */
export const POST: APIRoute = async ({ request }) => {
  if (!adminAuthorized(request)) return json(401, { error: 'Sign in first.' })
  const body = await request.json().catch(() => ({}))
  return reply(async () => {
    switch (body?.action) {
      case 'add': return { data: await blockTime(body) }
      case 'remove': await unblockTime(body); return { data: { removed: body.id } }
      default: throw new ActionError(400, 'That is not something blocked time can do.')
    }
  })
}
