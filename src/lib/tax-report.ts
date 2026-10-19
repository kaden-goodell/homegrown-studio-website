/**
 * The monthly tax split (Kaden, 11 Oct 2026): Square adds its 9% "Tax" to
 * everything; what it collects on classes, Craft Café crafts and parties is
 * reported as USE tax, and on take-home kits as SALES tax. Square's own
 * report lumps it together, so this sorts each line by what was sold.
 *
 * Read-only. Emailed on the 1st by netlify/functions/tax-report.ts.
 */
import type { SquareConfig } from '@config/site.config'

export type Bucket = 'classes' | 'cafe' | 'parties' | 'kits' | 'other'

export const BUCKET_LABEL: Record<Bucket, string> = {
  classes: 'Classes & workshops',
  cafe: 'Craft Café & party crafts',
  parties: 'Party studio fees',
  kits: 'Take-home kits',
  other: 'Not linked to an item (custom amounts)',
}

/** Which tax each bucket is reported as. `other` is left for a person to place. */
export const BUCKET_TAX: Record<Bucket, 'use' | 'sales' | 'unsure'> = {
  classes: 'use', cafe: 'use', parties: 'use', kits: 'sales', other: 'unsure',
}

export interface ItemInfo { productType: string; categoryNames: string[]; /** In our Square "Classes" category (SQUARE_CLASSES_CATEGORY_ID). */ inClasses?: boolean }
export type CatalogIndex = Map<string, ItemInfo> // variation id → item

export interface Totals { salesCents: number; taxCents: number; lines: number }
export type TaxSummary = Record<Bucket, Totals>

/** The studio fee line on a party order is ad hoc (no catalog item); matched by name. */
export const PARTY_FEE_PREFIX = 'Whole Studio Party'

export function bucketFor(info: ItemInfo | undefined, lineName?: string): Bucket {
  if (!info) return lineName?.startsWith(PARTY_FEE_PREFIX) ? 'parties' : 'other'
  if (info.categoryNames.some((c) => /take-home kits/i.test(c))) return 'kits'
  if (info.inClasses || info.productType === 'CLASS_TICKET') return 'classes'
  if (info.productType === 'APPOINTMENTS_SERVICE') return 'parties'
  return 'cafe'
}

const cents = (m: any) => (typeof m?.amount === 'number' ? m.amount : 0)

/**
 * Sales (before tax) and tax per bucket, refunds in the month taken off.
 * Square files a refund as its own order of "returns". An itemized return
 * names its items; a plain one (a register refund, the Refunds API) is a
 * custom amount, so it takes the same share off every line of the original
 * sale (`sources`: orders refunded this month that were sold in another).
 */
export function summarizeTax(orders: any[], index: CatalogIndex, sources: Map<string, any> = new Map()): TaxSummary {
  const empty = (): Totals => ({ salesCents: 0, taxCents: 0, lines: 0 })
  const out: TaxSummary = { classes: empty(), cafe: empty(), parties: empty(), kits: empty(), other: empty() }
  const byId = new Map<string, any>([...sources, ...orders.filter((o) => o.id).map((o) => [o.id, o] as [string, any])])
  const add = (catalogId: string | undefined, totalCents: number, taxCentsAmt: number, sign: 1 | -1, countLine: boolean, name?: string) => {
    const b = out[bucketFor(index.get(catalogId ?? ''), name)]
    b.taxCents += sign * taxCentsAmt
    b.salesCents += sign * (totalCents - taxCentsAmt)
    if (countLine) b.lines += 1
  }
  for (const order of orders) {
    for (const line of order.line_items ?? []) add(line.catalog_object_id, cents(line.total_money), cents(line.total_tax_money), 1, true, line.name)
    for (const ret of order.returns ?? []) {
      for (const line of ret.return_line_items ?? []) {
        const source = byId.get(ret.source_order_id)
        if (line.catalog_object_id || !source || !cents(source.total_money)) {
          add(line.catalog_object_id, cents(line.total_money), cents(line.total_tax_money), -1, false, line.name)
          continue
        }
        const share = Math.min(1, cents(line.total_money) / cents(source.total_money))
        for (const sold of source.line_items ?? []) {
          add(sold.catalog_object_id, Math.round(cents(sold.total_money) * share), Math.round(cents(sold.total_tax_money) * share), -1, false, sold.name)
        }
      }
    }
  }
  return out
}

