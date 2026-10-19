import type { APIRoute } from 'astro'
import { adminAuthorized } from '@lib/admin-auth'
import { recordAudit } from '@lib/audit'
import { ADMIN_BY, json, reply } from '@lib/classes/admin-actions'
import { importSquareClasses } from '@lib/classes/import-square'

export const prerender = false

/**
 * POST { dryRun: true }: the Square classes an import would add to the
 * library, and the ones it would leave with why. { dryRun: false } adds them.
 * Owners only. Reads Square, never writes to it, never schedules a class.
 */
export const POST: APIRoute = async ({ request }) => {
  if (!adminAuthorized(request)) return json(401, { error: 'Sign in first.' })
  const body = await request.json().catch(() => ({}))
  const dryRun = body?.dryRun !== false
  const by = ADMIN_BY
  return reply(async () => {
    const result = await importSquareClasses({ dryRun, by })
    if (!dryRun) {
      await recordAudit({
        by: { ...by, role: 'owner' },
        action: 'class-library-import-square',
        target: { kind: 'class-library', id: 'square-import' },
        details: { added: result.create.length, skipped: result.skip.length },
      })
    }
    return { data: result }
  })
}
