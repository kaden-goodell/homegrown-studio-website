/**
 * Background money problems in the own booking system text Kaden (and only
 * Kaden: src/config/alerts.ts), repeating until he taps "Got it", through the
 * same incidents as the checkout alarms (booking-alarms.ts). For code with no
 * request to tell the live site by (the waitlist runner, refunds, Square's
 * notices, the nightly check): only production texts; previews, branch deploys
 * and local runs stay quiet. The owners' own texts (alertOwners) are separate
 * and unchanged.
 *
 * Never throws.
 */
import { raiseIncident, resolveIncident } from '@lib/booking-alarms'
import { deployContext } from '@lib/deploy-context'
import { createLogger } from '@lib/logger'

const logger = createLogger('kaden-alarm')

function forced(): boolean {
  return typeof process !== 'undefined' && process.env.ALERTS_FORCE === '1'
}

/** Is this the live site (by Netlify's own word)? */
export function liveSiteHere(request?: Request): boolean {
  if (forced()) return true
  try {
    return deployContext(request) === 'production'
  } catch {
    return false
  }
}

/** Test seam. */
export const alarmDeps = { raiseIncident, resolveIncident, liveSiteHere }

export async function alarmKaden(key: string, text: string, opts: { request?: Request; autoResolve?: boolean } = {}): Promise<boolean> {
  try {
    if (!alarmDeps.liveSiteHere(opts.request)) return false
    return await alarmDeps.raiseIncident({ key, text, urgent: true, autoResolve: opts.autoResolve ?? false })
  } catch (err) {
    logger.error('Kaden alarm failed', { key, error: err instanceof Error ? err.message : String(err) })
    return false
  }
}

export async function alarmFixed(key: string, text: string): Promise<void> {
  try {
    if (!alarmDeps.liveSiteHere()) return
    await alarmDeps.resolveIncident(key, text)
  } catch (err) {
    logger.error('Kaden alarm resolve failed', { key, error: err instanceof Error ? err.message : String(err) })
  }
}
