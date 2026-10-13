import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockOne = vi.fn()
const mockSettleOrder = vi.fn()
const mockAlert = vi.fn()
const mockNoteId = vi.fn()
vi.mock('@lib/guest-seats', () => ({
  addOneGuestSeat: (...a: any[]) => mockOne(...a),
  settleGuestSeatOrder: (...a: any[]) => mockSettleOrder(...a),
}))
vi.mock('@lib/owner-alert', () => ({ alertOwners: (...a: any[]) => mockAlert(...a) }))
vi.mock('@lib/seat-choices', () => ({ addSquareBookingId: (...a: any[]) => mockNoteId(...a) }))

import { issueGuestSeatTicket, readGuestSeatTicket, runGuestSeat, startGuestSeats, guestSeatJobKey, settleLabel, type GuestSeatJob } from '@lib/guest-seat-job'
import { issueSignedToken } from '@lib/reuse-token'

let uniq = 0
function job(over: Partial<GuestSeatJob> = {}): GuestSeatJob {
  return {
    scheduleId: 'clssch_pails',
    startAt: '2026-10-18T18:00:00Z',
    className: 'Bedazzled Pumpkin Pails',
    holder: { givenName: 'Maxie', familyName: 'Gardner', email: 'maxie@example.com' },
    totalSeats: 3,
    paidBookingId: `clsbk_paid_${Date.now()}_${++uniq}`,
    ...over,
  }
}
const ticketOf = (j: GuestSeatJob) => readGuestSeatTicket(issueGuestSeatTicket(j))!

beforeEach(() => {
  vi.clearAllMocks()
  let n = 0
  mockOne.mockImplementation(async () => ({ ok: true, bookingId: `clsbk_g${++n}`, settled: true }))
  mockSettleOrder.mockResolvedValue(true)
  mockAlert.mockResolvedValue({ attempted: 2, sent: 2 })
  mockNoteId.mockResolvedValue(true)
})

describe('guest-seat ticket', () => {
  it('reads back what was signed', () => {
    const j = job()
    expect(ticketOf(j)).toMatchObject({ kind: 'guest-seats', ...j })
  })
  it('refuses a tampered, foreign or junk ticket', () => {
    const t = issueGuestSeatTicket(job())
    const [body, mac] = t.split('.')
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), totalSeats: 9 })).toString('base64url')
    expect(readGuestSeatTicket(`${forged}.${mac}`)).toBeNull()
    expect(readGuestSeatTicket(issueSignedToken({ kind: 'email-fix' }, 60_000))).toBeNull()
    expect(readGuestSeatTicket('nope')).toBeNull()
    expect(readGuestSeatTicket(undefined)).toBeNull()
  })
  it('the job key depends on the secret', () => {
    expect(guestSeatJobKey('a')).not.toBe(guestSeatJobKey('b'))
    expect(guestSeatJobKey('a')).toBe(guestSeatJobKey('a'))
  })
})

