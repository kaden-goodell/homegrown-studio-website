import type { APIRoute } from 'astro'
import { kitConfig } from '@config/kit.config'
import { kitThemes } from '@config/kit-content'
import { createLogger } from '@lib/logger'
import { addDays, pickupThursdayFor, returnByFor, weekKeyFor, isOrderable } from '@lib/kit-dates'
import { availabilityFor, type LedgerRecord } from '@lib/kit-ledger'
import { listKitOrders, getWeekClaims, kitOrderToLedgerRecord } from '@lib/kit-store'

const logger = createLogger('api:kits:weeks')

/** Studio-local today (America/Chicago), YYYY-MM-DD. */
function studioToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: kitConfig.timezone })
}

export const GET: APIRoute = async ({ url }) => {
  const startTime = Date.now()

  // Never emit offeredTiers built from empty variation maps.
  if (!kitConfig.square.packageItemId) {
    return new Response(JSON.stringify({ error: 'kits not seeded' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    })
  }

  try {
    const themeFilter = url.searchParams.get('theme')
    const stocked = kitThemes.filter((t) => t.stocked && (!themeFilter || t.id === themeFilter))

    const today = studioToday()
    const now = Date.now()

    // Overdue kit orders block forward weeks in the availability math (LR-1).
    const overdueOrders: LedgerRecord[] = (await listKitOrders())
      .map(kitOrderToLedgerRecord)
      .filter((r): r is LedgerRecord => r !== null)

    // Availability is per (ledgerTheme, week); many party dates map to one week —
    // compute each combination once.
    const offeredCache = new Map<string, number[]>()
    async function offeredFor(ledgerThemeId: string, weekKey: string): Promise<number[]> {
      const key = `${ledgerThemeId}__${weekKey}`
      const hit = offeredCache.get(key)
      if (hit) return hit
      const claims = await getWeekClaims(ledgerThemeId, weekKey)
      const avail = availabilityFor(ledgerThemeId, weekKey, claims, overdueOrders, today, now)
      offeredCache.set(key, avail.offeredTiers)
      return avail.offeredTiers
    }

    const dates: {
      partyDate: string
      pickupDate: string
      returnBy: string
      themes: Record<string, number[]>
    }[] = []

    for (let i = 0; i <= kitConfig.bookingWindowDays; i++) {
      const partyDate = addDays(today, i)
      if (!isOrderable(partyDate, today)) continue

      const pickupDate = pickupThursdayFor(partyDate)
      const returnBy = returnByFor(pickupDate)
      const weekKey = weekKeyFor(partyDate)

      const themes: Record<string, number[]> = {}
      for (const t of stocked) {
        themes[t.id] = await offeredFor(t.ledgerThemeId ?? t.id, weekKey)
      }

      dates.push({ partyDate, pickupDate, returnBy, themes })
    }

    logger.info('Kit weeks computed', { duration_ms: Date.now() - startTime, dateCount: dates.length })

    return new Response(JSON.stringify({ data: { dates } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    logger.error('Failed to compute kit weeks', {
      error: error instanceof Error ? error.message : String(error),
      duration_ms: Date.now() - startTime,
    })
    return new Response(JSON.stringify({ error: 'Failed to compute availability' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
