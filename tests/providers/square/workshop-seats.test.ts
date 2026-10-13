import { describe, it, expect, vi, afterEach } from 'vitest'
import { SquareWorkshopProvider } from '@providers/square/workshop'
import { asSeatBookingError } from '@lib/errors'

const config = { locationId: 'LOC123', accessToken: 'x', environment: 'production', applicationId: 'app' } as any
const BASE = 'https://app.squareup.com/appointments/api/buyer/classes'

const customer = { givenName: 'Ada', familyName: 'Lovelace', email: 'ada@example.com' }
const reservation = { bookingId: 'clsbk_1', contactToken: 'contact-1', orderId: 'order-1' }

function answer(status: number, body: unknown) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
}

function stubFetch(impl: (...args: any[]) => any) {
  const spy = vi.fn(impl)
  vi.stubGlobal('fetch', spy)
  return spy
}

async function caught(promise: Promise<unknown>) {
  try {
    await promise
  } catch (err) {
    return asSeatBookingError(err)
  }
  throw new Error('expected the call to fail')
}

afterEach(() => vi.unstubAllGlobals())

describe('SquareWorkshopProvider — holding and paying for seats', () => {
  describe('reserveSeats', () => {
    it('asks the classes service to hold the seats, as its own booking page would', async () => {
      const fetchSpy = stubFetch(async () =>
        answer(200, { class_booking: { id: 'clsbk_1', order_id: 'order-1', customer: { contact_token: 'contact-1' } } }),
      )
      const provider = new SquareWorkshopProvider(config)

      const held = await provider.reserveSeats({ scheduleId: 'clssch_1', startAt: '2026-10-17T00:00:00.000Z', seats: 2, customer })

      expect(held).toEqual(reservation)
      const [url, init] = fetchSpy.mock.calls[0]
      expect(url).toBe(`${BASE}/class_bookings?unit_token=LOC123`)
      expect(init.method).toBe('POST')
      expect(init.headers.Origin).toBe('https://book.squareup.com')
      expect(JSON.parse(init.body)).toEqual({
        class_schedule_id: 'clssch_1',
        start_at: '2026-10-17T00:00:00.000Z',
        customer: { given_name: 'Ada', family_name: 'Lovelace', email_address: 'ada@example.com' },
        quantity: 2,
      })
    })

    it('reads the contact token from either place the service puts it', async () => {
      stubFetch(async () => answer(200, { class_booking: { id: 'clsbk_2', contact_token: 'contact-top' } }))
      const held = await new SquareWorkshopProvider(config).reserveSeats({ scheduleId: 's', startAt: '2026-10-17T00:00:00.000Z', seats: 1, customer })
      expect(held).toEqual({ bookingId: 'clsbk_2', contactToken: 'contact-top', orderId: null })
    })

    it('reports a refusal with what the service said', async () => {
      stubFetch(async () => answer(400, 'Not enough seats available'))
      const err = await caught(new SquareWorkshopProvider(config).reserveSeats({ scheduleId: 's', startAt: '2026-10-17T00:00:00.000Z', seats: 9, customer }))
      expect(err).toMatchObject({ phase: 'reserve', kind: 'refused', status: 400, raw: 'Not enough seats available' })
    })

    it('reports no answer when the request never came back', async () => {
      stubFetch(async () => { throw new TypeError('fetch failed') })
      const err = await caught(new SquareWorkshopProvider(config).reserveSeats({ scheduleId: 's', startAt: '2026-10-17T00:00:00.000Z', seats: 1, customer }))
      expect(err).toMatchObject({ phase: 'reserve', kind: 'no_answer' })
    })

    const held = () => answer(200, { class_booking: { id: 'clsbk_1', order_id: 'order-1', customer: { contact_token: 'contact-1' } } })
    const params = (note?: string) => ({ scheduleId: 'clssch_1', startAt: '2026-10-17T00:00:00.000Z', seats: 2, customer, ...(note ? { note } : {}) })

    it('sends the seat picks as the booking’s customer note', async () => {
      const fetchSpy = stubFetch(async () => held())
      await new SquareWorkshopProvider(config).reserveSeats(params('Pumpkin color: Lavender ×2'))
      expect(JSON.parse(fetchSpy.mock.calls[0][1].body).customer_note).toBe('Pumpkin color: Lavender ×2')
    })

    it('asks once more without the note when Square refuses, and keeps that hold', async () => {
      const fetchSpy = stubFetch(async (_url: string, init: any) =>
        JSON.parse(init.body).customer_note ? answer(400, '{"errors":[{"code":"BAD_REQUEST","field":"customer_note"}]}') : held(),
      )
      expect(await new SquareWorkshopProvider(config).reserveSeats(params('Pumpkin color: Lavender ×2'))).toEqual(reservation)
      expect(fetchSpy).toHaveBeenCalledTimes(2)
      expect(JSON.parse(fetchSpy.mock.calls[1][1].body)).not.toHaveProperty('customer_note')
    })

    it('reports the second refusal when the hold fails without the note too', async () => {
      const fetchSpy = stubFetch(async () => answer(400, 'Not enough seats available'))
      const err = await caught(new SquareWorkshopProvider(config).reserveSeats(params('x')))
      expect(err).toMatchObject({ phase: 'reserve', kind: 'refused', raw: 'Not enough seats available' })
      expect(fetchSpy).toHaveBeenCalledTimes(2)
    })

    it('never asks again after no answer: the seats may already be held', async () => {
      const fetchSpy = stubFetch(async () => {
        throw new TypeError('fetch failed')
      })
      const err = await caught(new SquareWorkshopProvider(config).reserveSeats(params('x')))
      expect(err).toMatchObject({ kind: 'no_answer' })
      expect(fetchSpy).toHaveBeenCalledTimes(1)
    })

    it('does not ask again after a 5xx: it would fail the same way', async () => {
      const fetchSpy = stubFetch(async () => answer(503, 'unavailable'))
      await caught(new SquareWorkshopProvider(config).reserveSeats(params('x')))
      expect(fetchSpy).toHaveBeenCalledTimes(1)
    })

    it('without a note, a refusal is not retried', async () => {
      const fetchSpy = stubFetch(async () => answer(400, 'Not enough seats available'))
      await caught(new SquareWorkshopProvider(config).reserveSeats(params()))
      expect(fetchSpy).toHaveBeenCalledTimes(1)
    })
  })

  describe('payForSeats', () => {
    const pay = (provider: SquareWorkshopProvider, extra: Record<string, unknown> = {}) =>
      provider.payForSeats({
        reservation,
        scheduleId: 'clssch_1',
        paymentToken: 'cnon:card-ok',
        idempotencyKey: '3f2b8a0e-5c1d-4e7a-9b3c-0a1b2c3d4e5f:pay',
        ...extra,
      })

    it('charges and confirms in one call, under the key it was given', async () => {
      const fetchSpy = stubFetch(async () =>
        answer(200, { class_booking: { id: 'clsbk_1', status: 'accepted', order_id: 'order-1', order: { receipt_url: 'https://squareup.com/receipt/1' } } }),
      )

      const booked = await pay(new SquareWorkshopProvider(config))

      expect(booked).toEqual({ bookingId: 'clsbk_1', orderId: 'order-1', status: 'accepted', receiptUrl: 'https://squareup.com/receipt/1', totalChargedCents: null })
      const [url, init] = fetchSpy.mock.calls[0]
      expect(url).toBe(`${BASE}/class_bookings/clsbk_1/complete?unit_token=LOC123`)
      expect(JSON.parse(init.body)).toEqual({
        // customer_id must be the booking's contact token, not the Customers API id
        class_booking: { id: 'clsbk_1', class_schedule_id: 'clssch_1', customer_id: 'contact-1' },
        payment_source_id: 'cnon:card-ok',
        idempotency_key: '3f2b8a0e-5c1d-4e7a-9b3c-0a1b2c3d4e5f:pay',
      })
    })

    it('passes the verification token when there is one', async () => {
      const fetchSpy = stubFetch(async () => answer(200, { class_booking: { id: 'clsbk_1', status: 'accepted' } }))
      await pay(new SquareWorkshopProvider(config), { verificationToken: 'verf:1' })
      expect(JSON.parse(fetchSpy.mock.calls[0][1].body).verification_token).toBe('verf:1')
    })

    it('falls back to the customer id only when the booking has no contact token', async () => {
      const fetchSpy = stubFetch(async () => answer(200, { class_booking: { id: 'clsbk_1', status: 'accepted' } }))
      await pay(new SquareWorkshopProvider(config), { reservation: { ...reservation, contactToken: null }, fallbackCustomerId: 'CUST1' })
      expect(JSON.parse(fetchSpy.mock.calls[0][1].body).class_booking.customer_id).toBe('CUST1')
    })

    it('a 4xx is the service saying no: nothing was charged', async () => {
      stubFetch(async () => answer(400, { errors: [{ detail: 'Could not charge given payment source' }] }))
      const err = await caught(pay(new SquareWorkshopProvider(config)))
      expect(err).toMatchObject({ phase: 'pay', kind: 'refused', status: 400 })
      expect(err!.raw).toContain('Could not charge')
    })

    it('a reused key is not a "no": an earlier request used it and may have charged', async () => {
      stubFetch(async () => answer(400, { errors: [{ code: 'IDEMPOTENCY_KEY_REUSED', detail: 'The idempotency key has already been used' }] }))
      const err = await caught(pay(new SquareWorkshopProvider(config)))
      expect(err).toMatchObject({ phase: 'pay', kind: 'no_answer', status: 400 })
    })

    it('a 5xx is the service failing: we do not know', async () => {
      stubFetch(async () => answer(500, 'Internal Server Error'))
      expect(await caught(pay(new SquareWorkshopProvider(config)))).toMatchObject({ phase: 'pay', kind: 'no_answer', status: 500 })
    })

    it('a timeout from the service is also "we do not know"', async () => {
      stubFetch(async () => answer(408, 'Request Timeout'))
      expect(await caught(pay(new SquareWorkshopProvider(config)))).toMatchObject({ kind: 'no_answer' })
    })

    it('a request that never came back is "we do not know"', async () => {
      stubFetch(async () => { throw new TypeError('fetch failed') })
      expect(await caught(pay(new SquareWorkshopProvider(config)))).toMatchObject({ phase: 'pay', kind: 'no_answer' })
    })
  })

  describe('releaseSeats', () => {
    it('cancels the held booking', async () => {
      const fetchSpy = stubFetch(async () => answer(200, {}))
      await new SquareWorkshopProvider(config).releaseSeats('clsbk_1')
      expect(fetchSpy.mock.calls[0][0]).toBe(`${BASE}/class_bookings/clsbk_1/cancel?unit_token=LOC123`)
      expect(fetchSpy.mock.calls[0][1].method).toBe('POST')
    })

    it('throws when the service will not release', async () => {
      stubFetch(async () => answer(500, 'nope'))
      await expect(new SquareWorkshopProvider(config).releaseSeats('clsbk_1')).rejects.toThrow(/Seat release refused: 500/)
    })
  })
})

