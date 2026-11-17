// @vitest-environment node
/**
 * Admin quote routes (spec §3 Admin): the quote menu (items, packages,
 * settings, Load from Square) and a request's quote (draft, by-request,
 * save, send, resend / withdraw / reopen). Owner cookie only; 503 on a test
 * site; every write is audited; library refusals keep their status codes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({
  catalog: [] as any[],
  squareCalls: 0,
  squareFails: false,
  testSite: false,
  audit: [] as any[],
  sendThrows: null as null | (() => Error),
}))

vi.mock('@lib/classes/square-api', () => ({
  squareFetch: async (path: string) => {
    if (!path.startsWith('/catalog/list')) throw new Error(`unexpected ${path}`)
    h.squareCalls += 1
    if (h.squareFails) throw Object.assign(new Error('Square said: boom'), { status: 500 })
    return { objects: h.catalog }
  },
  squareSettings: () => ({ environment: 'sandbox' }),
}))
vi.mock('@lib/parties/test-site', async (orig) => {
  const real = await orig<typeof import('@lib/parties/test-site')>()
  return { ...real, partyWritesRefusal: () => (h.testSite ? real.NO_TEST_STORE : null) }
})
vi.mock('@lib/audit', async (orig) => ({ ...(await orig<typeof import('@lib/audit')>()), recordAudit: vi.fn(async (e: any) => { h.audit.push(e) }) }))
// No Square in tests: no legacy classes, no Square parties.
vi.mock('@config/providers', () => ({
  providers: {
    booking: { listBookings: vi.fn(async () => []) },
    workshop: { listAllWorkshops: vi.fn(async () => []), listWorkshops: vi.fn(async () => []) },
  },
}))
vi.mock('@config/site.config', async (orig) => {
  const real: any = await orig()
  return { ...real, siteConfig: { ...real.siteConfig, providers: { booking: { config: { locationId: 'test-location' } } } } }
})
vi.mock('@providers/square/client', () => ({
  createSquareClient: () => ({ catalog: { object: { get: async () => ({ object: { itemData: { variations: [{ id: 'var-party' }] } } }) } } }),
}))
vi.mock('@lib/quo', async (orig) => ({ ...(await orig<any>()), sendQuoText: vi.fn(async () => {}) }))
vi.mock('@lib/email', async (orig) => ({ ...(await orig<any>()), sendEmail: vi.fn(async () => ({ sent: true })) }))
vi.mock('@lib/quotes/admin-quotes', async (orig) => {
  const real = await orig<typeof import('@lib/quotes/admin-quotes')>()
  return {
    ...real,
    sendQuote: (...a: Parameters<typeof real.sendQuote>) => {
      if (h.sendThrows) return Promise.reject(h.sendThrows())
      return real.sendQuote(...a)
    },
  }
})

import * as menuRoute from '@pages/api/admin/quote-menu.json'
import * as draftRoute from '@pages/api/admin/quotes/draft.json'
import * as byRequestRoute from '@pages/api/admin/quotes/by-request.json'
import * as saveRoute from '@pages/api/admin/quotes/save.json'
import * as sendRoute from '@pages/api/admin/quotes/send.json'
import * as actionRoute from '@pages/api/admin/quotes/action.json'
import { adminCookie } from '@lib/admin-auth'
import { checkRequest, saveRequest, setRequestStatus } from '@lib/event-requests'
import { QuoteError } from '@lib/quotes/admin-quotes'
import { saveMenuItems } from '@lib/quotes/menu-store'
import { updateQuote } from '@lib/quotes/quote-store'
import type { MenuItem } from '@lib/quotes/types'
import { goodBody } from '../fixtures/event-request'

const ORIGIN = 'https://x.test'
const signedIn = () => adminCookie().split(';')[0]
const req = (url: string, init: { method?: string; body?: unknown; cookie?: string | null } = {}) =>
  new Request(`${ORIGIN}${url}`, {
    method: init.method ?? 'GET',
    ...(init.body !== undefined ? { body: typeof init.body === 'string' ? init.body : JSON.stringify(init.body) } : {}),
    headers: { 'Content-Type': 'application/json', ...(init.cookie === null ? {} : { cookie: init.cookie ?? signedIn() }) },
  })
const call = async (handler: any, r: Request) => {
  const res: Response = await handler({ request: r, url: new URL(r.url) } as any)
  return { status: res.status, body: await res.json(), res }
}
const post = (handler: any, url: string, body: unknown, cookie?: string | null) => call(handler, req(url, { method: 'POST', body, cookie }))

const item = (id: string, cents: number, tags: string[] = []): MenuItem =>
  ({ id, source: 'own', name: id, photoUrl: null, cents, per: 'person', costCents: null, tags, hidden: false, updatedAt: '' })

const NOW = new Date()
let dayN = 0
/** A fresh far-future February day per test. */
const nextDay = () => `2027-02-${String(++dayN).padStart(2, '0')}`

