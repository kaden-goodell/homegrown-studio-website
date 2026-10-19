import type { APIRoute } from 'astro'
import { adminActor, adminAuthorized } from '@lib/admin-auth'
import { ActionError, json, libraryArchive, libraryList, libraryRestore, librarySave, reply } from '@lib/classes/admin-actions'

export const prerender = false

/** GET ?archived=1: the class library. Owners only. */
export const GET: APIRoute = async ({ request, url }) => {
  if (!adminAuthorized(request)) return json(401, { error: 'Sign in first.' })
  return reply(async () => ({ data: { library: await libraryList(url.searchParams.get('archived') === '1') } }))
}

/**
 * POST { action: 'save', id?, content, note } a new version (a new class without id);
 * { action: 'restore', id, version }; { action: 'archive', id, archived? }.
 */
export const POST: APIRoute = async ({ request }) => {
  if (!adminAuthorized(request)) return json(401, { error: 'Sign in first.' })
  const body = await request.json().catch(() => ({}))
  const by = adminActor(request)
  return reply(async () => {
    switch (body?.action) {
      case 'save': return { data: { library: await librarySave(body, by) } }
      case 'restore': return { data: { library: await libraryRestore(body, by) } }
      case 'archive': return { data: { library: await libraryArchive(body, by) } }
      default: throw new ActionError(400, 'That is not something the library can do.')
    }
  })
}
