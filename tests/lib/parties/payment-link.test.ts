// @vitest-environment node
/**
 * The payment link sender: the link URL uses the payment key (never the host
 * page key), the host is emailed and texted, `linkSent` is noted, and on a
 * namespaced preview both messages go to Kaden. Real email/text code with the
 * transports faked (nodemailer, Quo's HTTP API): nothing leaves the machine.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const m = vi.hoisted(() => ({ sendMail: vi.fn() }))
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: (...a: any[]) => m.sendMail(...a) }) } }))

import { payLinkUrl, sendPaymentLink, paymentLinkText, PaymentLinkError } from '@lib/parties/payment-link'
import { createPartyRecord, getPartyRecord, type PartyRecord } from '@lib/party-store'
import { PREVIEW_EMAIL_TO, PREVIEW_SMS_TO } from '@lib/preview-outbound'
import { sendPartyPaidEmail } from '@lib/email'

const KADEN = { id: 'k', name: 'Kaden' }
let n = 0
function party(over: Partial<PartyRecord> = {}): PartyRecord {
  n++
  return {
    bookingId: `pty_${String(n).padStart(16, '0')}`, hostToken: 'host-key-aaaa', craftName: 'Tote Bags',
    startIso: '2026-11-08T19:30:00.000Z', // Sun, Nov 8 at 1:30 PM Central
    durationMinutes: 90, hostName: 'Alice Smith', hostEmail: 'alice@example.com', hostPhone: '256-555-1234',
    guestCount: 10, title: null, dropOff: false, createdAt: '2026-10-19T00:00:00.000Z',
    source: 'ours', status: 'booked', packageId: 'pkg_whole', payToken: 'pay-key-bbbb',
    items: [{ id: 'itm_1', kind: 'package', refId: 'pkg_whole', label: 'Whole studio', qty: 1, unitCents: 30000, cents: 30000, extraMinutes: 0, chargeId: null, addedAt: '2026-10-19T00:00:00.000Z', by: KADEN }],
    charges: [], refunds: [],
    ...over,
  }
}

const env = { ...process.env }
let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  process.env.GMAIL_USER = 'studio@example.com'
  process.env.GMAIL_APP_PASSWORD = 'app-pass'
  process.env.QUO_API_KEY = 'quo-key'
  process.env.QUO_FROM_NUMBER = '+12564641710'
  delete process.env.STORE_NAMESPACE
  m.sendMail.mockReset().mockResolvedValue({})
  fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => '' }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  process.env = { ...env }
  vi.unstubAllGlobals()
})

describe('payLinkUrl', () => {
  it('carries the payment key, never the host page key', () => {
    const url = payLinkUrl('https://ourhometownstudio.com/', party())
    expect(url).toMatch(/^https:\/\/ourhometownstudio\.com\/party\/pay\/pty_\d+\?k=pay-key-bbbb$/)
    expect(url).not.toContain('host-key-aaaa')
  })
})

describe('sendPaymentLink', () => {
  it('emails and texts the host the link and notes linkSent', async () => {
    const rec = party()
    await createPartyRecord(rec)
    const out = await sendPaymentLink(rec, 'https://ourhometownstudio.com', KADEN)
    expect(out).toMatchObject({ email: true, text: true })
    expect(m.sendMail).toHaveBeenCalledTimes(1)
    const mail = m.sendMail.mock.calls[0][0]
    expect(mail.to).toBe('alice@example.com')
    expect(mail.text).toContain(out.url)
    expect(mail.text).toContain('$300')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const sms = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(sms.to).toEqual(['+12565551234'])
    expect(sms.content).toBe(`Hometown Studio here. Your party on Sun, Nov 8 at 1:30 PM is held for you. Pay $300 here to finish booking ${out.url}`)
    const saved = await getPartyRecord(rec.bookingId)
    expect(saved!.linkSent).toEqual([{ at: expect.any(String), by: KADEN, email: true, text: true }])
    expect(saved!.history!.at(-1)).toMatchObject({ by: KADEN, change: 'Payment link emailed and texted' })
  })

  it('on a namespaced preview both go to Kaden, marked with who they were for', async () => {
    process.env.STORE_NAMESPACE = 'preview'
    const rec = party()
    await createPartyRecord(rec)
    await sendPaymentLink(rec, 'https://preview.example', KADEN)
    const mail = m.sendMail.mock.calls[0][0]
    expect(mail.to).toBe(PREVIEW_EMAIL_TO)
    expect(mail.subject).toContain('alice@example.com')
    const sms = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(sms.to).toEqual([PREVIEW_SMS_TO])
    expect(sms.content).toContain('256-555-1234')
  })

  it('a text that fails still sends the email and notes which went out', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'down' })
    const rec = party()
    await createPartyRecord(rec)
    expect(await sendPaymentLink(rec, 'https://x.example', null)).toMatchObject({ email: true, text: false })
    expect((await getPartyRecord(rec.bookingId))!.linkSent![0]).toMatchObject({ email: true, text: false })
  })

  it('refuses a party that owes nothing, is cancelled, or is not ours', async () => {
    await expect(sendPaymentLink(party({ items: [] }), 'https://x', null)).rejects.toBeInstanceOf(PaymentLinkError)
    await expect(sendPaymentLink(party({ status: 'cancelled' }), 'https://x', null)).rejects.toBeInstanceOf(PaymentLinkError)
    await expect(sendPaymentLink(party({ source: undefined }), 'https://x', null)).rejects.toBeInstanceOf(PaymentLinkError)
    expect(m.sendMail).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('only extras due (the party is paid): the second wording, by text and email', async () => {
    const base = party()
    const rec = party({ items: [{ ...base.items![0], chargeId: 'chg_x' }, { ...base.items![0], id: 'itm_2', kind: 'addon', label: 'Balloons', cents: 2500, unitCents: 2500, chargeId: null }] })
    expect(paymentLinkText(rec, 'U')).toBe('Hometown Studio here. Pay $25 here for the extras added to your party on Sun, Nov 8 at 1:30 PM U')
    await createPartyRecord(rec)
    await sendPaymentLink(rec, 'https://x.example', KADEN)
    const mail = m.sendMail.mock.calls[0][0]
    expect(mail.subject).toBe('Pay for the extras on your party')
    expect(mail.text).toContain('Pay $25 here for them.')
    expect(mail.text).not.toContain('to finish booking')
  })
})

describe('sendPartyPaidEmail', () => {
  it('says the party is paid only when nothing is still due', async () => {
    await sendPartyPaidEmail({ to: 'a@example.com', givenName: 'Alice', whenLabel: 'Sun, Nov 8 at 1:30 PM', paidCents: 30000, receiptUrl: null })
    await sendPartyPaidEmail({ to: 'a@example.com', givenName: 'Alice', whenLabel: 'Sun, Nov 8 at 1:30 PM', paidCents: 30000, receiptUrl: null, stillDueCents: 2500 })
    expect(m.sendMail.mock.calls.map(([x]) => x.subject)).toEqual(['Your party is paid', 'We got your payment'])
    expect(m.sendMail.mock.calls[1][0].text).toContain('There is still $25 to pay for extras added since.')
  })
})
