// tests/lib/magnet-emails.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
const { send } = vi.hoisted(() => ({ send: vi.fn().mockResolvedValue({ sent: true }) }))
vi.mock('@lib/email', () => ({ sendEmail: send }))
import { sendMagnetConfirmation, sendMagnetOwnerNotice, sendMagnetStatusEmail } from '@lib/magnet-emails'
import type { MagnetOrder } from '@lib/magnet-status'

const o: MagnetOrder = {
  id: 'M-ABC234', createdAt: '2026-11-09T12:00:00.000Z', status: 'new', draftId: 'x', sets: 2, magnets: [],
  delivery: 'pickup', address: null, contact: { name: 'Test Person', email: 'kaden+m@ourhometownstudio.com', phone: '4029802907' },
  amounts: { subtotalCents: 3600, taxCents: 324, shippingCents: 0, totalCents: 3924 },
  squareOrderId: 's', paymentId: 'p', receiptUrl: null, doneAt: null, photosDeletedAt: null, emailed: {},
}

beforeEach(() => send.mockClear())

describe('magnet emails', () => {
  it('confirms to the customer with count, total and turnaround', async () => {
    await sendMagnetConfirmation(o)
    const msg = send.mock.calls[0][0]
    expect(msg.to).toBe('kaden+m@ourhometownstudio.com')
    expect(msg.subject).toContain('M-ABC234')
    expect(msg.text).toContain('12 photo magnets')
    expect(msg.text).toContain('$39.24')
    expect(msg.text).toContain('7 days')
  })
  it('tells the owners with an admin link', async () => {
    await sendMagnetOwnerNotice(o, 'https://ourhometownstudio.com/admin')
    expect(send.mock.calls.length).toBeGreaterThan(0)
    expect(send.mock.calls[0][0].text).toContain('https://ourhometownstudio.com/admin')
  })
  it('sends ready for pickup and shipped notices only', async () => {
    expect((await sendMagnetStatusEmail(o, 'ready')).sent).toBe(true)
    expect(send.mock.calls[0][0].subject).toContain('ready')
    expect((await sendMagnetStatusEmail(o, 'made')).sent).toBe(false)
  })
})
