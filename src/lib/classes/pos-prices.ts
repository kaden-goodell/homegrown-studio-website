/**
 * D4 (Kaden, 1 Nov): the door honours the early-bird. Each class's POS item
 * carries the CURRENT seat prices: the early-bird price while it runs, the
 * regular price once it ends. Saving a class sets them (admin-actions syncPos
 * → syncClassToSquare); this keeps them right when the early-bird ends at
 * Chicago midnight with nobody saving anything.
 *
 * Run by the scheduled job (/api/jobs/class-prices.json, hourly). Idempotent:
 * it writes to Square only for a class whose POS prices differ from today's,
 * and records the prices it sent on the class. Square writes go through
 * syncClassToSquare, so the test-site guards (R39/R41) apply as on any save.
 *
 * Server only.
 */
import { createLogger } from '@lib/logger'
import type { By } from '@lib/staff-auth'
import { listClasses, updateClass } from './class-store'
import { posPricesStale, syncClassToSquare } from './square-catalog'

const logger = createLogger('classes:pos-prices')
export const PRICES_BY: By = { id: 'system', name: 'Early-bird prices' }
const YEAR_MS = 400 * 86_400_000

export async function followCurrentPricesOnPos(now = new Date()): Promise<{ checked: number; updated: string[]; failed: string[] }> {
  const upcoming = await listClasses({ fromIso: now.toISOString(), toIso: new Date(now.getTime() + YEAR_MS).toISOString() })
  const stale = upcoming.filter((c) => posPricesStale(c, now))
  const updated: string[] = []
  const failed: string[] = []
  for (const cls of stale) {
    try {
      const square = await syncClassToSquare(cls, now)
      await updateClass(cls.id, { square }, PRICES_BY, 'POS prices follow the early-bird')
      updated.push(cls.id)
    } catch (err) {
      // The next run tries again; a save in /admin does the same.
      logger.error('POS prices not updated for a class — will try again next run', { classId: cls.id, error: err instanceof Error ? err.message : String(err) })
      failed.push(cls.id)
    }
  }
  return { checked: upcoming.length, updated, failed }
}
