import type { APIRoute } from 'astro'
import { adminActor, adminAuthorized } from '@lib/admin-auth'
import { json } from '@lib/classes/admin-actions'
import { decide, DecideError, listToDecide, nameCounterSeats, openItem, saleAmount, undoDecision, type ToDecideItem } from '@lib/classes/to-decide'

export const prerender = false

export type { ToDecideItem }

const UNREADABLE = 'To decide couldn’t be loaded. Try again.'

/**
 * GET: the "To decide" list on /admin (Inbox › To decide, the Home counter
 * and the Inbox badge): what's waiting, then what was decided lately.
 * `incomplete` names any source that couldn't be read (the rest still show).
 * GET ?id=: one waiting item, with the counter sale's amount read from Square.
 * Owners only.
 */
export const GET: APIRoute = async ({ request, url }) => {
  if (!adminAuthorized(request)) return json(401, { error: 'Sign in first.' })
  try {
    const id = url.searchParams.get('id')
    if (id) {
      const item = await openItem(id)
      return json(200, { data: { item, amountCents: await saleAmount(item) } })
    }
    const { items, failed } = await listToDecide()
    return json(200, { data: { items }, ...(failed.length ? { warning: `Some of it couldn’t be checked: ${failed.join(', ')}.` } : {}) })
  } catch (e) {
    if (e instanceof DecideError) return json(e.status, { error: e.message, ...e.extra })
    console.error(`[admin/to-decide] ${e instanceof Error ? e.message : e}`)
    return json(503, { error: UNREADABLE })
  }
}

/**
 * POST { id, action, ... }: an owner decides one item (see
 * src/lib/classes/to-decide.ts for each kind's choices). Recorded with who.
 * POST { action: 'names', classId, names: [{ lineId, name }] }: name a
 * matched counter sale's seats.
 */
export const POST: APIRoute = async ({ request }) => {
  if (!adminAuthorized(request)) return json(401, { error: 'Sign in first.' })
  const body = await request.json().catch(() => null)
  const by = adminActor(request)
  try {
    if (body?.action === 'names') {
      const names = Array.isArray(body.names) ? body.names.filter((n: any) => typeof n?.lineId === 'string' && typeof n?.name === 'string') : []
      return json(200, { data: { named: await nameCounterSeats(typeof body.classId === 'string' ? body.classId : '', names, by) } })
    }
    if (typeof body?.id !== 'string' || typeof body?.action !== 'string') return json(400, { error: 'Pick what to do.' })
    if (body.action === 'undo') { await undoDecision(body.id, by); return json(200, { data: { undone: body.id } }) }
    return json(200, { data: await decide(body.id, body.action, body, by) })
  } catch (e) {
    if (e instanceof DecideError) return json(e.status, { error: e.message, ...e.extra })
    console.error(`[admin/to-decide] ${e instanceof Error ? e.message : e}`)
    return json(503, { error: 'Didn’t save. Try again.' })
  }
}
