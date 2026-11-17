import type { APIRoute } from 'astro'
import { adminAuthorized } from '@lib/admin-auth'
import { json } from '@lib/classes/admin-actions'
import { legacyClassCounts, legacyFamilies, type SquareClassFamily } from '@lib/classes/legacy-class-details'

export const prerender = false

export interface LegacyClassView {
  booked?: number
  capacity?: number
  remaining?: number
  priceCents?: number
  /** Who is booked, with their waiver; null when the list couldn't be read (the counts still show). */
  families: SquareClassFamily[] | null
}

/**
 * GET ?id=<Square class schedule id>: what /admin shows for a class still run
 * from Square (Kaden, 17 Nov 2026): seats booked of the class's size, seats
 * left, the price per seat, and who is booked with their waiver status, by
 * the class-day reminder's own rules. Owners only. Read only: nothing in
 * Square or on file changes. LEGACY: goes with the last Square class.
 */
export const GET: APIRoute = async ({ request, url }) => {
  if (!(await adminAuthorized(request))) return json(401, { error: 'Sign in first.' })
  const id = url.searchParams.get('id') ?? ''
  if (!/^[\w-]{1,80}$/.test(id) || id.startsWith('cls_')) return json(400, { error: 'Pick a class from Square.' })
  const [counts, families] = await Promise.all([
    legacyClassCounts(id),
    legacyFamilies(id).catch((e) => {
      console.error(`[admin/classes/legacy] ${e instanceof Error ? e.message : e}`)
      return null
    }),
  ])
  const view: LegacyClassView = { ...counts, families }
  return json(200, { data: view })
}
