/**
 * LEGACY FALLBACK — delete after 2027-01-15 with src/lib/legacy-square/.
 * While parties run on the old Square booking, /api/party/book.json hands the
 * new panel's request to today's checkout, with every detail looked up on the
 * server; the new party system takes nothing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const m = vi.hoisted(() => ({ book: vi.fn(), bookParty: vi.fn(), craft: vi.fn(), service: vi.fn() }))

vi.mock('@lib/legacy-square/party-book-square-flow', () => ({ squareFlowBook: (...a: any[]) => m.book(...a) }))
vi.mock('@lib/parties/checkout', async (orig) => ({ ...(await orig<typeof import('@lib/parties/checkout')>()), bookParty: (...a: any[]) => m.bookParty(...a) }))
vi.mock('@lib/craft-catalog', async (orig) => ({ ...(await orig<typeof import('@lib/craft-catalog')>()), findPartyCraft: (...a: any[]) => m.craft(...a) }))

import { POST } from '@pages/api/party/book.json'
import { deps, SQUARE_FLOW_NO_EXTRAS, SQUARE_FLOW_NO_PACKAGE, SQUARE_FLOW_CRAFT_GONE } from '@lib/legacy-square/party-square-flow-adapter'
import { _resetSwitchForTests, saveSwitches, resetSwitchCache } from '@lib/booking-switch'

const START = '2026-12-06T19:00:00.000Z' // a Sunday, 1 PM Central: the $300 studio fee
const CRAFT = { id: 'CRAFT1', name: 'Fabric Bulletin Boards', perHeadCents: 2000, perHeadMaxCents: 2000, description: 'Pin it.', imageUrl: 'https://img/x.jpg', personalized: false, popular: false, partyOnly: false, cafeOnly: false }
let savedEnv: string | undefined

function req(body: Record<string, unknown>, cookie?: string) {
  return new Request('https://ourhometownstudio.com/api/party/book.json', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  })
}
const panelBody = (extra: Record<string, unknown> = {}) => ({
  attemptId: 'a'.repeat(32), startTime: START, packageId: 'pkg_whole', guests: 12, addOns: {}, craftId: 'CRAFT1',
  customer: { firstName: 'Sarah', lastName: 'Lee', email: 's@example.com', phone: '2565550100' },
  paymentToken: 'cnon:ok', sourceKind: 'card', expectedTotalCents: 30000, ...extra,
})
const call = (r: Request) => POST({ request: r, clientAddress: '1.2.3.4', locals: {} } as any) as Promise<Response>

beforeEach(async () => {
  savedEnv = process.env.BOOKING_SYSTEMS
  delete process.env.BOOKING_SYSTEMS // production: nothing set
  await _resetSwitchForTests()
  m.book.mockReset().mockResolvedValue(new Response(JSON.stringify({ data: { bookingId: 'sq_bk1', hostToken: 'h', totalCharged: 30000, emailSent: true } }), { status: 200 }))
  m.bookParty.mockReset()
  m.craft.mockReset().mockResolvedValue(CRAFT)
  m.service.mockReset().mockResolvedValue({ id: 'VAR1', version: 7 })
  deps.loadPartyService = (...a: any[]) => m.service(...a)
})
afterEach(async () => {
  if (savedEnv === undefined) delete process.env.BOOKING_SYSTEMS
  else process.env.BOOKING_SYSTEMS = savedEnv
  await _resetSwitchForTests()
})

describe('parties on the old Square booking (the default)', () => {
  it('hands the booking to today’s checkout with the craft and service looked up on the server; the new system takes nothing', async () => {
    const res = await call(req(panelBody({ craft: { name: 'FAKE', perHeadCents: 1 } })))
    expect(res.status).toBe(200)
    expect((await res.json()).data.bookingId).toBe('sq_bk1')
    expect(m.bookParty).not.toHaveBeenCalled()
    expect(m.book).toHaveBeenCalledTimes(1)
    const sent = await (m.book.mock.calls[0][0].request as Request).json()
    expect(sent).toMatchObject({
      serviceVariationId: 'VAR1', serviceVariationVersion: 7, people: 12, startTime: START, paymentToken: 'cnon:ok',
      craft: { id: 'CRAFT1', name: 'Fabric Bulletin Boards', perHeadCents: 2000, perHeadMaxCents: 2000, description: 'Pin it.', imageUrl: 'https://img/x.jpg' },
      customer: { firstName: 'Sarah', lastName: 'Lee', email: 's@example.com', phone: '2565550100' },
      attemptId: 'a'.repeat(32),
    })
  })

  it('refuses what today’s checkout can’t do, before anything is held or charged', async () => {
    let res = await call(req(panelBody({ addOns: { balloons: 1 } })))
    expect(res.status).toBe(400)
    expect((await res.json()).detail).toBe(SQUARE_FLOW_NO_EXTRAS)
    res = await call(req(panelBody({ packageId: 'pkg_test' })))
    expect((await res.json()).detail).toBe(SQUARE_FLOW_NO_PACKAGE)
    m.craft.mockResolvedValue(null)
    res = await call(req(panelBody()))
    expect(res.status).toBe(404)
    expect((await res.json()).detail).toBe(SQUARE_FLOW_CRAFT_GONE)
    m.craft.mockResolvedValue({ ...CRAFT, hidden: true })
    res = await call(req(panelBody()))
    expect(res.status).toBe(404)
    expect(m.book).not.toHaveBeenCalled()
  })

  it('a different total on the Pay button than today’s checkout charges is refused (price_changed), nothing charged', async () => {
    const res = await call(req(panelBody({ expectedTotalCents: 25000 })))
    expect(res.status).toBe(409)
    expect((await res.json()).why).toBe('price_changed')
    expect(m.book).not.toHaveBeenCalled()
  })

  it('no party service in Square: a plain "nothing was charged", never today’s checkout', async () => {
    m.service.mockResolvedValue(null)
    const res = await call(req(panelBody()))
    expect(res.status).toBe(503)
    expect((await res.json()).detail).toMatch(/nothing was charged/)
    expect(m.book).not.toHaveBeenCalled()
  })
})

describe('parties switched to the new system', () => {
  it('never reaches today’s checkout', async () => {
    await saveSwitches({ open: { parties: true, workshops: true, kits: false }, pauseNote: '', system: { parties: 'own' } }, { expectedUpdatedAt: null, by: { id: 'admin', name: 'Kaden' } })
    resetSwitchCache()
    m.bookParty.mockResolvedValue({ ok: false, status: 409, code: 'slot_taken', detail: 'taken' })
    await call(req(panelBody())).catch(() => undefined)
    expect(m.book).not.toHaveBeenCalled()
  })
})
