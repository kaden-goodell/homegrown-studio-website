// @vitest-environment node
// /admin › More › Reports (G7): any month or year from our records, and the tax split for any month from Square.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const m = vi.hoisted(() => ({
  index: vi.fn(), orders: vi.fn(), sources: vi.fn(), email: vi.fn(), audit: [] as any[],
  parties: vi.fn(), classes: vi.fn(),
}))
vi.mock('@lib/tax-report', async (orig) => ({
  ...(await orig<typeof import('@lib/tax-report')>()),
  loadCatalogIndex: m.index, loadOrders: m.orders, loadSourceOrders: m.sources,
}))
vi.mock('@lib/email', () => ({ sendEmail: m.email }))
vi.mock('@lib/audit', () => ({ recordAudit: vi.fn(async (e: any) => { m.audit.push(e) }) }))
vi.mock('@lib/party-store', async (orig) => ({ ...(await orig<typeof import('@lib/party-store')>()), listParties: m.parties }))
vi.mock('@lib/classes/class-store', async (orig) => ({ ...(await orig<typeof import('@lib/classes/class-store')>()), listClasses: m.classes }))

import * as reports from '@pages/api/admin/reports.json'
import * as tax from '@pages/api/admin/tax-report.json'
import { taxFailureEmail } from '@pages/api/jobs/tax-report.json'
import { adminCookie } from '@lib/admin-auth'
import { siteConfig } from '@config/site.config'
import { monthClosed, monthSettled } from '@lib/tax-report-store'
import { taxReportCsv, type TaxSummary } from '@lib/tax-report'

