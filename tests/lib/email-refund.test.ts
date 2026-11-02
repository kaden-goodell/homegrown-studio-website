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
  it('a duplicate payment is worded as a refund of the extra payment, never a cancellation, with no date (M3)', async () => {
    await email.sendRefundEmail({ to: 'a@example.com', givenName: 'Alice', className: 'your party', cents: 30000, keptSeat: false, party: { startIso: null }, duplicate: 'changed-party' })
    let m = mockSendMail.mock.calls[0][0]
    // An earlier try: never assumes they booked again after it (M-5).
    expect(m.text).toContain('We refunded $300 to your card for an earlier party checkout you changed and started again.')
    expect(m.text).toContain('If you finished booking after that, your party is still booked.')
    expect(m.text).not.toMatch(/charged twice|hasn’t changed/)
    expect(m.text).not.toMatch(/craft with you again|Saturday/)
    await email.sendRefundEmail({ to: 'a@example.com', givenName: 'Alice', className: 'your party', cents: 30000, keptSeat: false, party: { startIso: null }, duplicate: 'unmatched-party' })
    m = mockSendMail.mock.calls[1][0]
    expect(m.text).toContain('We refunded $300 to your card for a party payment we couldn’t match to a booking.')
    await email.sendRefundEmail({ to: 'a@example.com', givenName: 'Ada', className: 'Candles', cents: 3270, keptSeat: false, duplicate: 'class-twice' })
    m = mockSendMail.mock.calls[2][0]
    expect(m.text).toContain('You were charged twice for Candles. We refunded the extra $32.70 to your card.')
    expect(m.text).toContain('Your booking hasn’t changed.')
    // Paid after the last seats went: says why they aren't booked (M-5).
    await email.sendRefundEmail({ to: 'a@example.com', givenName: 'Ada', className: 'Camp 3', cents: 6540, keptSeat: false, duplicate: 'class-no-seats' })
    m = mockSendMail.mock.calls[3][0]
    expect(m.text).toContain('Your payment for Camp 3 came through after its last seats were taken, so you aren’t booked. We refunded the full $65.40 to your card.')
    for (const c of mockSendMail.mock.calls) expect(c[0].text.split('Text us at')[0]).not.toContain(':')
  })

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
  it('a party refund: "your party on <day>", still booked or craft again; never the surname label', async () => {
    await email.sendRefundEmail({ to: 'stef@example.com', givenName: 'Stefanie', className: 'your party', cents: 5000, keptSeat: true, party: { startIso: '2026-11-14T19:30:00.000Z' } })
    let m = mockSendMail.mock.calls[0][0]
    expect(m.text).toContain('We refunded $50 to your card for your party on Saturday, November 14.')
    expect(m.text).toContain('Your party is still booked, so we will see you then.')
    expect(m.text).not.toMatch(/class|Justice/)
    await email.sendRefundEmail({ to: 'stef@example.com', givenName: 'Stefanie', className: 'your party', cents: 5000, keptSeat: false, party: { startIso: null } })
    m = mockSendMail.mock.calls[1][0]
    expect(m.text).toContain('We refunded $50 to your card for your party.')
    expect(m.text).toContain('We hope to craft with you again soon.')
    expect(m.text).not.toContain('class')
  })
})