describe('runGuestSeat', () => {
  it('adds the seat, settles it against the paid booking, and notes it on the seat record', async () => {
    const t = ticketOf(job())
    expect(await runGuestSeat(t, 2)).toEqual({ ok: true, bookingId: 'clsbk_g1' })
    expect(mockOne).toHaveBeenCalledWith(expect.objectContaining({
      scheduleId: 'clssch_pails', seat: 2, totalSeats: 3, what: 'Online seat', settleAs: settleLabel(t.paidBookingId),
      holder: { givenName: 'Maxie', familyName: 'Gardner', email: 'maxie@example.com' },
    }))
    expect(mockNoteId).toHaveBeenCalledWith('clssch_pails', t.paidBookingId, 'clsbk_g1')
    expect(mockAlert).not.toHaveBeenCalled()
  })

  it('running the same seat again never adds a second guest', async () => {
    const t = ticketOf(job())
    await runGuestSeat(t, 2)
    expect(await runGuestSeat(t, 2)).toEqual({ ok: true, bookingId: 'clsbk_g1' })
    expect(mockOne).toHaveBeenCalledTimes(1)
    expect(mockSettleOrder).not.toHaveBeenCalled()
  })

  it('a seat added but left unpaid-looking is settled on the retry, not re-added', async () => {
    mockOne.mockResolvedValueOnce({ ok: true, bookingId: 'clsbk_g1', settled: false })
    const t = ticketOf(job())
    await runGuestSeat(t, 2)
    expect(mockAlert).toHaveBeenCalledTimes(1)
    expect(mockAlert.mock.calls[0][0]).toMatch(/^Guest seat 2 of 3 for Maxie Gardner .* shows as not paid\. It is paid/)
    await runGuestSeat(t, 2)
    expect(mockOne).toHaveBeenCalledTimes(1)
    expect(mockSettleOrder).toHaveBeenCalledWith('clssch_pails', 'clsbk_g1', null, settleLabel(t.paidBookingId))
  })

  it('when Square won’t add a seat, texts the owners exactly which seats to add by hand', async () => {
    mockOne.mockResolvedValue({ ok: false, stopped: { kind: 'signed_out', detail: '401' } })
    const t = ticketOf(job({ totalSeats: 4 }))
    expect(await runGuestSeat(t, 3)).toEqual({ ok: false, kind: 'signed_out' })
    expect(mockAlert).toHaveBeenCalledTimes(1)
    const text = mockAlert.mock.calls[0][0]
    expect(text).toMatch(/^Add 2 guest seats in Square by hand: Maxie Gardner paid online for 4 seats in Bedazzled Pumpkin Pails/)
    expect(text).toContain('Square only has 2')
    expect(text).toContain('seats 3–4')
    expect(text).toContain('nothing to collect')
    expect(text).toContain('sign-in has expired')
    expect(mockNoteId).not.toHaveBeenCalled()
  })

  it('a failed seat is tried again on the next run (nothing remembered for it)', async () => {
    mockOne.mockResolvedValueOnce({ ok: false, stopped: { kind: 'no_answer', detail: 'timeout' } })
    const t = ticketOf(job())
    await runGuestSeat(t, 2)
    expect(await runGuestSeat(t, 2)).toEqual({ ok: true, bookingId: 'clsbk_g1' })
    expect(mockOne).toHaveBeenCalledTimes(2)
  })

  it('refuses seat numbers outside 2..totalSeats', async () => {
    const t = ticketOf(job({ totalSeats: 2 }))
    for (const seat of [1, 3, 0, 2.5, NaN]) expect(await runGuestSeat(t, seat)).toEqual({ ok: false, kind: 'bad_seat' })
    expect(mockOne).not.toHaveBeenCalled()
  })
})

describe('startGuestSeats', () => {
  it('hands the ticket to the background function and texts no one when it takes it', async () => {
    const ask = vi.fn(async () => new Response('', { status: 202 }))
    expect(await startGuestSeats('https://ourhometownstudio.com/', 'TICKET', job(), ask as any)).toBe(true)
    const [url, init] = ask.mock.calls[0] as any
    expect(url).toBe('https://ourhometownstudio.com/.netlify/functions/guest-seats-background')
    expect(JSON.parse(init.body)).toEqual({ ticket: 'TICKET', seats: 3 })
    expect(mockAlert).not.toHaveBeenCalled()
  })
  it('texts the owners to add the seats by hand when the function says no', async () => {
    const ask = vi.fn(async () => new Response('', { status: 500 }))
    expect(await startGuestSeats('https://x.test', 'T', job({ totalSeats: 2 }), ask as any)).toBe(false)
    expect(mockAlert.mock.calls[0][0]).toMatch(/^Add 1 guest seat in Square by hand: Maxie Gardner paid online for 2 seats/)
  })
  it('texts the owners when the function can’t be reached', async () => {
    const ask = vi.fn(async () => { throw new Error('offline') })
    expect(await startGuestSeats('https://x.test', 'T', job(), ask as any)).toBe(false)
    expect(mockAlert.mock.calls[0][0]).toMatch(/^Add 2 guest seats in Square by hand/)
  })
})
