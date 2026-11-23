/**
 * The robot customer: every WATCHDOG_EVERY_MINUTES it checks that booking can
 * still start. Light on purpose (Netlify credits): one public request for the
 * class list, then in-process reads of the payment setup, the party service
 * and Square's location. Nothing is held, booked or charged.
 *
 * Two failed runs in a row text Kaden; the next good run sends "Fixed".
 *
 * Server only.
 */
import { createLogger } from '@lib/logger'
import { makeKvStore, type KvStore } from '@lib/blob-store'
import { ALARM_STORE } from '@config/alerts'
import { raiseIncident, resolveIncident } from '@lib/booking-alarms'

const logger = createLogger('watchdog')
export const WATCHDOG_KEY = 'watchdog'
const STRIKES_KEY = 'watchdog-strikes'

export interface Check {
  name: string
  run: () => Promise<void>
}

const withTimeout = <T,>(p: Promise<T>, ms: number, what: string) =>
  Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${what} took over ${ms / 1000}s`)), ms))])

/** The real checks, against the live site. */
export function liveChecks(site: string, ask: typeof fetch = fetch): Check[] {
  return [
    {
      name: 'Class list',
      run: async () => {
        // Asked twice before it counts: at night the site is asleep (keep-warm stops at 11 PM), and the first
        // request only wakes it. Kaden, 22 Nov 2026: 2 AM "BOOKING CHECK FAILING … Class list took over 8s",
        // then "Fixed" 15 minutes later, night after night.
        const once = async () => {
          const res = await withTimeout(ask(`${site.replace(/\/$/, '')}/api/workshops.json`, { headers: { 'Cache-Control': 'no-cache' } }), 8000, 'Class list')
          if (!res.ok) throw new Error(`answered ${res.status}`)
          const body: any = await res.json().catch(() => null)
          if (!body || !Array.isArray(body.workshops)) throw new Error('answer was not a class list')
        }
        try {
          await once()
        } catch {
          await once()
        }
      },
    },
    {
      name: 'Payment setup',
      run: async () => {
        const { providers } = await import('@config/providers')
        const cfg: any = providers.payment.getClientConfig()
        if (!cfg?.appId || !cfg?.locationId) throw new Error('no Square app id or location')
      },
    },
    {
      name: 'Party service',
      run: async () => {
        const { loadPartyVariationId } = await import('@lib/party-open-dates')
        const id = await withTimeout(loadPartyVariationId(), 8000, 'Party service')
        if (!id) throw new Error('party service not found in Square')
      },
    },
    {
      name: 'Square',
      run: async () => {
        const { siteConfig } = await import('@config/site.config')
        const cfg: any = (siteConfig as any).providers?.payment?.config ?? {}
        if (!cfg.accessToken || !cfg.locationId) throw new Error('Square is not set up on the site')
        const { createSquareClient } = await import('@providers/square/client')
        const client = createSquareClient(cfg)
        await withTimeout(client.locations.get({ locationId: cfg.locationId }), 8000, 'Square')
      },
    },
  ]
}

export interface WatchdogResult { ok: boolean; failed: string[]; strikes: number; texted: boolean }

/** One run. Never throws. */
/**
 * Failed runs in a row before Kaden is texted: 2 (30 minutes) by day; 4 (an hour) from 11 PM to 6 AM studio
 * time, when nobody is booking and a slow wake-up shouldn't wake him. A real outage still texts within the hour.
 */
export function strikesNeeded(now: Date): number {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hourCycle: 'h23' }).format(now))
  return hour >= 23 || hour < 6 ? 4 : 2
}

export async function runWatchdog(checks: Check[], store: KvStore = makeKvStore(ALARM_STORE, ALARM_STORE), now: Date = new Date()): Promise<WatchdogResult> {
  const results = await Promise.allSettled(checks.map((c) => c.run()))
  const failed = results.flatMap((r, i) => (r.status === 'rejected' ? [`${checks[i].name}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`] : []))
  let strikes = 0
  try {
    strikes = Number(JSON.parse((await store.get(STRIKES_KEY)) ?? '0')) || 0
  } catch (err) {
    logger.error('Watchdog strikes unreadable', { error: String(err) })
  }
  if (failed.length === 0) {
    if (strikes > 0) await store.set(STRIKES_KEY, '0').catch(() => undefined)
    await resolveIncident(WATCHDOG_KEY, 'Fixed: the booking check passes again. Booking is working.')
    return { ok: true, failed, strikes: 0, texted: false }
  }
  strikes += 1
  await store.set(STRIKES_KEY, String(strikes)).catch((err) => logger.error('Watchdog strikes unwritable', { error: String(err) }))
  logger.error('Watchdog check failed', { strikes, failed })
  let texted = false
  if (strikes >= strikesNeeded(now)) {
    texted = await raiseIncident({
      key: WATCHDOG_KEY,
      text: `BOOKING CHECK FAILING (${strikes} checks in a row): ${failed.join('; ').slice(0, 220)}. Customers may not be able to book. Open ourhometownstudio.com/workshops to look.`,
      urgent: true,
      autoResolve: true,
    })
  }
  return { ok: false, failed, strikes, texted }
}