describe('SquareWorkshopProvider — setSeatCount', () => {
  const ORDERS = 'https://connect.squareup.com/v2/orders/order-1'
  const draft = (qty: string, total: number) => ({
    order: { id: 'order-1', location_id: 'LOC123', version: 1, state: 'DRAFT', line_items: [{ uid: 'line-1', quantity: qty }], total_money: { amount: total } },
  })

  it('raises the seat line on the held order to the real count and returns the new total', async () => {
    const spy = stubFetch(async (_url: string, init?: any) =>
      init?.method === 'PUT' ? answer(200, draft('2', 5450)) : answer(200, draft('1', 2725)),
    )
    const out = await new SquareWorkshopProvider(config).setSeatCount({ reservation, seats: 2 })
    expect(out).toEqual({ totalCents: 5450 })
    const [url, init] = spy.mock.calls[1]
    expect(url).toBe(ORDERS)
    expect(init.method).toBe('PUT')
    expect(init.headers.Authorization).toBe('Bearer x')
    expect(JSON.parse(init.body).order).toEqual({ location_id: 'LOC123', version: 1, line_items: [{ uid: 'line-1', quantity: '2' }] })
  })

  it('refuses (so nothing gets charged) when Square will not change the order', async () => {
    stubFetch(async (_url: string, init?: any) =>
      init?.method === 'PUT' ? answer(400, { errors: [{ code: 'BAD_REQUEST' }] }) : answer(200, draft('1', 2725)),
    )
    const err = await caught(new SquareWorkshopProvider(config).setSeatCount({ reservation, seats: 2 }))
    expect(err).toMatchObject({ phase: 'reserve', kind: 'refused' })
  })

  it('refuses when the order is no longer a draft', async () => {
    stubFetch(async () => answer(200, { order: { ...draft('1', 2725).order, state: 'OPEN' } }))
    const err = await caught(new SquareWorkshopProvider(config).setSeatCount({ reservation, seats: 2 }))
    expect(err).toMatchObject({ kind: 'refused' })
  })

  it('refuses when the hold has no order', async () => {
    const err = await caught(new SquareWorkshopProvider(config).setSeatCount({ reservation: { ...reservation, orderId: null }, seats: 2 }))
    expect(err).toMatchObject({ kind: 'refused' })
  })
})

