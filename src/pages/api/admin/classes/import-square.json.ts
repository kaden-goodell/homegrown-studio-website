import type { APIRoute } from 'astro'
import { adminActor, adminAuthorized } from '@lib/admin-auth'
import { recordAudit } from '@lib/audit'
import { json, reply } from '@lib/classes/admin-actions'
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
  const by = adminActor(request)
  return reply(async () => {
    const result = await importSquareClasses({ dryRun, by })
    if (!dryRun) {
      // The classes are added by now; a failed audit write must not report the run as failed.
      await recordAudit({
        by: { ...by, role: 'owner' },
        action: 'class-library-import-square',
        target: { kind: 'class-library', id: 'square-import' },
        details: { added: result.create.length, photos: result.addPhoto.length, skipped: result.skip.length },
      }).catch((e) => console.error(`[admin/classes] import audit not written: ${e instanceof Error ? e.message : String(e)}`))
    }
    return { data: result }
  })
}
