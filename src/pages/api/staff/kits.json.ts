import type { APIRoute } from 'astro'
import { staffAuthorized } from '@lib/staff-auth'
import { listKitOrders, kitOrderToLedgerRecord, type KitOrderRecord } from '@lib/kit-store'
import { overCommittedWeeks, type LedgerRecord } from '@lib/kit-ledger'
import { addDays } from '@lib/kit-dates'
import { kitConfig } from '@config/kit.config'

export const prerender = false

function studioToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: kitConfig.timezone })
}

/** Staff-facing view of an order — everything except the raw payment id. */
function publicOrder(o: KitOrderRecord) {
  const { paymentId, ...rest } = o
  return rest
}

type Row = ReturnType<typeof publicOrder>

/**
 * Staff-only kit operations board: every non-settled order sorted into the
 * bucket that tells staff what to DO with it today, plus recently-settled for
 * reference and an over-commitment radar for the weekly settings ledger.
 * GET → { data: { buckets, radar } }
 */
export const GET: APIRoute = async ({ request }) => {
  if (!staffAuthorized(request)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  const orders = await listKitOrders()
  const today = studioToday()
  const settledFloor = addDays(today, -14) // recently-settled window

  const buckets = {
    pickupToday: [] as Row[],
    awaiting: [] as Row[],
    missedPickup: [] as Row[],
    out: [] as Row[],
    dueBackToday: [] as Row[],
    overdue: [] as Row[],
    recentlySettled: [] as Row[],
  }

  for (const o of orders) {
    const row = publicOrder(o)
    if (o.status === 'upcoming') {
      if (o.pickupDate === today) buckets.pickupToday.push(row)
      else if (o.pickupDate > today) buckets.awaiting.push(row)
      else buckets.missedPickup.push(row) // pickup day passed, never handed over
    } else if (o.status === 'out') {
      if (o.returnBy < today) buckets.overdue.push(row)
      else if (o.returnBy === today) buckets.dueBackToday.push(row)
      else buckets.out.push(row)
    } else {
      // returned / cancelled / forfeited — keep the last two weeks for reference.
      const settledAt = (o.events.at(-1)?.at ?? o.createdAt).slice(0, 10)
      if (settledAt >= settledFloor) buckets.recentlySettled.push(row)
    }
  }

  const records = orders
    .map(kitOrderToLedgerRecord)
    .filter((r): r is LedgerRecord => r !== null)
  const radar = overCommittedWeeks(records, today)

  return new Response(JSON.stringify({ data: { buckets, radar } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}