async function request(over: { date?: string; startTime?: string } = {}) {
  const base = goodBody()
  const body = goodBody({
    event: { ...base.event, date: over.date ?? nextDay(), startTime: over.startTime ?? '18:00', guests: '25', length: '2 hours', crafters: 'adults' },
    where: { ...base.where, place: 'studio', address: '' },
  })
  const c = checkRequest(body, NOW)
  if (!c.ok) throw new Error(`fixture refused: ${c.error}`)
  return saveRequest(c.value, c.photos, NOW)
}

beforeEach(() => {
  vi.stubEnv('ADMIN_PASSCODE', 'owner-secret')
  h.testSite = false
  h.squareFails = false
  h.sendThrows = null
  h.audit.length = 0
})
afterEach(() => vi.unstubAllEnvs())

describe('GET /api/admin/quote-menu.json', () => {
  it('loads from Square the first time only', async () => {
    h.catalog = [{ type: 'ITEM', id: 'IT1', item_data: { name: 'Terrarium', variations: [{ type: 'ITEM_VARIATION', id: 'V1', item_variation_data: { name: 'Regular', price_money: { amount: 4500 } } }] } }]
    const first = await call(menuRoute.GET, req('/api/admin/quote-menu.json'))
    expect(first.status).toBe(200)
    expect(first.res.headers.get('cache-control')).toBe('no-store')
    expect(h.squareCalls).toBe(1)
    expect(first.body.data.items.map((i: MenuItem) => i.name)).toContain('Terrarium')
    expect(first.body.data.settings).toMatchObject({ capPct: 25, depositPct: 50 })
    expect(first.body.data.packages).toEqual([])
    await call(menuRoute.GET, req('/api/admin/quote-menu.json'))
    expect(h.squareCalls).toBe(1)
  })
})

describe('auth and test-site refusals', () => {
  const routes: [string, any, string][] = [
    ['menu GET', menuRoute.GET, 'GET'], ['menu POST', menuRoute.POST, 'POST'],
    ['draft', draftRoute.POST, 'POST'], ['by-request', byRequestRoute.GET, 'GET'],
    ['save', saveRoute.POST, 'POST'], ['send', sendRoute.POST, 'POST'], ['action', actionRoute.POST, 'POST'],
  ]
  it.each(routes)('%s: 401 without the owner cookie', async (_n, handler, method) => {
    const r = await call(handler, req('/api/admin/x?requestId=x', { method, cookie: null, ...(method === 'POST' ? { body: {} } : {}) }))
    expect(r.status).toBe(401)
    expect(r.body.error).toBe('Sign in first.')
  })
  it.each(routes.filter(([, , m]) => m === 'POST'))('%s: 503 on a test site', async (_n, handler) => {
    h.testSite = true
    const r = await post(handler, '/api/admin/x', { action: 'sync-square', id: 'x', requestId: 'x' })
    expect(r.status).toBe(503)
    expect(typeof r.body.error).toBe('string')
  })
})

