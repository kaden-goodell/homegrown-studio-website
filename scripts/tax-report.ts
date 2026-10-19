/**
 * The monthly tax split, by hand: what Square collected as "Tax", sorted into
 * use tax (classes, Craft Café, parties) and sales tax (kits). Read-only.
 *
 *   npx tsx scripts/tax-report.ts                 last month, printed
 *   npx tsx scripts/tax-report.ts 2026-10         a given month, printed
 *   npx tsx scripts/tax-report.ts 2026-10 --email also email it (siteConfig.taxReportEmails)
 */
import 'dotenv/config'
import { siteConfig, type SquareConfig } from '../src/config/site.config'
import { loadCatalogIndex, loadOrders, loadSourceOrders, summarizeTax, renderTaxReport, previousMonth } from '../src/lib/tax-report'
import { sendEmail } from '../src/lib/email'

const month = process.argv.find((a) => /^\d{4}-\d{2}$/.test(a)) ?? previousMonth()
const config = siteConfig.providers.payment.config as SquareConfig
const [index, orders] = await Promise.all([loadCatalogIndex(config), loadOrders(config, month)])
const sources = await loadSourceOrders(config, orders)
const report = renderTaxReport(month, summarizeTax(orders, index, sources), { partial: month >= new Date().toISOString().slice(0, 7), classesCategoryMissing: !config.classesCategoryId })
console.log(report.text)
if (process.argv.includes('--email')) {
  const { sent } = await sendEmail({ to: siteConfig.taxReportEmails.join(', '), ...report })
  console.log(sent ? `\nEmailed to ${siteConfig.taxReportEmails.join(', ')}` : '\nEmail NOT sent')
}
