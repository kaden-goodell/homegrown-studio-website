import type { APIRoute } from 'astro'
import { adminActor, adminAuthorized } from '@lib/admin-auth'
import { json } from '@lib/classes/admin-actions'
import { recordAudit } from '@lib/audit'
import { createLogger } from '@lib/logger'
import { cafeSquareDeps, settingsBooked } from '@lib/settings-effects'
import { rewriteCafeWindows, type CafeSquareResult } from '@lib/cafe-windows'
import { forget } from '@lib/short-memory'
import { studioDate } from '@lib/studio-time'
import {
  addedClosures, getSettingsView, getStudioDays, saveStudioSettings, SettingsError, StaleSettingsError, toStudioDays, validateSettings,
} from '@lib/studio-settings'

export const prerender = false
const logger = createLogger('api:admin:settings')

const UNREADABLE = 'The studio settings couldn’t be reached. Try again.'

/** GET: Craft Café's hours, special days and the closed days, as saved (or the config, until an owner first saves). Owners only. */
export const GET: APIRoute = async ({ request }) => {
  if (!adminAuthorized(request)) return json(401, { error: 'Sign in first.' })
  try {
    return json(200, { data: { settings: await getSettingsView() } })
  } catch (e) {
    logger.error('Settings read failed', { error: e instanceof Error ? e.message : String(e) })
    return json(503, { error: UNREADABLE })
  }
}

/** Writes the next 90 days of café windows to Square from what's saved now. Never throws. */
async function squareFrom(days: Parameters<typeof rewriteCafeWindows>[0]): Promise<CafeSquareResult> {
  const result = await rewriteCafeWindows(days, studioDate(new Date().toISOString()), {
    ...cafeSquareDeps(),
    log: (msg, meta) => logger.info(msg, meta),
  })
  // The public calendar remembers the café windows for a minute: ask Square again next time.
  if (result.status === 'updated') forget('calendar:open-studio')
  return result
}

/**
 * POST { cafeWeekly, cafeSpecialDays, closures, expectedUpdatedAt } saves all
 * three (owners only). expectedUpdatedAt is the updatedAt the owner loaded
 * (null when the config was showing); anything newer → 409 with `current`.
 * The reply: the saved settings, what changed, anything already booked on
 * newly closed days (it stays booked; nothing is cancelled), and how the
 * Square café windows went (updated, skipped on the test site, or failed
 * with the settings still saved).
 *
 * POST { action: 'square-retry' }: write the café windows again from what's saved.
 */
export const POST: APIRoute = async ({ request }) => {
  if (!adminAuthorized(request)) return json(401, { error: 'Sign in first.' })
  const body = await request.json().catch(() => null)
  const by = adminActor(request)

  if (body?.action === 'square-retry') {
    let days
    try {
      days = await getStudioDays({ fresh: true, strict: true })
    } catch {
      return json(503, { error: UNREADABLE })
    }
    const square = await squareFrom(days)
    await recordAudit({
      by: { ...by, role: 'owner' }, action: 'studio-settings-square', target: { kind: 'settings', id: 'studio', label: 'Craft Café hours in Square' },
      details: { square: square.status },
    })
    return json(200, { data: { square } })
  }

  try {
    const input = validateSettings(body)
    if (!body || !('expectedUpdatedAt' in body) || (body.expectedUpdatedAt !== null && typeof body.expectedUpdatedAt !== 'string')) {
      throw new SettingsError(400, 'Reload the page and try again.')
    }
    const { saved, before, changed } = await saveStudioSettings(input, { expectedUpdatedAt: body.expectedUpdatedAt, by })
    await recordAudit({
      by: { ...by, role: 'owner' }, action: 'studio-settings', target: { kind: 'settings', id: 'studio', label: 'Hours & closed days' },
      details: { changed: changed.join('; ').slice(0, 500) || 'nothing' },
    })
    const added = addedClosures(before.closures, saved.closures)
    // Anything already on newly closed days stays as it is; the owners are told.
    const booked = await settingsBooked(added)
    const square = changed.length ? await squareFrom(toStudioDays(saved)) : null
    return json(200, { data: { settings: saved, changed, booked: booked.list, ...(booked.failed ? { bookedUnknown: true } : {}), square } })
  } catch (e) {
    if (e instanceof StaleSettingsError) return json(409, { error: e.message, stale: true, current: e.current })
    if (e instanceof SettingsError) return json(e.status, { error: e.message, ...(e.field ? { field: e.field } : {}) })
    logger.error('Settings save failed', { error: e instanceof Error ? e.message : String(e) })
    return json(503, { error: 'Didn’t save. Try again.' })
  }
}
