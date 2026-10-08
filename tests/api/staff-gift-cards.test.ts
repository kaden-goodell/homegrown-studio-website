import { describe, it, expect, vi, beforeEach } from 'vitest'

let authed: { id: string; name: string; role: 'owner' | 'crew' } | null = { id: 't', name: 'Test', role: 'crew' }
vi.mock('@lib/staff-auth', () => ({
  staffAuthorized: () => authed,
  byOf: (m: { id: string; name: string }) => ({ id: m.id, name: m.name }),
}))
vi.mock('@lib/dev-flags', () => ({ paymentBypassEnabled: () => false }))
vi.mock('@lib/owner-alert', () => ({ alertOwners: vi.fn(async () => ({ sent: 0 })) }))

const mint = vi.fn()
const get = vi.fn()
vi.mock('@config/providers', () => ({ providers: { giftcard: { mint: (...a: any[]) => mint(...a), get: (...a: any[]) => get(...a) } } }))

const saved: any[] = []
let records: any[] = []
vi.mock('@lib/gift-cards', async (importOriginal) => {
  const actual: any = await importOriginal()
  return {
    ...actual,
    saveMintedGiftCard: async (r: any) => { saved.push(r) },
    listMintedGiftCards: async () => records,
  }
})

import { GET, POST } from '../../src/pages/api/staff/gift-cards.json'

const post = (body: unknown) => POST({ request: new Request('http://x/api/staff/gift-cards.json', { method: 'POST', body: JSON.stringify(body) }) } as any)
const get_ = () => GET({ request: new Request('http://x/api/staff/gift-cards.json') } as any)

beforeEach(() => {
  authed = { id: 't', name: 'Test', role: 'crew' }
  saved.length = 0; records = []
  mint.mockReset(); get.mockReset()
})

describe('/api/staff/gift-cards', () => {
  it('401s when not signed in', async () => {
    authed = null
    expect((await get_()).status).toBe(401)
    expect((await post({ amountDollars: 5, forWhom: 'A' })).status).toBe(401)
  })

  it('400s with the validation message', async () => {
    const res = await post({ amountDollars: 0, forWhom: 'A' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Amount/)
  })

  it('mints and records who and for whom', async () => {
    mint.mockResolvedValue({ id: 'sq1', gan: '1234', balanceCents: 2500, state: 'ACTIVE' })
    const res = await post({ amountDollars: 25, forWhom: 'Megan', note: 'FB' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.balanceCents).toBe(2500)
    expect(mint.mock.calls[0][0].amountCents).toBe(2500)
    expect(saved[0]).toMatchObject({ forWhom: 'Megan', note: 'FB', gan: '1234', giftCardId: 'sq1', by: { id: 't', name: 'Test' } })
    expect(mint.mock.calls[0][0].idempotencyKey).toBe(saved[0].id)
  })

  it('lists with live balance, null when lookup throws', async () => {
    records = [
      { id: 'gc_1', giftCardId: 'a', gan: '1', amountCents: 500, forWhom: 'A', note: '', by: { id: 't', name: 'T' }, at: 'x' },
      { id: 'gc_2', giftCardId: 'b', gan: '2', amountCents: 500, forWhom: 'B', note: '', by: { id: 't', name: 'T' }, at: 'y' },
    ]
    get.mockImplementation(async (id: string) => { if (id === 'b') throw new Error('boom'); return { id, gan: '1', balanceCents: 300, state: 'ACTIVE' } })
    const res = await get_()
    const cards = (await res.json()).data.cards
    expect(cards[0]).toMatchObject({ balanceCents: 300, state: 'ACTIVE' })
    expect(cards[1]).toMatchObject({ balanceCents: null, state: null })
  })
})