/** "2026-10" → that month's start and end in studio time, as UTC instants. */
export function monthRange(month: string): { start: string; end: string } {
  const [y, m] = month.split('-').map(Number)
  const at = (yy: number, mm: number) => {
    // Midnight in Chicago: find the offset for that day (CDT -5 / CST -6).
    // 05:00Z is midnight CDT or 11pm CST the night before — either way the
    // offset in force at that midnight (DST changes at 2am, never at midnight).
    const probe = new Date(Date.UTC(yy, mm - 1, 1, 5))
    const tz = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', timeZoneName: 'shortOffset' }).formatToParts(probe).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT-6'
    const offset = Number(tz.replace('GMT', '')) || -6
    return new Date(Date.UTC(yy, mm - 1, 1, -offset)).toISOString()
  }
  return { start: at(y, m), end: m === 12 ? at(y + 1, 1) : at(y, m + 1) }
}

/** The month before `now`'s month, as "YYYY-MM" in studio time. */
export function previousMonth(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit' }).formatToParts(now)
  const y = Number(parts.find((p) => p.type === 'year')!.value)
  const m = Number(parts.find((p) => p.type === 'month')!.value)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

function base(config: SquareConfig): string {
  return config.environment === 'production' ? 'https://connect.squareup.com' : 'https://connect.squareupsandbox.com'
}

async function square(config: SquareConfig, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${base(config)}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${config.accessToken}`, 'Content-Type': 'application/json', 'Square-Version': '2025-01-23' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const data: any = await res.json()
  if (!res.ok) throw new Error(`Square ${path} ${res.status}: ${JSON.stringify(data.errors ?? data).slice(0, 200)}`)
  return data
}

export async function loadCatalogIndex(config: SquareConfig): Promise<CatalogIndex> {
  const classesCategoryId = config.classesCategoryId || ''
  const categories = new Map<string, string>()
  const items: any[] = []
  let cursor: string | undefined
  do {
    const page = await square(config, `/v2/catalog/list?types=ITEM,CATEGORY&include_deleted_objects=true${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
    for (const o of page.objects ?? []) {
      if (o.type === 'CATEGORY') categories.set(o.id, o.category_data?.name ?? '')
      else items.push(o)
    }
    cursor = page.cursor
  } while (cursor)
  const index: CatalogIndex = new Map()
  for (const item of items) {
    const d = item.item_data ?? {}
    const ids: string[] = [...(d.categories ?? []).map((c: any) => c.id), d.category_id].filter(Boolean)
    const info: ItemInfo = {
      productType: d.product_type ?? 'REGULAR',
      inClasses: !!classesCategoryId && ids.includes(classesCategoryId),
      categoryNames: [...(d.categories ?? []).map((c: any) => categories.get(c.id) ?? ''), categories.get(d.category_id) ?? ''].filter(Boolean),
    }
    for (const v of d.variations ?? []) index.set(v.id, info)
  }
  return index
}

export async function loadOrders(config: SquareConfig, month: string): Promise<any[]> {
  const { start, end } = monthRange(month)
  const orders: any[] = []
  let cursor: string | undefined
  do {
    const page = await square(config, '/v2/orders/search', {
      location_ids: [config.locationId],
      limit: 500,
      ...(cursor ? { cursor } : {}),
      query: {
        filter: { state_filter: { states: ['COMPLETED'] }, date_time_filter: { closed_at: { start_at: start, end_at: end } } },
        sort: { sort_field: 'CLOSED_AT', sort_order: 'ASC' },
      },
    })
    orders.push(...(page.orders ?? []))
    cursor = page.cursor
  } while (cursor)
  return orders
}

/** Original sales, from earlier months, of anything refunded in these orders. */
export async function loadSourceOrders(config: SquareConfig, orders: any[]): Promise<Map<string, any>> {
  const have = new Set(orders.map((o) => o.id))
  const ids = [...new Set(orders.flatMap((o) => (o.returns ?? []).map((r: any) => r.source_order_id)).filter((id) => id && !have.has(id)))] as string[]
  const found = new Map<string, any>()
  for (let i = 0; i < ids.length; i += 100) {
    const page = await square(config, '/v2/orders/batch-retrieve', { location_id: config.locationId, order_ids: ids.slice(i, i + 100) })
    for (const o of page.orders ?? []) found.set(o.id, o)
  }
  return found
}

const money = (c: number) => `${c < 0 ? '−' : ''}$${(Math.abs(c) / 100).toFixed(2)}`
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function renderTaxReport(month: string, s: TaxSummary, opts: { partial?: boolean; classesCategoryMissing?: boolean } = {}): { subject: string; text: string; html: string } {
  const monthName = new Date(`${month}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  const sum = (kind: 'use' | 'sales' | 'unsure') => (Object.keys(s) as Bucket[]).filter((b) => BUCKET_TAX[b] === kind).reduce((t, b) => t + s[b].taxCents, 0)
  const use = sum('use'), sales = sum('sales'), unsure = sum('unsure')
  const rows = (Object.keys(s) as Bucket[]).filter((b) => s[b].lines > 0 || s[b].taxCents !== 0)
  const caveat = opts.classesCategoryMissing ? 'Note: the Classes category is not set (SQUARE_CLASSES_CATEGORY_ID), so our own classes may be under Craft Café. All are use tax, so the use-tax total is the same.' : ''
  const title = `Tax collected, ${monthName}${opts.partial ? ' (so far)' : ''}`
  const text = [
    title,
    '',
    `Use tax (classes, Craft Café, parties): ${money(use)}`,
    `Sales tax (take-home kits): ${money(sales)}`,
    ...(unsure ? [`Not sorted (custom amounts) — ask Chris: ${money(unsure)}`] : []),
    '',
    ...rows.map((b) => `${BUCKET_LABEL[b]}: sales ${money(s[b].salesCents)}, tax ${money(s[b].taxCents)} — ${BUCKET_TAX[b] === 'use' ? 'use tax' : BUCKET_TAX[b] === 'sales' ? 'sales tax' : 'ask Chris'}`),
    '',
    'From Square: completed orders in the month (studio time), refunds taken off. Sales are before tax.',
    ...(caveat ? ['', caveat] : []),
  ].join('\n')
  const td = 'padding:6px 10px;border-bottom:1px solid #eee;'
  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;color:#2b2420;line-height:1.5;">
  <h2 style="font-size:18px;margin:0 0 12px;">${esc(title)}</h2>
  <p style="margin:0 0 4px;"><strong>Use tax</strong> (classes, Craft Café, parties): <strong>${money(use)}</strong></p>
  <p style="margin:0 0 4px;"><strong>Sales tax</strong> (take-home kits): <strong>${money(sales)}</strong></p>
  ${unsure ? `<p style="margin:0 0 4px;">Not sorted (custom amounts), ask Chris: <strong>${money(unsure)}</strong></p>` : ''}
  <table style="border-collapse:collapse;margin-top:14px;font-size:14px;">
    <tr><th style="${td}text-align:left;">What</th><th style="${td}text-align:right;">Sales</th><th style="${td}text-align:right;">Tax</th><th style="${td}text-align:left;">Report as</th></tr>
    ${rows.map((b) => `<tr><td style="${td}">${esc(BUCKET_LABEL[b])}</td><td style="${td}text-align:right;">${money(s[b].salesCents)}</td><td style="${td}text-align:right;">${money(s[b].taxCents)}</td><td style="${td}">${BUCKET_TAX[b] === 'use' ? 'Use tax' : BUCKET_TAX[b] === 'sales' ? 'Sales tax' : 'Ask Chris'}</td></tr>`).join('')}
  </table>
  <p style="margin:14px 0 0;font-size:13px;color:#6f635b;">From Square: completed orders in the month (studio time), refunds taken off. Sales are before tax.</p>
  ${caveat ? `<p style="margin:8px 0 0;font-size:13px;color:#6f635b;">${esc(caveat)}</p>` : ''}
</div>`
  return { subject: title, text, html }
}
