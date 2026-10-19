import type { APIRoute } from 'astro'
import { adminAuthorized } from '@lib/admin-auth'
import { json } from '@lib/classes/admin-actions'

export const prerender = false

/** One thing that happened in Square without the owners, waiting for them to pick what it means. */
export interface ToDecideItem {
  id: string
  /** "Counter sale to match", "Refund done in Square", "Short of its minimum" */
  title: string
  /** One line of what happened. */
  head: string
  /** What to do next ("Add names"). */
  hint: string
  /** What was decided, once it was. */
  done?: string
}

/**
 * GET: the "To decide" list on /admin (Inbox › To decide and the Home counter).
 * Owners only. Empty for now: the next admin update fills it from the
 * counter sales, Square refunds and short classes it has to match.
 */
export const GET: APIRoute = async ({ request }) => {
  if (!adminAuthorized(request)) return json(401, { error: 'Sign in first.' })
  const items: ToDecideItem[] = []
  return json(200, { data: { items } })
}
