import type { APIRoute } from 'astro'
import { adminAuthorized } from '@lib/admin-auth'
import { createLogger } from '@lib/logger'
import { json, partyMinutesOf } from '@lib/parties/admin-actions'
import { adminPartyStarts, partyMinutes, PARTY_TIMES_UNREADABLE } from '@lib/parties/open-times'
import { getPartySettings } from '@lib/parties/settings-store'
import { getPartyRecord } from '@lib/party-store'

export const prerender = false
const logger = createLogger('api:admin:parties:times')

const YMD = /^\d{4}-\d{2}-\d{2}$/
const MAX_DAYS = 62

/**
 * GET ?from=YYYY-MM-DD&to=YYYY-MM-DD&packageId&addOns=add_x:1,add_y:2&exclude=<partyId>:
 * the party times on those studio-local days (both included) and which are
 * free, for owners: notice and window ignored, never past (R37). `exclude`:
 * a party being moved, which doesn't block itself and keeps its own length
 * (unless a package is named). Fails closed: 503 when anything can't be read.
 */
export const GET: APIRoute = async ({ request, url }) => {
  if (!adminAuthorized(request)) return json(401, { error: 'Sign in first.' })
  const from = url.searchParams.get('from') ?? ''
  const to = url.searchParams.get('to') ?? from
  if (!YMD.test(from) || !YMD.test(to) || to < from) return json(400, { error: 'Pick the days.' })
  if ((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 > MAX_DAYS) return json(400, { error: `Pick up to ${MAX_DAYS} days.` })
  const packageId = url.searchParams.get('packageId') || undefined
  const exclude = url.searchParams.get('exclude') || undefined
  const addOns: Record<string, number> = {}
  for (const part of (url.searchParams.get('addOns') ?? '').split(',').filter(Boolean)) {
    const [id, n] = part.split(':')
    const count = Number(n ?? 1)
    if (id && Number.isInteger(count) && count > 0) addOns[id] = count
  }
  try {
    let minutes: number
    const moving = exclude ? await getPartyRecord(exclude) : null
    if (exclude && !moving) return json(404, { error: 'That party does not exist.' })
    if (moving && !packageId) minutes = partyMinutesOf(moving)
    else minutes = partyMinutes(await getPartySettings({ strict: true }), { packageId, addOns })
    const view = await adminPartyStarts(from, to, { minutes, ...(exclude ? { ignorePartyId: exclude } : {}) })
    return json(200, { data: { minutes, offered: view.offered, open: view.open } })
  } catch (e) {
    logger.error('Party times unreadable (admin)', { error: e instanceof Error ? e.message : String(e) })
    return json(503, { error: PARTY_TIMES_UNREADABLE })
  }
}
