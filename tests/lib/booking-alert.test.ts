import { describe, it, expect, vi, beforeEach } from 'vitest'
const alertOwners = vi.fn(async () => ({ attempted: 2, sent: 2 }))
vi.mock('@lib/owner-alert', () => ({ alertOwners: (...a: unknown[]) => alertOwners(...(a as [])) }))
const sendEmail = vi.fn(async () => ({ sent: true }))
vi.mock('@lib/email', () => ({ sendEmail: (...a: unknown[]) => sendEmail(...(a as [])) }))
import { announceBooking, bookingNewsText } from '@lib/booking-alert'
import { siteConfig } from '@config/site.config'

const news = { kind: 'class' as const, who: 'Meredith Black', what: '1 seat, Bedazzled Pumpkin Pails', when: 'Sun, Oct 18 · 1:00 PM', paidCents: 2725, email: 'm@example.com', phone: '9045550100', extra: 'Pumpkin color: Lavender ×1' }

beforeEach(() => vi.clearAllMocks())

describe('announceBooking', () => {
  it('texts the owner phones and emails both owners', async () => {
    await announceBooking(news)
    expect(alertOwners).toHaveBeenCalledWith('New class booking: Meredith Black, 1 seat, Bedazzled Pumpkin Pails, Sun, Oct 18 · 1:00 PM. $27.25 paid. Pumpkin color: Lavender ×1.')
    expect(siteConfig.ownerEmails).toEqual(['kaden@ourhometownstudio.com', 'catherine@ourhometownstudio.com'])
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'kaden@ourhometownstudio.com, catherine@ourhometownstudio.com' }))
  })

  it('never throws, even when both channels fail', async () => {
    alertOwners.mockRejectedValueOnce(new Error('quo down') as never)
    sendEmail.mockRejectedValueOnce(new Error('smtp down') as never)
    await expect(announceBooking(news)).resolves.toBeUndefined()
  })

  it('reads like a text', () => {
    expect(bookingNewsText({ ...news, kind: 'party', what: 'Patch & Personalize party, about 12 guests', paidCents: 30000, extra: undefined })).toBe(
      'New party booking: Meredith Black, Patch & Personalize party, about 12 guests, Sun, Oct 18 · 1:00 PM. $300 paid.',
    )
  })
})
