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
import { recipientsFor } from '@lib/notify-settings'
import { siteConfig, type SquareConfig } from '@config/site.config'
import { makeKvStore } from '@lib/blob-store'
import { loadCatalogIndex, loadOrders, loadSourceOrders, monthRange, summarizeTax, taxTotals, type TaxSummary } from '@lib/tax-report'
import { registerIds } from '@lib/classes/register-setup'
import { listReaderOrderLinks } from '@lib/classes/reader-store'
import { createLogger } from '@lib/logger'

const logger = createLogger('tax-report-store')

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

/**
 * A month is remembered only a week after it ends: payments taken offline on
 * the register, and Square's own order search, can arrive days late. Until
 * then every look asks Square again (the monthly email on the 1st included).
 */
const SETTLED_AFTER_MS = 7 * 24 * 60 * 60 * 1000
const ENDED_AFTER_MS = 60 * 60 * 1000

/** The month has ended (plus an hour): no longer "so far". */
export function monthClosed(month: string, now: Date = new Date()): boolean {
  return now.getTime() >= new Date(monthRange(month).end).getTime() + ENDED_AFTER_MS
}

/** The month ended over a week ago: its numbers won't change, so they may be remembered. */
export function monthSettled(month: string, now: Date = new Date()): boolean {
  return now.getTime() >= new Date(monthRange(month).end).getTime() + SETTLED_AFTER_MS
}

function squareConfig(): SquareConfig {
  return siteConfig.providers.payment.config as SquareConfig
}

/**
 * The tax split for `month` ("2026-10"). Remembered a week after the month
 * ends; `fresh` asks Square again (and remembers the new answer). Throws
 * when Square can't be read.
 */
export async function buildTaxMonth(month: string, opts: { fresh?: boolean; now?: Date } = {}): Promise<TaxMonth> {
  const now = opts.now ?? new Date()
  const closed = monthClosed(month, now)
  const settled = monthSettled(month, now)
  if (settled && !opts.fresh) {
    const raw = await kv.get(`month:${month}`).catch(() => null)
    if (raw) {
      try { return JSON.parse(raw) as TaxMonth } catch { /* rebuild below */ }
    }
  }
  // The Classes category the owners picked in More › Register setup, else the site's value.
  const config: SquareConfig = { ...squareConfig(), classesCategoryId: (await registerIds()).classesCategoryId }
  const [index, orders] = await Promise.all([loadCatalogIndex(config), loadOrders(config, month)])
  const sources = await loadSourceOrders(config, orders)
  // OWNER-S4-8: reader charges' tax from our own records (Square saw a plain amount). Unreadable → counted as Square has them.
  const reader = new Map((await listReaderOrderLinks().catch((e) => {
    logger.error('Reader orders unreadable — counted as custom amounts', { error: e instanceof Error ? e.message : String(e) })
    return []
  })).map((l) => [l.orderId, { netCents: l.netCents, taxCents: l.taxCents }]))
  const summary = summarizeTax(orders, index, sources, reader)
  const out: TaxMonth = {
    month,
    summary,
    totals: taxTotals(summary),
    orders: orders.length,
    partial: !closed,
    builtAt: now.toISOString(),
    classesCategoryMissing: !config.classesCategoryId,
  }
  if (settled) await kv.set(`month:${month}`, JSON.stringify(out)).catch(() => undefined)
  return out
}

/**
 * Who gets the monthly tax split: the owners picked in More › Notifications
 * (the site setup's tax list until an owner saves that screen). The monthly
 * email and /admin › Reports › "Send it again" both use this.
 */
export async function taxReportRecipients(): Promise<string[]> {
  return recipientsFor('tax-report', 'email')
}

export async function recordTaxSent(month: string, sent: TaxSent): Promise<void> {
  await kv.set(`sent:${month}`, JSON.stringify(sent)).catch(() => undefined)
}

export async function lastTaxSent(month: string): Promise<TaxSent | null> {
  const raw = await kv.get(`sent:${month}`).catch(() => null)
  if (!raw) return null
  try { return JSON.parse(raw) as TaxSent } catch { return null }
}
