/**
 * R38: each night, after midnight in Chicago, Craft Café's dated windows in
 * Square roll forward from the owners' saved hours, special days and closed
 * days (Square keeps only about eleven, so without this the café would drop
 * off the public calendar). Square is written only when the windows it would
 * get differ from what it has, only on the live site (R39), and only when the
 * café item exists. A failure emails the owners once; the next good night
 * clears it. Server only.
 */
import { makeKvStore } from '@lib/blob-store'
import { createLogger } from '@lib/logger'
import { sendEmail } from '@lib/email'
import { siteConfig } from '@config/site.config'
import { studioDate } from '@lib/studio-time'
import { getStudioDays } from '@lib/studio-settings'
import { rewriteCafeWindows, type CafeSquareResult } from '@lib/cafe-windows'
import { cafeSquareDeps, cafeWritesAllowed } from '@lib/settings-effects'

const logger = createLogger('cafe-roll')
const alerts = makeKvStore('class-alerts', 'class-alerts')
const ALERT_KEY = 'cafe-windows-failing'

export interface RollResult { status: CafeSquareResult['status'] | 'not-live'; message: string; emailed: boolean }

export async function rollCafeWindows(
  now = new Date(),
  deps: { request?: Request; square?: ReturnType<typeof cafeSquareDeps>; email?: typeof sendEmail } = {},
): Promise<RollResult> {
  if (!cafeWritesAllowed(deps.request)) return { status: 'not-live', message: 'Not the live site: Square left alone.', emailed: false }
  let result: CafeSquareResult
  try {
    const days = await getStudioDays({ strict: true, fresh: true })
    result = await rewriteCafeWindows(days, studioDate(now.toISOString()), { ...(deps.square ?? cafeSquareDeps()), log: (m, meta) => logger.info(m, meta) })
  } catch (e) {
    result = { status: 'failed', message: 'The studio settings couldn’t be read.' }
    logger.error('Café roll-forward could not read the settings', { error: e instanceof Error ? e.message : String(e) })
  }
  let emailed = false
  try {
    const was = await alerts.get(ALERT_KEY)
    if (result.status === 'failed') {
      if (!was) {
        const send = deps.email ?? sendEmail
        const line = `Craft Café’s hours didn’t roll forward in Square tonight: ${result.message}`
        const body = [line, '', 'The public calendar shows the café from Square, so it may stop showing future café days. Open /admin › More › Hours & Craft Café and save, or tell Kaden.']
        emailed = (await send({ to: siteConfig.ownerEmails.join(', '), subject: '⚠ Craft Café hours didn’t update in Square', text: body.join('\n'), html: body.filter(Boolean).map((l) => `<p>${l}</p>`).join('') })).sent
        if (emailed) await alerts.set(ALERT_KEY, JSON.stringify({ since: now.toISOString() }))
      }
    } else if (was) {
      await alerts.set(ALERT_KEY, '')
    }
  } catch (e) {
    logger.warn('Café roll-forward alert marker not kept', { error: e instanceof Error ? e.message : String(e) })
  }
  logger.info('Café roll-forward', { status: result.status, emailed })
  return { status: result.status, message: result.message, emailed }
}
