import type { APIRoute } from 'astro'
import { adminActor, adminAuthorized } from '@lib/admin-auth'
import { json } from '@lib/classes/admin-actions'
import { recordAudit } from '@lib/audit'
import { createLogger } from '@lib/logger'
import { classWritesRefusal, TestSiteStoreError } from '@lib/classes/test-site-guard'
import { purgeBookingPages } from '@lib/booking-cache'
import {
  defaultPauseNote, getSwitchStateStrict, PAUSE_NOTE_MAX, saveSwitches, SettingsError, StaleSwitchError, validateSwitchInput, type SwitchState,
} from '@lib/booking-switch'
import { siteConfig } from '@config/site.config'

export const prerender = false
const logger = createLogger('api:admin:online-booking')

const UNREADABLE = 'Online booking couldn’t be reached just now. Try again.'

/** What /admin needs: the state, the default note, whether kits exist at all, and whether this site may save. */
function view(state: SwitchState) {
  return {
    ...state,
    defaultNote: defaultPauseNote(),
    noteMax: PAUSE_NOTE_MAX,
    kitsExist: siteConfig.features.kits.enabled,
    readOnly: !!classWritesRefusal(),
  }
}

/**
 * Owners only: /admin › More › Online booking.
 * GET  → { open: {parties, workshops, kits}, pauseNote, pauseNoteWritten, previewToken, source, updatedAt, by, history, defaultNote, noteMax, kitsExist, readOnly }
 *   source 'setup' = nothing saved here yet (the hosting settings are in force).
 */
export const GET: APIRoute = async ({ request }) => {
  if (!(await adminAuthorized(request))) return json(401, { error: 'Sign in first.' })
  try {
    return json(200, { data: view(await getSwitchStateStrict()) })
  } catch (e) {
    logger.error('Online booking switch read failed', { error: e instanceof Error ? e.message : String(e) })
    return json(503, { error: UNREADABLE })
  }
}

/**
 * POST { open: {parties, workshops, kits}, pauseNote, newTestLink?, expectedUpdatedAt }
 * Saves the switch (it beats BOOKINGS_OPEN / PREVIEW_TOKEN from now on); takes
 * effect within about 30 seconds everywhere, no redeploy. Nothing already
 * booked changes, and payment links already sent keep working. Someone else
 * saved first → 409 with `current`. Audited.
 */
export const POST: APIRoute = async ({ request }) => {
  if (!(await adminAuthorized(request))) return json(401, { error: 'Sign in first.' })
  const body = await request.json().catch(() => null)
  const by = await adminActor(request)
  try {
    const input = validateSwitchInput(body)
    if (!('expectedUpdatedAt' in body) || (body.expectedUpdatedAt !== null && typeof body.expectedUpdatedAt !== 'string')) {
      throw new SettingsError(400, 'Reload the page and try again.')
    }
    const { saved, changed } = await saveSwitches(input, { expectedUpdatedAt: body.expectedUpdatedAt, by })
    await recordAudit({
      by: { ...by, role: 'owner' }, action: 'online-booking', target: { kind: 'settings', id: 'online-booking', label: 'Online booking' },
      details: { changed: changed.join('; ').slice(0, 500) || 'nothing' },
    })
    // The kept copies of the booking pages catch up at once (best effort).
    await purgeBookingPages()
    return json(200, { data: { ...view(saved), changed } })
  } catch (e) {
    if (e instanceof StaleSwitchError) return json(409, { error: e.message, stale: true, current: view(e.current) })
    if (e instanceof SettingsError) return json(e.status, { error: e.message, ...(e.field ? { field: e.field } : {}) })
    if (e instanceof TestSiteStoreError) return json(503, { error: e.message })
    logger.error('Online booking save failed', { error: e instanceof Error ? e.message : String(e) })
    return json(503, { error: 'Didn’t save. Try again.' })
  }
}
