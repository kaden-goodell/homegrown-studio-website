// @vitest-environment node
/**
 * The printable quote flyer (S-55): one US Letter page in the Invitation look,
 * every visible package with its lines and prices, a QR code to the
 * customer's link made right here, and never a cost.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const qr = vi.hoisted(() => ({ calls: [] as unknown[][] }))
vi.mock('qrcode', async (orig) => {
  const real = (await orig<any>()).default
  const toString = (...a: unknown[]) => {
    qr.calls.push(a)
    return real.toString(...a)
  }
  return { default: { ...real, toString }, toString }
})

import { quoteFlyerHtml } from '@lib/quotes/flyer'
import * as route from '@pages/admin/quote/[id]/flyer'
import { adminCookie } from '@lib/admin-auth'
import { newToken, newQuoteId, partyIdForQuote, createQuote } from '@lib/quotes/quote-store'
import { checkRequest, saveRequest } from '@lib/event-requests'
import type { Quote, Tier } from '@lib/quotes/types'
import { goodBody } from '../../fixtures/event-request'

const ORIGIN = 'https://ourhometownstudio.com'

const tier = (over: Partial<Tier>): Tier => ({
  id: 'tr_pick', key: 'pick', name: 'Our pick', photoUrl: null, hidden: false, priceCents: 4000,
  lines: [
    { itemId: 'i1', label: 'Wood sign', photoUrl: null, cents: 4500, per: 'person', costCents: 937 },
    { itemId: 'i2', label: 'Travel', photoUrl: null, cents: 10000, per: 'event', costCents: 2511 },
  ],
  ...over,
})

function quote(over: Partial<Quote> = {}): Quote {
  const id = 'qt_flyer'
  return {
    id, requestId: 'req_1', partyId: partyIdForQuote(id), token: 'a'.repeat(32), version: 2, priceKey: 'k',
    status: 'sent', place: 'away', address: '100 Main St, Huntsville, AL',
    startIso: '2026-12-05T20:00:00.000Z', endIso: '2026-12-05T22:00:00.000Z', guests: 20, crafters: 'adults',
    targetCents: 4000, note: 'So glad you asked!', depositPct: 50, expiresAt: '2026-12-01T00:00:00.000Z',
    tiers: [
      tier({ id: 'tr_simple', key: 'simple', name: 'Simple', priceCents: 3200 }),
      tier({}),
      tier({ id: 'tr_all', key: 'all', name: 'All out (hidden)', hidden: true, priceCents: 5200 }),
    ],
    held: true, sentAt: '2026-11-17T12:00:00.000Z', sentBy: 'Kaden', views: 0, history: [],
    ...over,
  }
}

beforeEach(() => { qr.calls = [] })

describe('quoteFlyerHtml', () => {
  it('one letter page in the Invitation look with the event facts', async () => {
    const html = await quoteFlyerHtml(quote(), { origin: ORIGIN, firstName: 'Dana' })
    expect(html).toContain('@page { size: letter')
    expect(html).toContain('#efe6da')
    expect(html).toContain('#fffdf9')
    expect(html).toContain('Playfair Display')
    expect(html).toContain('An Evening of Making')
    expect(html).toContain('Dana')
    expect(html).toContain('Saturday, December 5')
    expect(html).toContain('2–4 PM')
    expect(html).toContain('20 guests')
    expect(html).toContain('100 Main St, Huntsville, AL')
  })

  it('each visible package: name, lines with normal prices, normal per person crossed out, the price, the total', async () => {
    const html = await quoteFlyerHtml(quote(), { origin: ORIGIN, firstName: 'Dana' })
    expect(html).toContain('Simple')
    expect(html).toContain('Our pick')
    expect(html).not.toContain('All out (hidden)')
    expect(html).toContain('Wood sign')
    expect(html).toContain('$45') // the line's normal price
    expect(html).toContain('$100') // Travel, per event
    // normal per person = 45 + 100/20 = $50, crossed out; then the price
    expect(html).toMatch(/<s[^>]*>\$50<\/s>/)
    expect(html).toContain('$32')
    expect(html).toContain('$40')
    expect(html).toContain('$640') // 32 × 20
    expect(html).toContain('$800') // 40 × 20
  })

  it('a QR code drawn here for the customer link', async () => {
    const html = await quoteFlyerHtml(quote(), { origin: `${ORIGIN}/`, firstName: 'Dana' })
    expect(qr.calls[0][0]).toBe(`${ORIGIN}/quote/${'a'.repeat(32)}`)
    expect(qr.calls[0][1]).toMatchObject({ type: 'svg', margin: 0 })
    expect(html).toMatch(/<svg[^>]*>[\s\S]*<path/)
    expect(html).not.toMatch(/api\.qrserver|chart\.googleapis/)
  })

  it('a print bar with the iPad hint, hidden when printing', async () => {
    const html = await quoteFlyerHtml(quote(), { origin: ORIGIN, firstName: 'Dana' })
    expect(html).toContain('onclick="window.print()"')
    expect(html).toContain('On an iPad: tap Share, then Print')
    expect(html).toMatch(/@media print \{[^@]*\.bar \{ display: none; \}/)
  })

  it('never a cost', async () => {
    const html = await quoteFlyerHtml(quote(), { origin: ORIGIN, firstName: 'Dana' })
    expect(html.toLowerCase()).not.toContain('cost')
    expect(html).not.toContain('9.37')
    expect(html).not.toContain('25.11')
  })

  it('escapes owner-typed words', async () => {
    const html = await quoteFlyerHtml(quote({ tiers: [tier({ name: '<b>Pick</b>' })] }), { origin: ORIGIN, firstName: '<i>' })
    expect(html).toContain('&lt;b&gt;Pick&lt;/b&gt;')
    expect(html).not.toContain('<b>Pick</b>')
  })
})

describe('/admin/quote/<id>/flyer', () => {
  const cookie = () => adminCookie().split(';')[0]
  async function open(id: string, signedIn = true) {
    const request = new Request(`${ORIGIN}/admin/quote/${id}/flyer`, { headers: signedIn ? { cookie: cookie() } : {} })
    const res: Response = await (route as any).GET({ request, params: { id }, url: new URL(request.url) })
    return { status: res.status, location: res.headers.get('Location'), html: res.status === 302 ? '' : await res.text() }
  }
  beforeEach(() => vi.stubEnv('ADMIN_PASSCODE', 'owner-secret'))
  afterEach(() => vi.unstubAllEnvs())

  it('owners only: anyone else goes to the sign-in', async () => {
    expect(await open('qt_whatever', false)).toMatchObject({ status: 302, location: '/admin' })
  })

  it('an unknown quote is a 404', async () => {
    expect((await open('qt_nope')).status).toBe(404)
  })

  it('a saved quote prints with the customer first name and its link', async () => {
    const c = checkRequest(goodBody({ about: { ...goodBody().about, name: 'Robin Flyer' } }), new Date('2026-10-17T17:00:00Z'))
    if (!c.ok) throw new Error('bad fixture')
    const req = await saveRequest(c.value, [])
    const id = newQuoteId()
    const q = await createQuote({ ...quote(), id, partyId: partyIdForQuote(id), token: newToken(), requestId: req.id })
    const r = await open(id)
    expect(r.status).toBe(200)
    expect(r.html).toContain('Robin')
    expect(r.html).toContain('Our pick')
    expect(qr.calls.at(-1)?.[0]).toBe(`${ORIGIN}/quote/${q.token}`)
  })
})
