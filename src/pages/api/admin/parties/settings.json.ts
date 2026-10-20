import type { APIRoute } from 'astro'
import { adminActor, adminAuthorized } from '@lib/admin-auth'
import { recordAudit } from '@lib/audit'
import { createLogger } from '@lib/logger'
import { SettingsError } from '@lib/settings-error'
import { formatSlotLabel } from '@lib/studio-time'
import { bookedOnRemovedStarts, json, type BookedOnRemoved } from '@lib/parties/admin-actions'
import { legacyRemaining } from '@lib/parties/legacy-square'
import { validatePartySettings } from '@lib/parties/party-times'
import { getPartySettings, savePartySettings, StalePartySettingsError } from '@lib/parties/settings-store'
import { partyWritesRefusal } from '@lib/parties/test-site'

export const prerender = false
const logger = createLogger('api:admin:parties:settings')

const UNREADABLE = 'Parties setup couldn’t be reached. Try again.'
export const STILL_BOOKED = 'Anything already booked stays booked.'
const SQUARE_UNREADABLE = 'Square couldn’t be asked about parties still booked there, so reading them stays on. Try again.'

/** Parties still to come that were booked in Square: how many, and when the last one is. Null when Square can't be asked. */
async function remaining(now: Date): Promise<{ count: number; lastIso: string | null } | null> {
  try {
    const list = await legacyRemaining(now)
    const lastIso = list.map((b) => b.startIso).sort().pop() ?? null
    return { count: list.length, lastIso }
  } catch (e) {
    logger.error('Square-booked parties unreadable', { error: e instanceof Error ? e.message : String(e) })
    return null
  }
}

/**
 * GET: Parties setup as saved (or the config until an owner first saves),
 * and the parties still booked in Square (`legacyRemaining`: { count,
 * lastIso }, null when Square couldn't be asked). Owners only.
 */
export const GET: APIRoute = async ({ request }) => {
  if (!adminAuthorized(request)) return json(401, { error: 'Sign in first.' })
  try {
    const now = new Date()
    const [settings, legacy] = await Promise.all([getPartySettings({ strict: true, fresh: true }), remaining(now)])
    return json(200, { data: { settings, legacyRemaining: legacy } })
  } catch (e) {
    logger.error('Party settings read failed', { error: e instanceof Error ? e.message : String(e) })
    return json(503, { error: UNREADABLE })
  }
}

/**
 * POST { times, packages, addOns, readSquareBookings, expectedUpdatedAt }:
 * saves Parties setup. Checked against today (dated days already past are
 * kept as they are); a refusal names its field. `expectedUpdatedAt` is what
 * the owner loaded (null while the config was showing); anything newer →
 * 409 with `current`. Turning the Square read off is refused while any
 * party booked in Square is still to come (S2-R27). The reply lists our
 * parties booked on starts or days the save took away: they stay booked.
 * Never writes Square (R38).
 */
export const POST: APIRoute = async ({ request }) => {
  if (!adminAuthorized(request)) return json(401, { error: 'Sign in first.' })
  const body = await request.json().catch(() => null)
  const by = adminActor(request)
  const now = new Date()
  try {
    const refusal = partyWritesRefusal(request)
    if (refusal) return json(503, { error: refusal })
    const input = validatePartySettings(body, { now })
    if (!('expectedUpdatedAt' in body) || (body.expectedUpdatedAt !== null && typeof body.expectedUpdatedAt !== 'string')) {
      throw new SettingsError(400, 'Reload the page and try again.')
    }
    let before
    try {
      before = await getPartySettings({ strict: true, fresh: true })
    } catch {
      return json(503, { error: UNREADABLE })
    }
    if (before.readSquareBookings && !input.readSquareBookings) {
      const left = await remaining(now)
      if (!left) return json(503, { error: SQUARE_UNREADABLE, field: 'readSquareBookings' })
      if (left.count > 0) {
        const last = left.lastIso ? `, the last on ${formatSlotLabel(left.lastIso)}` : ''
        return json(409, {
          error: `${left.count === 1 ? '1 party booked in Square is' : `${left.count} parties booked in Square are`} still to come${last}. Keep reading them until they’ve run.`,
          field: 'readSquareBookings', legacyRemaining: left,
        })
      }
    }
    const { saved, changed } = await savePartySettings(input, { expectedUpdatedAt: body.expectedUpdatedAt, by, now })
    await recordAudit({
      by: { ...by, role: 'owner' }, action: 'party-settings', target: { kind: 'settings', id: 'parties', label: 'Parties setup' },
      details: { changed: changed.join('; ').slice(0, 500) || 'nothing' },
    })
    let booked: BookedOnRemoved[] = []
    let bookedUnknown = false
    try {
      booked = await bookedOnRemovedStarts(before.times, saved.times, now)
    } catch (e) {
      bookedUnknown = true
      logger.error('Party book unreadable after a settings save', { error: e instanceof Error ? e.message : String(e) })
    }
    return json(200, {
      data: {
        settings: saved, changed, booked,
        ...(booked.length || bookedUnknown ? { note: STILL_BOOKED } : {}),
        ...(bookedUnknown ? { bookedUnknown: true } : {}),
      },
    })
  } catch (e) {
    if (e instanceof StalePartySettingsError) return json(409, { error: e.message, stale: true, current: e.current })
    if (e instanceof SettingsError) return json(e.status, { error: e.message, ...(e.field ? { field: e.field } : {}) })
    logger.error('Party settings save failed', { error: e instanceof Error ? e.message : String(e) })
    return json(503, { error: 'Didn’t save. Try again.' })
  }
}
