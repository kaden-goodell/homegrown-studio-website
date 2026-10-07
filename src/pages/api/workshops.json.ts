import type { APIRoute } from 'astro'
import { providers } from '@config/providers'
import { toWorkshopData, withSignupInfo } from '@components/workshops/workshop-view-model'
import type { WorkshopData } from '@components/workshops/WorkshopExplorer'
import { getEventMeta } from '@lib/event-meta'
import type { CutoffSettings } from '@lib/seat-options'
import { createLogger } from '@lib/logger'
import { remember } from '@lib/short-memory'
import { publicListHeaders } from '@lib/cache-headers'

export const prerender = false
const logger = createLogger('api:workshops')

/**
 * A class's questions and cutoff from event-meta — merged here, not in the
 * provider (spec B). Unreadable settings list the class as plain (`ok: false`,
 * so the list is never cached); the booking server reads them again and
 * refuses rather than sell seats without picks.
 */
async function settingsFor(scheduleId: string): Promise<{ ok: boolean; settings: CutoffSettings; error?: string }> {
  try {
    const meta = await getEventMeta('workshop', scheduleId)
    return { ok: true, settings: { options: meta?.options ?? [], signupCutoffHours: meta?.signupCutoffHours ?? null } }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    logger.error('Event settings unreadable for the workshop list', { scheduleId, error })
    return { ok: false, settings: { options: [], signupCutoffHours: null }, error }
  }
}

/**
 * Returns the upcoming workshops. Fetched client-side by WorkshopExplorer so the
 * /workshops page shell renders instantly instead of blocking on the (sometimes
 * slow) Square Classes API during navigation.
 */
export const GET: APIRoute = async ({ request }) => {
  let workshops: WorkshopData[] = []
  let failed = false
  // Infrastructure messages only (no secrets): lets a broken preview say why.
  const settingsErrors: { scheduleId: string; error: string }[] = []
  try {
    const list = await remember('workshops:list', 30_000, () => providers.workshop.listWorkshops())
    const now = new Date()
    workshops = await Promise.all(
      list.map(async (w) => {
        const { ok, settings, error } = await settingsFor(w.scheduleId)
        if (!ok) {
          failed = true
          settingsErrors.push({ scheduleId: w.scheduleId, error: error ?? 'unknown' })
        }
        return withSignupInfo(toWorkshopData(w), settings, now)
      }),
    )
  } catch (err) {
    failed = true
    logger.error('workshops fetch failed', { error: err instanceof Error ? err.message : String(err) })
  }
  return new Response(JSON.stringify({ workshops, ...(failed ? { incomplete: true } : {}), ...(settingsErrors.length ? { settingsErrors } : {}) }), {
    status: 200,
    // A failed lookup is never cached: it must not read as "no workshops", nor
    // keep a class listed without its questions.
    headers: publicListHeaders(request, { failed }),
  })
}
