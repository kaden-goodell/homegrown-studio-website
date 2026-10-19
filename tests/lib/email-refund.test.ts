import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSendMail = vi.fn()
vi.mock('nodemailer', () => ({
  default: { createTransport: () => ({ sendMail: (...a: any[]) => mockSendMail(...a) }) },
}))

let email: typeof import('@lib/email')

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  process.env.GMAIL_USER = 'studio@example.com'
  process.env.GMAIL_APP_PASSWORD = 'app-password'
  mockSendMail.mockResolvedValue({})
  email = await import('@lib/email')
})

describe('sendRefundEmail', () => {
  it('says how much went back and to which card, with no colons', async () => {
    const r = await email.sendRefundEmail({ to: 'ada@example.com', givenName: 'Ada', className: 'Candles', cents: 3270, last4: '4242', keptSeat: false })
    expect(r.sent).toBe(true)
    const m = mockSendMail.mock.calls[0][0]
    expect(m.to).toBe('ada@example.com')
    expect(m.text).toContain('We refunded $32.70 to the card ending in 4242 for Candles.')
    expect(m.text).not.toContain(':')
    expect(m.subject).not.toContain(':')
  })
  it('falls back to "your card" and says they are still booked when the seat was kept', async () => {
    await email.sendRefundEmail({ to: 'ada@example.com', givenName: 'Ada', className: 'Candles', cents: 500, keptSeat: true })
    const m = mockSendMail.mock.calls[0][0]
    expect(m.text).toContain('$5 to your card')
    expect(m.text).toContain('still booked')
  })
})
