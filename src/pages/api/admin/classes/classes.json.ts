import type { APIRoute } from 'astro'
import { adminActor, adminAuthorized } from '@lib/admin-auth'
import { toIso } from '@lib/classes/validate'
import {
  ActionError, cancelClass, classesBetween, duplicateClass, json, reply, scheduleClass, updateScheduledClass,
} from '@lib/classes/admin-actions'

export const prerender = false

/** GET ?from=&to= (ISO): our classes with a session in that range, and seats taken per session. Owners only. */
export const GET: APIRoute = async ({ request, url }) => {
  if (!adminAuthorized(request)) return json(401, { error: 'Sign in first.' })
  const fromRaw = url.searchParams.get('from'), toRaw = url.searchParams.get('to')
  const from = fromRaw ? toIso(fromRaw) : null, to = toRaw ? toIso(toRaw) : null
  if ((fromRaw || toRaw) && (!from || !to)) return json(400, { error: 'Pick a start and an end for the range.' })
  return reply(async () => ({ data: await classesBetween(from ?? undefined, to ?? undefined) }))
}

/**
 * Who made the change comes from the X-Admin-Who header (see adminActor).
 * POST { action: 'create', libraryId? | content, sessions, status, alsoUpdateLibrary? } (every new class lands in the library)
 *      { action: 'duplicate', id, sessions, status? }
 *      { action: 'update', id, content?, sessions?, status?, alsoUpdateLibrary?, confirmMove? }
 *      { action: 'cancel', id }
 */
export const POST: APIRoute = async ({ request }) => {
  if (!adminAuthorized(request)) return json(401, { error: 'Sign in first.' })
  const body = await request.json().catch(() => ({}))
  const by = adminActor(request)
  return reply(async () => {
    switch (body?.action) {
      case 'create': return scheduleClass(body, by)
      case 'duplicate': return duplicateClass(body, by)
      case 'update': return updateScheduledClass(body, by)
      case 'cancel': return cancelClass(body, by)
      default: throw new ActionError(400, 'That is not something a class can do.')
    }
  })
}