describe('POST /api/admin/quote-menu.json', () => {
  it('sync-square loads again and is audited; a failed sync is 502', async () => {
    const before = h.squareCalls
    const ok = await post(menuRoute.POST, '/api/admin/quote-menu.json', { action: 'sync-square' })
    expect(ok.status).toBe(200)
    expect(h.squareCalls).toBe(before + 1)
    expect(h.audit.at(-1)).toMatchObject({ action: 'quote-menu-sync' })
    h.squareFails = true
    const bad = await post(menuRoute.POST, '/api/admin/quote-menu.json', { action: 'sync-square' })
    expect(bad.status).toBe(502)
  })

  it('save-item creates and updates own items; refuses an empty name or a negative price', async () => {
    expect((await post(menuRoute.POST, '/x', { action: 'save-item', item: { name: ' ', cents: 100, per: 'event' } })).status).toBe(400)
    expect((await post(menuRoute.POST, '/x', { action: 'save-item', item: { name: 'Travel', cents: -1, per: 'event' } })).status).toBe(400)
    expect((await post(menuRoute.POST, '/x', { action: 'save-item', item: { name: 'Travel', cents: Number.NaN, per: 'event' } })).status).toBe(400)
    const made = await post(menuRoute.POST, '/x', { action: 'save-item', item: { name: 'Travel', cents: 5000, per: 'event', costCents: 1000, tags: ['away'] } })
    expect(made.status).toBe(200)
    const travel = made.body.data.item as MenuItem
    expect(travel).toMatchObject({ source: 'own', name: 'Travel', cents: 5000, per: 'event', costCents: 1000, tags: ['away'], hidden: false })
    expect(h.audit.at(-1)).toMatchObject({ action: 'quote-menu-item', target: { id: travel.id } })
    const changed = await post(menuRoute.POST, '/x', { action: 'save-item', item: { ...travel, cents: 6000 } })
    expect(changed.body.data.item).toMatchObject({ id: travel.id, cents: 6000 })
    const hid = await post(menuRoute.POST, '/x', { action: 'hide-item', id: travel.id, hidden: true })
    expect(hid.body.data.item.hidden).toBe(true)
    expect(h.audit.at(-1)).toMatchObject({ action: 'quote-menu-hide' })
    expect((await post(menuRoute.POST, '/x', { action: 'hide-item', id: 'nope', hidden: true })).status).toBe(404)
    const list = await call(menuRoute.GET, req('/api/admin/quote-menu.json'))
    expect(list.body.data.items.find((i: MenuItem) => i.id === travel.id)).toMatchObject({ cents: 6000, hidden: true })
  })

  it('save-package then GET lists it; delete-package removes it', async () => {
    const line = { itemId: null, label: 'Felt hearts', photoUrl: null, cents: 800, per: 'person', costCents: null }
    expect((await post(menuRoute.POST, '/x', { action: 'save-package', pkg: { name: '', lines: [line] } })).status).toBe(400)
    expect((await post(menuRoute.POST, '/x', { action: 'save-package', pkg: { name: 'Cozy', lines: [{ ...line, cents: -5 }] } })).status).toBe(400)
    const saved = await post(menuRoute.POST, '/x', { action: 'save-package', pkg: { name: 'Cozy', photoUrl: null, lines: [line] } })
    expect(saved.status).toBe(200)
    expect(h.audit.at(-1)).toMatchObject({ action: 'quote-package-save' })
    const list = await call(menuRoute.GET, req('/api/admin/quote-menu.json'))
    const pkg = list.body.data.packages.find((p: any) => p.name === 'Cozy')
    expect(pkg).toMatchObject({ lines: [line], by: 'Owner' })
    const gone = await post(menuRoute.POST, '/x', { action: 'delete-package', id: pkg.id })
    expect(gone.status).toBe(200)
    expect(gone.body.data.packages.some((p: any) => p.id === pkg.id)).toBe(false)
    expect(h.audit.at(-1)).toMatchObject({ action: 'quote-package-delete' })
  })

  it('save-settings saves, refuses bad numbers (400) and a stale save (409)', async () => {
    const cur = (await call(menuRoute.GET, req('/api/admin/quote-menu.json'))).body.data.settings
    const ok = await post(menuRoute.POST, '/x', { action: 'save-settings', settings: { capPct: 30 }, expectedUpdatedAt: cur.updatedAt })
    expect(ok.status).toBe(200)
    expect(ok.body.data.settings.capPct).toBe(30)
    expect(h.audit.at(-1)).toMatchObject({ action: 'quote-settings' })
    const stale = await post(menuRoute.POST, '/x', { action: 'save-settings', settings: { capPct: 20 }, expectedUpdatedAt: cur.updatedAt })
    expect(stale.status).toBe(409)
    expect(stale.body.why).toBe('stale')
    const bad = await post(menuRoute.POST, '/x', { action: 'save-settings', settings: { capPct: 200 }, expectedUpdatedAt: ok.body.data.settings.updatedAt })
    expect(bad.status).toBe(400)
    // Put the cap back for the quote tests.
    await post(menuRoute.POST, '/x', { action: 'save-settings', settings: { capPct: 25 }, expectedUpdatedAt: ok.body.data.settings.updatedAt })
  })

  it('refuses an unknown action', async () => {
    expect((await post(menuRoute.POST, '/x', { action: 'explode' })).status).toBe(400)
  })
})

