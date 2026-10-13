import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRun = vi.fn()
vi.mock('@lib/guest-seat-job', async (orig) => ({
  ...(await orig<typeof import('@lib/guest-seat-job')>()),
  runGuestSeat: (...a: any[]) => mockRun(...a),
}))

import { POST } from '@pages/api/jobs/guest-seat.json'
import { guestSeatJobKey, issueGuestSeatTicket } from '@lib/guest-seat-job'

const SECRET = 'test-signing-secret'
const job = {
  scheduleId: 'clssch_pails', startAt: '2026-10-18T18:00:00Z', className: 'Pails',
  holder: { givenName: 'Maxie', familyName: 'Gardner', email: 'm@example.com' }, totalSeats: 2, paidBookingId: 'clsbk_1',
}
const call = (body: unknown, key: string | null = guestSeatJobKey(SECRET)) =>
  POST({ request: new Request('https://ourhometownstudio.com/api/jobs/guest-seat.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key ? { 'x-job-key': key } : {}) },
    body: JSON.stringify(body),
  }) } as any)

beforeEach(() => {
  vi.stubEnv('LOOKUP_SIGNING_SECRET', SECRET)
  vi.clearAllMocks()
  mockRun.mockResolvedValue({ ok: true, bookingId: 'clsbk_g1' })
})

describe('POST /api/jobs/guest-seat.json', () => {
  it('needs the job key', async () => {
    expect(SECRET).toBeTruthy()
    expect((await call({ ticket: issueGuestSeatTicket(job), seat: 2 }, null)).status).toBe(403)
    expect((await call({ ticket: issueGuestSeatTicket(job), seat: 2 }, 'wrong')).status).toBe(403)
    expect(mockRun).not.toHaveBeenCalled()
  })
  it('needs a ticket the site signed', async () => {
    expect((await call({ ticket: 'forged.x', seat: 2 })).status).toBe(400)
    expect(mockRun).not.toHaveBeenCalled()
  })
  it('runs the seat and answers with the guest booking', async () => {
    const res = await call({ ticket: issueGuestSeatTicket(job), seat: 2 })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, bookingId: 'clsbk_g1' })
    expect(mockRun).toHaveBeenCalledWith(expect.objectContaining({ kind: 'guest-seats', paidBookingId: 'clsbk_1' }), 2)
  })
  it('a seat Square refused is a 409 (the owners were texted), a bad seat a 400, a crash a 500', async () => {
    mockRun.mockResolvedValueOnce({ ok: false, kind: 'refused' })
    expect((await call({ ticket: issueGuestSeatTicket(job), seat: 2 })).status).toBe(409)
    mockRun.mockResolvedValueOnce({ ok: false, kind: 'bad_seat' })
    expect((await call({ ticket: issueGuestSeatTicket(job), seat: 9 })).status).toBe(400)
    mockRun.mockRejectedValueOnce(new Error('boom'))
    expect((await call({ ticket: issueGuestSeatTicket(job), seat: 2 })).status).toBe(500)
  })
})