const cookie = () => adminCookie().split(';')[0]
async function get(route: any, path: string, signedIn = true) {
  const request = new Request(`https://x.test${path}`, { headers: signedIn ? { cookie: cookie() } : {} })
  const res: Response = await route.GET({ request, url: new URL(request.url) } as any)
  const text = await res.text()
  let body: any = text
  try { body = JSON.parse(text) } catch { /* csv */ }
  return { status: res.status, body, headers: res.headers }
}
async function post(body: unknown, signedIn = true) {
  const request = new Request('https://x.test/api/admin/tax-report.json', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Who': 'Catherine', ...(signedIn ? { cookie: cookie() } : {}) }, body: JSON.stringify(body) })
  const res: Response = await (tax as any).POST({ request, url: new URL(request.url) })
  return { status: res.status, body: await res.json() }
}

// One café sale: $10 + 90¢ tax, a variation in the catalog index.
const ORDER = { id: 'o1', line_items: [{ catalog_object_id: 'V1', name: 'Keychain Bar', total_money: { amount: 1090 }, total_tax_money: { amount: 90 } }] }

let month = 2
beforeEach(() => {
  vi.stubEnv('ADMIN_PASSCODE', 'owner-secret')
  m.index.mockReset().mockResolvedValue(new Map([['V1', { productType: 'REGULAR', categoryNames: ['Party Crafts'] }]]))
  m.orders.mockReset().mockResolvedValue([ORDER])
  m.sources.mockReset().mockResolvedValue(new Map())
  m.email.mockReset().mockResolvedValue({ sent: true })
  m.parties.mockReset().mockResolvedValue([])
  m.classes.mockReset().mockResolvedValue([])
  m.audit.length = 0
})
afterEach(() => vi.unstubAllEnvs())

/** A different closed month per test, so the remembered months don't leak between tests. */
const nextMonth = () => `2025-${String(month++).padStart(2, '0')}`

describe('reports.json: any month, any year', () => {
  it('a past month and a whole year from our own records', () => {
    const now = new Date('2026-11-02T15:00:00Z')
    const parties = [{ createdAt: '2026-09-10T12:00:00Z' }, { createdAt: '2026-10-03T12:00:00Z' }, { createdAt: '2025-12-03T12:00:00Z' }] as any
    expect(reports.monthReport([], parties, now, '2026-09')).toMatchObject({ month: '2026-09', partiesBooked: 1 })
    expect(reports.monthReport([], parties, now, '2026')).toMatchObject({ month: '2026', partiesBooked: 2 })
    expect(reports.monthReport([], parties, now)).toMatchObject({ month: '2026-11', partiesBooked: 0 })
  })
  it('the route takes ?period=, refuses nonsense and periods still to come', async () => {
    expect((await get(reports, '/api/admin/reports.json?period=2026-09')).body.data.month).toBe('2026-09')
    expect((await get(reports, '/api/admin/reports.json?period=2026')).body.data.month).toBe('2026')
    expect((await get(reports, '/api/admin/reports.json?period=2026-13')).status).toBe(400)
    expect((await get(reports, '/api/admin/reports.json?period=2999-01')).body.error).toMatch(/hasn’t happened yet/)
    expect((await get(reports, '/api/admin/reports.json?period=2026', false)).status).toBe(401)
  })
})

describe('tax-report.json: the tax split for any month', () => {
  it('owners only; a month is required and can’t be in the future', async () => {
    expect((await get(tax, '/api/admin/tax-report.json?month=2025-01', false)).status).toBe(401)
    expect((await post({ action: 'send', month: '2025-01' }, false)).status).toBe(401)
    expect(await get(tax, '/api/admin/tax-report.json')).toMatchObject({ status: 400, body: { error: 'Pick a month.' } })
    expect((await get(tax, '/api/admin/tax-report.json?month=2999-01')).body.error).toBe('That month hasn’t happened yet.')
  })

  it('shows use tax and sales tax for an ended month, and remembers it (Square asked once) until Ask Square again', async () => {
    const mo = nextMonth()
    const a = await get(tax, `/api/admin/tax-report.json?month=${mo}`)
    expect(a.status).toBe(200)
    expect(a.body.data).toMatchObject({ month: mo, partial: false, orders: 1, totals: { useCents: 90, salesCents: 0, unsureCents: 0 }, lastSent: null })
    expect(a.body.data.summary.cafe).toEqual({ salesCents: 1000, taxCents: 90, lines: 1 })
    await get(tax, `/api/admin/tax-report.json?month=${mo}`)
    expect(m.orders).toHaveBeenCalledTimes(1)
    m.orders.mockResolvedValue([ORDER, { ...ORDER, id: 'o2' }])
    const fresh = await get(tax, `/api/admin/tax-report.json?month=${mo}&fresh=1`)
    expect(fresh.body.data.orders).toBe(2)
    expect(m.orders).toHaveBeenCalledTimes(2)
  })

  it('a month that just ended is no longer "so far", but is only remembered a week later (late offline payments)', () => {
    expect(monthClosed('2026-10', new Date('2026-11-01T07:00:00Z'))).toBe(true)
    expect(monthSettled('2026-10', new Date('2026-11-01T14:00:00Z'))).toBe(false) // the job on the 1st
    expect(monthSettled('2026-10', new Date('2026-11-07T04:00:00Z'))).toBe(false)
    expect(monthSettled('2026-10', new Date('2026-11-08T06:00:00Z'))).toBe(true)
  })

  it('the month still running is always asked fresh and marked so far', async () => {
    const now = new Date()
    const current = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit' }).format(now).slice(0, 7)
    expect(monthClosed(current, now)).toBe(false)
    expect((await get(tax, `/api/admin/tax-report.json?month=${current}`)).body.data.partial).toBe(true)
    await get(tax, `/api/admin/tax-report.json?month=${current}`)
    expect(m.orders).toHaveBeenCalledTimes(2)
  })

  it('downloads as a spreadsheet', async () => {
    const mo = nextMonth()
    const r = await get(tax, `/api/admin/tax-report.json?month=${mo}&format=csv`)
    expect(r.status).toBe(200)
    expect(r.headers.get('Content-Type')).toMatch(/text\/csv/)
    expect(r.headers.get('Content-Disposition')).toBe(`attachment; filename="hometown-tax-${mo}.csv"`)
    expect(r.body).toContain('Month,What,Sales (before tax),Tax,Report as')
    expect(r.body).toContain(`${mo},Craft Café & party crafts,10.00,0.90,Use tax`)
    expect(r.body).toContain(`${mo},Total use tax,,0.90,Use tax`)
  })

  it('Square not answering is a plain sentence', async () => {
    m.orders.mockRejectedValue(new Error('Square /v2/orders/search 500'))
    const r = await get(tax, `/api/admin/tax-report.json?month=${nextMonth()}`)
    expect(r).toMatchObject({ status: 503, body: { error: tax.SQUARE_UNREADABLE } })
  })

  it('Send it again emails the tax report list, is audited, and shows when it went', async () => {
    const mo = nextMonth()
    const r = await post({ action: 'send', month: mo })
    expect(r.status).toBe(200)
    const to = siteConfig.taxReportEmails.join(', ')
    expect(r.body.data).toMatchObject({ sent: true, to })
    expect(m.email).toHaveBeenCalledTimes(1)
    expect(m.email.mock.calls[0][0]).toMatchObject({ to, subject: expect.stringMatching(/^Tax collected, /) })
    expect(m.audit[0]).toMatchObject({ action: 'tax-report-send', by: { name: 'Catherine', role: 'owner' }, target: { kind: 'tax-report', id: mo } })
    expect((await get(tax, `/api/admin/tax-report.json?month=${mo}`)).body.data.lastSent).toMatchObject({ to })
  })

  it('an email that doesn’t go says so (and offers Download)', async () => {
    m.email.mockResolvedValue({ sent: false })
    expect(await post({ action: 'send', month: nextMonth() })).toMatchObject({ status: 502, body: { error: 'The email didn’t go. Download it instead, or try again later.' } })
  })

  it('refuses anything but send, and a bad month', async () => {
    expect((await post({ action: 'delete', month: '2025-01' })).status).toBe(400)
    expect((await post({ action: 'send', month: 'soon' })).body.error).toBe('Pick a month.')
  })
})

describe('the monthly job’s failure email', () => {
  it('sends her to Reports › that month, never to a script', () => {
    const e = taxFailureEmail('2026-10', 'Square /v2/orders/search 500')
    expect(e.subject).toBe('Tax report for October 2026 could not be made')
    for (const t of [e.text, e.html]) {
      expect(t).toMatch(/More › Reports › pick October 2026/)
      expect(t).toMatch(/Send it again/)
      expect(t).not.toMatch(/npx|scripts?\/|tsx|terminal|Kaden/i)
    }
  })
})

describe('taxReportCsv', () => {
  const s = (useTax: number, kits: number): TaxSummary => ({
    classes: { salesCents: 0, taxCents: 0, lines: 0 }, cafe: { salesCents: useTax * 10, taxCents: useTax, lines: 1 },
    parties: { salesCents: 0, taxCents: 0, lines: 0 }, kits: { salesCents: kits * 10, taxCents: kits, lines: kits ? 1 : 0 }, other: { salesCents: 0, taxCents: 0, lines: 0 },
  })
  it('several months end with the totals for all of them; a running month says so far', () => {
    const csv = taxReportCsv([{ month: '2026-09', summary: s(100, 0) }, { month: '2026-10', summary: s(200, 50), partial: true }])
    const lines = csv.trim().split('\r\n')
    expect(lines).toContain('2026-10 (so far),Take-home kits,5.00,0.50,Sales tax')
    expect(lines).toContain('All months,Total use tax,,3.00,Use tax')
    expect(lines).toContain('All months,Total sales tax,,0.50,Sales tax')
  })
})
