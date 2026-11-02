/**
 * The monthly tax split for any month, for /admin › More › Reports and the
 * job on the 1st (G7): one way to build it, so the app and the email agree.
 *
 * Read-only on Square. A month that has ended is remembered in our own store
 * (`tax-reports`), so opening it again doesn't ask Square for a whole month of
 * orders each time; "Ask Square again" (fresh) rebuilds it. The month still
 * running is always built fresh and marked "so far".
 *
 * Also remembers when each month's report was last emailed, and to whom, so
 * Reports can say "Emailed Nov 1 to kaden@…" next to Send it again.
 */
import { siteConfig, type SquareConfig } from '@config/site.config'
import { makeKvStore } from '@lib/blob-store'
import { loadCatalogIndex, loadOrders, loadSourceOrders, monthRange, summarizeTax, taxTotals, type TaxSummary } from '@lib/tax-report'

const kv = makeKvStore('tax-reports', 'tax-reports')

/** A month's tax split, as Reports shows it. */
export interface TaxMonth {
  month: string
  summary: TaxSummary
  totals: { useCents: number; salesCents: number; unsureCents: number }
  /** Completed Square orders counted. */
  orders: number
  /** The month is still running: the numbers are "so far". */
  partial: boolean
  /** When these numbers were read from Square (ISO). */
  builtAt: string
  /** Our Classes category isn't set, so classes may sit under Craft Café (all use tax either way). */
  classesCategoryMissing: boolean
}

export interface TaxSent { at: string; to: string; by: string }

const CLOSED_AFTER_MS = 60 * 60 * 1000 // an hour after the month ends, its orders are settled

/** The month has ended (plus an hour): its numbers won't change, so they may be remembered. */
export function monthClosed(month: string, now: Date = new Date()): boolean {
  return now.getTime() >= new Date(monthRange(month).end).getTime() + CLOSED_AFTER_MS
}

function squareConfig(): SquareConfig {
  return siteConfig.providers.payment.config as SquareConfig
}

/**
 * The tax split for `month` ("2026-10"). Remembered once the month has
 * ended; `fresh` asks Square again (and remembers the new answer). Throws
 * when Square can't be read.
 */
export async function buildTaxMonth(month: string, opts: { fresh?: boolean; now?: Date } = {}): Promise<TaxMonth> {
  const now = opts.now ?? new Date()
  const closed = monthClosed(month, now)
  if (closed && !opts.fresh) {
    const raw = await kv.get(`month:${month}`).catch(() => null)
    if (raw) {
      try { return JSON.parse(raw) as TaxMonth } catch { /* rebuild below */ }
    }
  }
  const config = squareConfig()
  const [index, orders] = await Promise.all([loadCatalogIndex(config), loadOrders(config, month)])
  const sources = await loadSourceOrders(config, orders)
  const summary = summarizeTax(orders, index, sources)
  const out: TaxMonth = {
    month,
    summary,
    totals: taxTotals(summary),
    orders: orders.length,
    partial: !closed,
    builtAt: now.toISOString(),
    classesCategoryMissing: !config.classesCategoryId,
  }
  if (closed) await kv.set(`month:${month}`, JSON.stringify(out)).catch(() => undefined)
  return out
}

/** Who gets the monthly tax split. */
export function taxReportRecipients(): string[] {
  return [...siteConfig.taxReportEmails]
}

export async function recordTaxSent(month: string, sent: TaxSent): Promise<void> {
  await kv.set(`sent:${month}`, JSON.stringify(sent)).catch(() => undefined)
}

export async function lastTaxSent(month: string): Promise<TaxSent | null> {
  const raw = await kv.get(`sent:${month}`).catch(() => null)
  if (!raw) return null
  try { return JSON.parse(raw) as TaxSent } catch { return null }
}
