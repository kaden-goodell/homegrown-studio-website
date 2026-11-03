// tests/lib/classes/resend-confirmation.test.ts — owner-tapped class emails (final review I1, I6). Never automatic, always audited.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ emails: [] as any[], audits: [] as any[], named: [] as any[], ledger: { classId: 'cls_r1', lines: [] as any[] }, cls: null as any, sendOk: true }))
vi.mock('@lib/email', () => ({ sendWorkshopConfirmationEmail: async (x: any) => { h.emails.push(x); return { sent: h.sendOk } } }))
vi.mock('@lib/audit', () => ({ recordAudit: async (x: any) => { h.audits.push(x) } }))
vi.mock('@lib/classes/class-store', async (orig) => ({ ...(await orig<any>()), getClass: async (id: string) => (h.cls?.id === id ? h.cls : null) }))
vi.mock('@lib/classes/seat-ledger', async (orig) => ({
  ...(await orig<any>()),
  getLedger: async () => h.ledger,
  setNames: async (classId: string, lineIds: string[], customer: any) => { h.named.push({ classId, lineIds, customer }) },
}))

import { emailMovedBookings, MOVED_LEAD, resendBookingConfirmation } from '@lib/classes/resend-confirmation'
import { defaultRules } from '@lib/classes/validate'

const by = { id: 'owner', name: 'Catherine' }
const line = (o: any = {}) => ({
  id: 'led_1', bookingId: 'bkg_1', sessionIds: ['ses_1'], ticketTypeId: 'person', passId: 'all', seat: 1, priceCents: 3000, taxCents: 270,
  addOns: {}, addOnCents: 0, addOnTaxCents: 0, answers: {}, source: 'online', state: 'confirmed', holdExpiresAt: null,
  customer: { givenName: 'Ada', familyName: 'L', email: 'ada@example.com', phone: '(256) 555-0100' },
  square: { orderId: 'o1', paymentId: 'p1', lineUid: null, chargedCents: 3270 }, by: null, refunds: [], at: '2031-01-01T00:00:00Z', ...o,
})

beforeEach(() => {
  h.emails = []; h.audits = []; h.named = []; h.sendOk = true
  h.cls = {
    id: 'cls_r1', libraryId: null, libraryVersion: null, status: 'open',
    content: { name: 'Pottery', description: 'Mud.', imageUrl: null, instructor: null, rules: defaultRules(), ticketTypes: [{ id: 'person', label: 'Person' }], passes: [{ id: 'all', label: 'All', covers: { kind: 'all' } }], prices: { all: { person: 3000 } }, questions: [], addOns: [], defaultCapacity: 8, defaultMinutes: 90 },
    sessions: [{ id: 'ses_1', startIso: '2031-03-12T16:00:00.000Z', endIso: '2031-03-12T17:30:00.000Z', capacity: 8 }],
    square: { itemId: null, variations: {} }, createdAt: '', updatedAt: '', by, history: [],
  }
  h.ledger = { classId: 'cls_r1', lines: [line(), line({ id: 'led_2', bookingId: 'bkg_2', customer: { givenName: 'Bo', familyName: 'D', email: '', phone: '1' } })] }
})

describe('Email them their booking again (I6)', () => {
  it('sends the same confirmation, with their cancel link, to the email on file; audited', async () => {
    const r = await resendBookingConfirmation({ id: 'cls_r1', bookingId: 'bkg_1' }, by)
    expect(r.data).toEqual({ sent: true, to: 'ada@example.com', emailChanged: false })
    expect(h.emails).toHaveLength(1)
    expect(h.emails[0]).toMatchObject({ to: 'ada@example.com', bookingId: 'bkg_1', workshopName: 'Pottery', totalChargedCents: 3270 })
    expect(h.emails[0].cancelUrl).toMatch(/\/classes\/cancel\//)
    expect(h.named).toHaveLength(0)
    expect(h.audits.map((a) => a.action)).toEqual(['class-confirmation-resent'])
  })

  it('a corrected email is saved on the booking first (audited with both), then the email goes there', async () => {
    const r = await resendBookingConfirmation({ id: 'cls_r1', bookingId: 'bkg_1', email: ' Ada@Gmail.com ' }, by)
    expect(r.data).toEqual({ sent: true, to: 'ada@gmail.com', emailChanged: true })
    expect(h.named).toEqual([{ classId: 'cls_r1', lineIds: ['led_1'], customer: expect.objectContaining({ email: 'ada@gmail.com', givenName: 'Ada' }) }])
    expect(h.emails[0].to).toBe('ada@gmail.com')
    expect(h.audits[0]).toMatchObject({ action: 'class-booking-email-fixed', details: { bookingId: 'bkg_1', from: 'ada@example.com', to: 'ada@gmail.com' } })
  })

  it('refuses a bad email, a booking with no email, a booking nobody is coming on, a cancelled class; says when it didn’t go', async () => {
    await expect(resendBookingConfirmation({ id: 'cls_r1', bookingId: 'bkg_1', email: 'ada@' }, by)).rejects.toMatchObject({ status: 400 })
    await expect(resendBookingConfirmation({ id: 'cls_r1', bookingId: 'bkg_2' }, by)).rejects.toMatchObject({ status: 400, message: 'There’s no email on this booking. Type one in.' })
    h.ledger.lines[0] = line({ refunds: [{ at: 'x', cents: 3270, reason: 'r', by, freedSeat: true, squareRefundId: 'r1' }], state: 'refunded' })
    await expect(resendBookingConfirmation({ id: 'cls_r1', bookingId: 'bkg_1' }, by)).rejects.toMatchObject({ status: 409 })
    h.ledger.lines[0] = line()
    h.sendOk = false
    await expect(resendBookingConfirmation({ id: 'cls_r1', bookingId: 'bkg_1' }, by)).rejects.toMatchObject({ status: 502 })
    h.cls.status = 'cancelled'
    await expect(resendBookingConfirmation({ id: 'cls_r1', bookingId: 'bkg_1' }, by)).rejects.toMatchObject({ status: 409 })
    expect(h.named).toHaveLength(0)
  })
})

describe('Email everyone the new details (I1)', () => {
  it('emails each booking on the moved date with the new time, and a calendar file that replaces the old event', async () => {
    const r = await emailMovedBookings({ id: 'cls_r1', movedFrom: { ses_1: '2031-03-12T15:00:00.000Z', ses_x: '2031-01-01T00:00:00Z' } }, by)
    expect(r.data).toEqual({ sent: ['Ada L'], failed: [], noEmail: ['Bo D'] })
    expect(h.emails).toHaveLength(1)
    expect(h.emails[0].lead).toBe(MOVED_LEAD)
    expect(h.emails[0].icsContent).toContain('UID:class-20310312T150000Z@ourhometownstudio.com')
    expect(h.emails[0].icsContent).toContain('DTSTART:20310312T160000Z')
    expect(h.emails[0].icsContent).toMatch(/SEQUENCE:\d+/)
    expect(h.audits[0]).toMatchObject({ action: 'class-move-emailed', details: { sent: 1, failed: 0, noEmail: 1 } })
  })

  it('needs the moved dates', async () => {
    await expect(emailMovedBookings({ id: 'cls_r1', movedFrom: {} }, by)).rejects.toMatchObject({ status: 400 })
    expect(h.emails).toHaveLength(0)
  })
})