describe('SquareWorkshopProvider — settleGuestSeat', () => {
  const ORDER = 'https://connect.squareup.com/v2/orders/order-g1'
  const order = (over: Record<string, unknown> = {}) => ({ order: { id: 'order-g1', location_id: 'LOC123', version: 3, state: 'OPEN', tenders: [], total_money: { amount: 2725 }, ...over } })

  it('takes an open guest-seat order to $0 under the label, then closes it with no payment', async () => {
    const spy = stubFetch(async (url: string, init?: any) => {
      if (init?.method === 'PUT') return answer(200, order({ version: 4, total_money: { amount: 0 } }))
      if (url.endsWith('/pay')) return answer(200, order({ version: 5, state: 'COMPLETED', total_money: { amount: 0 } }))
      return answer(200, order())
    })
    await new SquareWorkshopProvider(config).settleGuestSeat({ orderId: 'order-g1', label: 'Paid on booking clsbk_1' })
    const [, put] = spy.mock.calls[1]
    expect(spy.mock.calls[1][0]).toBe(ORDER)
    expect(JSON.parse(put.body).order).toEqual({
      location_id: 'LOC123', version: 3,
      discounts: [{ uid: 'guest-seat', name: 'Paid on booking clsbk_1', type: 'FIXED_PERCENTAGE', percentage: '100', scope: 'ORDER' }],
    })
    const [payUrl, pay] = spy.mock.calls[2]
    expect(payUrl).toBe(`${ORDER}/pay`)
    expect(JSON.parse(pay.body)).toMatchObject({ order_version: 4, payment_ids: [] })
  })

  it('does nothing to an order already settled (safe to repeat)', async () => {
    const spy = stubFetch(async () => answer(200, order({ state: 'COMPLETED', total_money: { amount: 0 } })))
    await new SquareWorkshopProvider(config).settleGuestSeat({ orderId: 'order-g1', label: 'x' })
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('closes an order already at $0 without discounting it again', async () => {
    const spy = stubFetch(async (url: string) =>
      url.endsWith('/pay') ? answer(200, order({ state: 'COMPLETED', total_money: { amount: 0 } })) : answer(200, order({ total_money: { amount: 0 } })))
    await new SquareWorkshopProvider(config).settleGuestSeat({ orderId: 'order-g1', label: 'x' })
    expect(spy.mock.calls.map((c) => c[1]?.method ?? 'GET')).toEqual(['GET', 'POST'])
  })

  it('never touches an order someone has paid toward', async () => {
    const spy = stubFetch(async () => answer(200, order({ tenders: [{ id: 't1' }] })))
    await expect(new SquareWorkshopProvider(config).settleGuestSeat({ orderId: 'order-g1', label: 'x' })).rejects.toThrow(/leaving it alone/)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('stops if the discount didn’t bring it to $0, and never closes it', async () => {
    const spy = stubFetch(async (_url: string, init?: any) =>
      init?.method === 'PUT' ? answer(200, order({ total_money: { amount: 100 } })) : answer(200, order()))
    await expect(new SquareWorkshopProvider(config).settleGuestSeat({ orderId: 'order-g1', label: 'x' })).rejects.toThrow(/still totals 100/)
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('reports Square refusing', async () => {
    stubFetch(async () => answer(404, { errors: [{ code: 'NOT_FOUND' }] }))
    await expect(new SquareWorkshopProvider(config).settleGuestSeat({ orderId: 'order-g1', label: 'x' })).rejects.toThrow(/Square 404/)
  })
})
