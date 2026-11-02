import type { APIRoute } from 'astro'
import { adminActor, adminAuthorized } from '@lib/admin-auth'
import { json } from '@lib/classes/admin-actions'
import { recordAudit } from '@lib/audit'
import { createLogger } from '@lib/logger'
import { readerStatus, saveReaderSetting, StaleReaderSettingError } from '@lib/classes/reader-setting'
import { TestSiteStoreError } from '@lib/classes/test-site-guard'

export const prerender = false
const logger = createLogger('api:admin:reader')

/** GET (owners): Charge on the reader on or off, linked to the Square app or not. */
export const GET: APIRoute = async ({ request }) => {
  if (!adminAuthorized(request)) return json(401, { error: 'Sign in first.' })
  return json(200, { data: await readerStatus() })
}

/**
 * POST (owners) { enabled, expectedUpdatedAt }: turns it on or off at once.
 * Compare-and-set (409 when someone else just changed it), audited.
 */
export const POST: APIRoute = async ({ request }) => {
  if (!adminAuthorized(request)) return json(401, { error: 'Sign in first.' })
  const body = await request.json().catch(() => null)
  if (!body || typeof body.enabled !== 'boolean') return json(400, { error: 'Say on or off.' })
  const expected = typeof body.expectedUpdatedAt === 'string' ? body.expectedUpdatedAt : null
  const by = adminActor(request)
  try {
    const data = await saveReaderSetting(body.enabled, by, expected)
    await recordAudit({
      by: { ...by, role: 'owner' }, action: body.enabled ? 'reader.turned-on' : 'reader.turned-off',
      target: { kind: 'settings', id: 'reader', label: 'Charge on the reader' }, details: { linked: data.linked },
    })
    return json(200, { data })
  } catch (e) {
    if (e instanceof StaleReaderSettingError) return json(409, { error: e.message })
    if (e instanceof TestSiteStoreError) return json(503, { error: e.message })
    logger.error('Reader setting not saved', { error: e instanceof Error ? e.message : String(e) })
    return json(503, { error: 'That didn’t save. Try again.' })
  }
}
