import type { APIRoute } from 'astro'
import { staffAuthorized } from '@lib/staff-auth'
import { listKitOrders, kitOrderToLedgerRecord, type KitOrderRecord } from '@lib/kit-store'
import { overCommittedWeeks, type LedgerRecord } from '@lib/kit-ledger'
import { addDays, assemblyWeekKeyFor, isWeekKey } from '@lib/kit-dates'
import { kitConfig } from '@config/kit.config'
import { kitThemes } from '@config/kit-content'

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
 * The assembly worksheet for one pickup week: every order due to go out that
 * Thursday (cancelled ones excluded — nothing to build), plus per-craft and
 * per-theme totals so staff can pull stock without adding up cards by hand.
 */
function assemblyFor(orders: KitOrderRecord[], weekKey: string, today: string) {
  const weekOrders = orders
    .filter((o) => o.weekKey === weekKey && o.status !== 'cancelled')
    .sort((a, b) => a.partyDate.localeCompare(b.partyDate) || a.contact.name.localeCompare(b.contact.name))

  const craftQty = new Map<string, number>()
  const themeQty = new Map<string, number>()
  for (const o of weekOrders) {
    for (const c of o.crafts) craftQty.set(c.name, (craftQty.get(c.name) ?? 0) + c.qty)
    if (o.theme) {
      const name = kitThemes.find((t) => t.id === o.theme!.themeId)?.displayName ?? o.theme.themeId
      const label = `${name} · serves ${o.theme.serves}`
      themeQty.set(label, (themeQty.get(label) ?? 0) + 1)
    }
  }

  return {
    weekKey,
    isCurrent: weekKey === assemblyWeekKeyFor(today),
    orders: weekOrders.map(publicOrder),
    craftTotals: [...craftQty].map(([name, qty]) => ({ name, qty })).sort((a, b) => b.qty - a.qty),
    themeTotals: [...themeQty].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
  }
}

/**
 * Staff-only kit operations board: every non-settled order sorted into the
 * bucket that tells staff what to DO with it today, plus recently-settled for
 * reference, an over-commitment radar for the weekly settings ledger, and the
 * assembly worksheet for one pickup week (`?assemblyWeek=YYYY-MM-DD`, a
 * Thursday; defaults to the week currently being assembled, which rolls over
 * Thursday morning).
 * GET → { data: { buckets, radar, assembly } }
 */
export const GET: APIRoute = async ({ request }) => {
  if (!staffAuthorized(request)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  const weekParam = new URL(request.url).searchParams.get('assemblyWeek')
  if (weekParam && !isWeekKey(weekParam)) {
    return new Response(JSON.stringify({ error: 'assemblyWeek must be a Thursday (YYYY-MM-DD)' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
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

  const assembly = assemblyFor(orders, weekParam ?? assemblyWeekKeyFor(today), today)

  return new Response(JSON.stringify({ data: { buckets, radar, assembly } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}