describe('quote routes', () => {
  beforeEach(async () => {
    await saveMenuItems(() => [item('terr', 4500, ['adults']), item('ear', 3000, ['adults']), item('felt', 800), item('big', 20000)])
  })

  it('draft returns the quote (and the same one again); by-request shows it with its status view', async () => {
    const r = await request()
    expect((await post(draftRoute.POST, '/x', { requestId: 42 })).status).toBe(400)
    const d = await post(draftRoute.POST, '/x', { requestId: r.id })
    expect(d.status).toBe(200)
    const q = d.body.data.quote
    expect(q).toMatchObject({ requestId: r.id, status: 'draft', version: 1 })
    expect(h.audit.at(-1)).toMatchObject({ action: 'quote-draft', target: { kind: 'quote', id: q.id } })
    expect((await post(draftRoute.POST, '/x', { requestId: r.id })).body.data.quote.id).toBe(q.id)

    const view = await call(byRequestRoute.GET, req(`/api/admin/quotes/by-request.json?requestId=${r.id}`))
    expect(view.status).toBe(200)
    expect(view.body.data.quote.id).toBe(q.id)
    expect(view.body.data.view).toMatchObject({ status: 'draft', views: 0, url: `${ORIGIN}/quote/${q.token}` })

    const none = await call(byRequestRoute.GET, req('/api/admin/quotes/by-request.json?requestId=2026-01-01-00000000'))
    expect(none.body.data).toEqual({ quote: null, view: null })
    expect((await call(byRequestRoute.GET, req('/api/admin/quotes/by-request.json'))).status).toBe(400)
  })

  it('draft on a booked request is 409 booked unless forced; unknown request is 404', async () => {
    const r = await request()
    await setRequestStatus(r.id, 'booked')
    const no = await post(draftRoute.POST, '/x', { requestId: r.id })
    expect(no.status).toBe(409)
    expect(no.body.why).toBe('booked')
    expect(typeof no.body.error).toBe('string')
    expect((await post(draftRoute.POST, '/x', { requestId: r.id, force: true })).status).toBe(200)
    expect((await post(draftRoute.POST, '/x', { requestId: '2026-01-01-00000000' })).status).toBe(404)
    expect((await post(draftRoute.POST, '/x', { requestId: r.id, targetCents: 'lots' })).status).toBe(400)
  })

  it('save bumps the version, refuses a stale version, and is audited', async () => {
    const r = await request()
    const q = (await post(draftRoute.POST, '/x', { requestId: r.id })).body.data.quote
    expect((await post(saveRoute.POST, '/x', { quote: q, version: 'one' })).status).toBe(400)
    const saved = await post(saveRoute.POST, '/x', { quote: { ...q, note: 'See you soon' }, version: q.version })
    expect(saved.status).toBe(200)
    expect(saved.body.data.quote).toMatchObject({ note: 'See you soon', version: 2 })
    expect(h.audit.at(-1)).toMatchObject({ action: 'quote-save', target: { id: q.id } })
    const stale = await post(saveRoute.POST, '/x', { quote: q, version: q.version })
    expect(stale.status).toBe(409)
    expect(stale.body.why).toBe('stale')
  })

  it('send sends (audited) and the view says sent; action resend / withdraw / reopen', async () => {
    const r = await request()
    const q = (await post(draftRoute.POST, '/x', { requestId: r.id })).body.data.quote
    const sent = await post(sendRoute.POST, '/x', { id: q.id, text: true, email: true })
    expect(sent.status).toBe(200)
    expect(sent.body.data).toMatchObject({ quote: { status: 'sent', held: true }, texted: true, emailed: true })
    expect(h.audit.at(-1)).toMatchObject({ action: 'quote-send', target: { id: q.id } })
    const view = (await call(byRequestRoute.GET, req(`/api/admin/quotes/by-request.json?requestId=${r.id}`))).body.data.view
    expect(view.status).toBe('sent')
    expect(view.sentAt).toBeTruthy()

    expect((await post(actionRoute.POST, '/x', { id: q.id, action: 'explode' })).status).toBe(400)
    const resent = await post(actionRoute.POST, '/x', { id: q.id, action: 'resend' })
    expect(resent.status).toBe(200)
    expect(h.audit.at(-1)).toMatchObject({ action: 'quote-resend' })
    const out = await post(actionRoute.POST, '/x', { id: q.id, action: 'withdraw' })
    expect(out.body.data.quote.status).toBe('withdrawn')
    expect(h.audit.at(-1)).toMatchObject({ action: 'quote-withdraw' })
    const again = await post(actionRoute.POST, '/x', { id: q.id, action: 'resend' })
    expect(again.status).toBe(409)
    expect(again.body.why).toBe('withdrawn')
    const back = await post(actionRoute.POST, '/x', { id: q.id, action: 'reopen' })
    expect(back.status).toBe(200)
    expect(back.body.data.quote.status).toBe('sent')
    expect(h.audit.at(-1)).toMatchObject({ action: 'quote-reopen' })
  })

  it('the view reads expired once a sent quote is past its reply-by date', async () => {
    const r = await request()
    const q = (await post(draftRoute.POST, '/x', { requestId: r.id })).body.data.quote
    await post(sendRoute.POST, '/x', { id: q.id, text: false, email: false })
    await updateQuote(q.id, (cur) => ({ ...cur, expiresAt: new Date(Date.now() - 1000).toISOString(), views: 2, lastViewedAt: '2026-11-17T00:00:00.000Z' }))
    const view = (await call(byRequestRoute.GET, req(`/api/admin/quotes/by-request.json?requestId=${r.id}`))).body.data.view
    expect(view).toMatchObject({ status: 'expired', views: 2, lastViewedAt: '2026-11-17T00:00:00.000Z' })
  })

  it('send maps each refusal to its status, with why and clash', async () => {
    const cases: [QuoteError, number][] = [
      [new QuoteError('no_tiers', 400, 'Add a package before sending.'), 400],
      [new QuoteError('incomplete', 400, 'Add a start time before sending.'), 400],
      [new QuoteError('over_cap', 409, 'A package is past the discount cap.'), 409],
      [new QuoteError('time_taken', 409, 'That time is taken.', { label: 'Tote Bags party', startIso: '2027-02-01T00:00:00.000Z' }), 409],
      [new QuoteError('closed', 409, 'The studio is closed then.'), 409],
    ]
    for (const [err, status] of cases) {
      h.sendThrows = () => err
      const res = await post(sendRoute.POST, '/x', { id: 'qt_any', text: true, email: true })
      expect(res.status).toBe(status)
      expect(res.body).toMatchObject({ why: err.why, error: err.message })
      if (err.clash) expect(res.body.clash).toEqual(err.clash)
      else expect(res.body.clash).toBeUndefined()
    }
    expect(h.audit).toHaveLength(0)
  })

  it('send validates the body', async () => {
    expect((await post(sendRoute.POST, '/x', { id: 5, text: true, email: true })).status).toBe(400)
    expect((await post(sendRoute.POST, '/x', { id: 'qt_x', text: 'yes', email: true })).status).toBe(400)
    expect((await post(sendRoute.POST, '/x', { id: 'qt_missing', text: true, email: true })).status).toBe(404)
  })
})
