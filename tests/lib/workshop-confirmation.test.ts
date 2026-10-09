import { describe, it, expect, vi, beforeEach } from 'vitest'

const sendEmail = vi.fn()
vi.mock('@lib/email', () => ({ sendWorkshopConfirmationEmail: (...a: any[]) => sendEmail(...a) }))

import { sendWorkshopConfirmation } from '@lib/workshop-confirmation'

const workshop: any = {
  id: 'clsschi_1',
  scheduleId: 'sched_1',
  name: 'Kinusaiga',
  description: 'Japanese fabric art with no sewing.',
  startAt: '2026-10-16T00:00:00.000Z',
  durationMinutes: 120,
  priceCents: 4000,
  imageUrl: 'https://example.com/k.jpg',
}
const options: any[] = [{ id: 'color', label: 'Color', choices: ['Red', 'Blue'] }]
const base = {
  origin: 'https://ourhometownstudio.com',
  bookingId: 'clsbk_9',
  workshop,
  seats: 1,
  email: 'ada@example.com',
  givenName: 'Ada',
  receiptUrl: null,
  options,
  picks: [] as any[],
  totalChargedCents: 4000,
}

beforeEach(() => {
  sendEmail.mockReset()
  sendEmail.mockResolvedValue({ sent: true })
})

describe('sendWorkshopConfirmation', () => {
  it('turns picks into pickLines, and omits them when there are none', async () => {
    await sendWorkshopConfirmation({ ...base, picks: [{ seat: 1, optionId: 'color', choice: 'Red' }] })
    const withPicks = sendEmail.mock.calls[0][0]
    expect(withPicks.pickLines?.length).toBe(1)
    expect(withPicks.pickLines[0]).toContain('Red')
    expect(withPicks.picksFinalLine).toBeTruthy()

    await sendWorkshopConfirmation(base)
    expect(sendEmail.mock.calls[1][0].pickLines).toBeUndefined()
  })

  it('passes comped and a zero total through for a giveaway seat', async () => {
    await sendWorkshopConfirmation({ ...base, totalChargedCents: 0, comped: true })
    const arg = sendEmail.mock.calls[0][0]
    expect(arg.comped).toBe(true)
    expect(arg.totalChargedCents).toBe(0)
    // No refund terms on a free seat.
    expect(arg.policyLine).not.toMatch(/refund/i)
  })

  it('does not mark a paid booking as comped', async () => {
    await sendWorkshopConfirmation(base)
    const arg = sendEmail.mock.calls[0][0]
    expect(arg.comped).toBeUndefined()
    expect(arg.totalChargedCents).toBe(4000)
    expect(arg.policyLine).toMatch(/refund/i)
  })

  it('carries the class schedule and the booking id in the waiver URL, built from the origin', async () => {
    const sent = await sendWorkshopConfirmation(base)
    expect(sent).toBe(true)
    expect(sendEmail.mock.calls[0][0].waiverUrl).toBe('https://ourhometownstudio.com/waiver?workshop=sched_1&booking=clsbk_9')
  })
})
