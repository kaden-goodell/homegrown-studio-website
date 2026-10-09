import { describe, it, expect, vi, beforeEach } from 'vitest'

const create = vi.fn()
const get = vi.fn()
const getFromNonce = vi.fn()
const getFromGan = vi.fn()
const activitiesCreate = vi.fn()

vi.mock('square', () => ({
  SquareClient: class MockSquareClient {
    giftCards = { create, get, getFromNonce, getFromGan, activities: { create: activitiesCreate } }
    constructor(_opts: any) {}
  },
  SquareEnvironment: { Production: 'production', Sandbox: 'sandbox' },
}))

import { SquareGiftCardProvider } from '../../../src/providers/square/giftcard'
import type { SquareConfig } from '../../../src/config/site.config'

const testConfig: SquareConfig = {
  accessToken: 'test-token',
  environment: 'sandbox',
  locationId: 'loc-123',
  applicationId: 'app-456',
}

describe('SquareGiftCardProvider', () => {
  let provider: SquareGiftCardProvider
  beforeEach(() => {
    vi.clearAllMocks()
    provider = new SquareGiftCardProvider(testConfig)
  })

  it('mint creates a DIGITAL card, ACTIVATEs it with the amount, and returns the live card', async () => {
    create.mockResolvedValue({ giftCard: { id: 'gc1', gan: '7783000000000001', state: 'PENDING' } })
    activitiesCreate.mockResolvedValue({})
    get.mockResolvedValue({ giftCard: { id: 'gc1', gan: '7783000000000001', state: 'ACTIVE', balanceMoney: { amount: BigInt(2500) } } })

    const card = await provider.mint({ amountCents: 2500, idempotencyKey: 'k1' })

    expect(create).toHaveBeenCalledWith({ idempotencyKey: 'k1-create', locationId: 'loc-123', giftCard: { type: 'DIGITAL' } })
    expect(activitiesCreate).toHaveBeenCalledTimes(1)
    const call = activitiesCreate.mock.calls[0][0]
    expect(call.idempotencyKey).toBe('k1-load')
    const act = call.giftCardActivity
    expect(act.type).toBe('ACTIVATE')
    expect(act.giftCardId).toBe('gc1')
    expect(act.locationId).toBe('loc-123')
    expect(act.activateActivityDetails).toEqual({
      amountMoney: { amount: BigInt(2500), currency: 'USD' },
      buyerPaymentInstrumentIds: ['complimentary'],
    })
    expect(act.adjustIncrementActivityDetails).toBeUndefined()
    expect(activitiesCreate.mock.calls.some((c) => c[0].giftCardActivity.type === 'ADJUST_INCREMENT')).toBe(false)
    expect(get).toHaveBeenCalledWith({ id: 'gc1' })
    expect(card).toEqual({ id: 'gc1', gan: '7783000000000001', balanceCents: 2500, state: 'ACTIVE' })
  })

  it('fromNonce, get and fromGan return the card with the balance as a number', async () => {
    const raw = { giftCard: { id: 'gc2', gan: '7783000000000002', state: 'ACTIVE', balanceMoney: { amount: BigInt(900) } } }
    getFromNonce.mockResolvedValue(raw)
    get.mockResolvedValue(raw)
    getFromGan.mockResolvedValue(raw)
    const want = { id: 'gc2', gan: '7783000000000002', balanceCents: 900, state: 'ACTIVE' }
    expect(await provider.fromNonce('cnon:x')).toEqual(want)
    expect(getFromNonce).toHaveBeenCalledWith({ nonce: 'cnon:x' })
    expect(await provider.get('gc2')).toEqual(want)
    expect(await provider.fromGan('7783000000000002')).toEqual(want)
    expect(getFromGan).toHaveBeenCalledWith({ gan: '7783000000000002' })
  })

  it('maps not-found and invalid-request errors to null but rethrows others', async () => {
    getFromNonce.mockRejectedValueOnce({ statusCode: 404, errors: [{ category: 'NOT_FOUND' }] })
    expect(await provider.fromNonce('a')).toBeNull()
    getFromNonce.mockRejectedValueOnce({ statusCode: 400, errors: [{ category: 'INVALID_REQUEST_ERROR' }] })
    expect(await provider.fromNonce('b')).toBeNull()
    getFromGan.mockRejectedValueOnce({ statusCode: 404 })
    expect(await provider.fromGan('c')).toBeNull()
    get.mockRejectedValueOnce({ statusCode: 500, errors: [{ category: 'API_ERROR' }] })
    await expect(provider.get('d')).rejects.toBeTruthy()
  })

  it('rethrows an auth failure instead of treating it as "no such card"', async () => {
    getFromNonce.mockRejectedValueOnce({ statusCode: 401, errors: [{ category: 'AUTHENTICATION_ERROR', code: 'UNAUTHORIZED' }] })
    await expect(provider.fromNonce('e')).rejects.toMatchObject({ statusCode: 401 })
  })
})
