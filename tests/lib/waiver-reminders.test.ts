import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockWorkshops = vi.fn()
const mockGetSeat = vi.fn()
const mockSeats = vi.fn()
const mockRsvps = vi.fn()
const mockWaiver = vi.fn()
const mockHousehold = vi.fn()
const mockEmail = vi.fn()
const mockText = vi.fn()
let quoOn = true

vi.mock('@config/providers', () => ({
  providers: { workshop: { listAllWorkshops: (...a: any[]) => mockWorkshops(...a), getSeatBooking: (...a: any[]) => mockGetSeat(...a) } },
}))
vi.mock('@lib/seat-choices', () => ({ listSeatChoicesByEvent: (...a: any[]) => mockSeats(...a) }))
vi.mock('@lib/rsvp-store', () => ({ listRsvpsByEvent: (...a: any[]) => mockRsvps(...a) }))
vi.mock('@lib/waiver-store', () => ({ getWaiverRecord: (...a: any[]) => mockWaiver(...a), lookupHouseholdEntry: (...a: any[]) => mockHousehold(...a) }))
vi.mock('@lib/email', () => ({ sendEmail: (...a: any[]) => mockEmail(...a) }))
vi.mock('@lib/quo', async (orig) => ({
  ...(await orig<typeof import('@lib/quo')>()),
  sendQuoText: (...a: any[]) => mockText(...a),
  quoConfigured: () => quoOn,
}))

import { planWaiverReminders, runWaiverReminders, ownerSummary, shortTime, classList, reminderText, reminderEmail } from '@lib/waiver-reminders'
import { substantiveSince } from '@config/waiver-content'

// Sun 18 Oct 2026, 9:00 AM CDT
const NOW = new Date('2026-10-18T14:00:00.000Z')
const PAILS = { id: 'i1', scheduleId: 'clssch_pails', name: 'Bedazzled Pumpkin Pails', startAt: '2026-10-18T18:00:00.000Z' }
const COOKIES = { id: 'i2', scheduleId: 'clssch_cookie', name: 'Halloween Cookie Decorating', startAt: '2026-10-18T21:00:00.000Z' }
const CURRENT = { validUntil: '2027-10-01T00:00:00.000Z', agreementVersion: substantiveSince }
const EXPIRED = { validUntil: '2026-10-01T00:00:00.000Z', agreementVersion: substantiveSince }
const OLD = { validUntil: '2027-10-01T00:00:00.000Z', agreementVersion: 'v0' }

let n = 0
function seat(over: any = {}) {
  n++
  const email = over.email ?? `family${n}-${Date.now()}@example.com`
  return {
    eventKind: 'workshop', eventId: 'clssch_pails', bookingId: `clsbk_${n}`, orderId: null,
    customer: { givenName: over.givenName ?? 'Maxie', familyName: over.familyName ?? 'Gardner', email, phone: over.phone ?? '(256) 585-9819' },
    seats: 1, picks: [], at: '2026-10-12T00:00:00.000Z', attemptId: 'a', ...over.record,
  }
}
const accepted = (w = PAILS) => async (id: string) => ({ id, status: 'accepted', startAt: w.startAt, scheduleId: w.scheduleId })

beforeEach(() => {
  vi.clearAllMocks()
  quoOn = true
  mockWorkshops.mockResolvedValue([PAILS])
  mockSeats.mockResolvedValue([])
  mockRsvps.mockResolvedValue([])
  mockHousehold.mockResolvedValue(null)
  mockWaiver.mockResolvedValue(null)
  mockGetSeat.mockImplementation(accepted())
  mockEmail.mockResolvedValue({ sent: true })
  mockText.mockResolvedValue(undefined)
})

describe('who gets reminded', () => {
  it('someone booked today with nothing on file is reminded', async () => {
    const s = seat()
    mockSeats.mockResolvedValue([s])
    const plan = await planWaiverReminders(NOW)
    expect(plan.remind.map((f) => [f.email, f.state])).toEqual([[s.customer.email, 'none']])
    expect(plan.signed).toEqual([])
  })

  it('a current agreement under their email: not reminded', async () => {
    const s = seat()
    mockSeats.mockResolvedValue([s])
    mockHousehold.mockImplementation(async (c: string) => (c === s.customer.email ? CURRENT : null))
    const plan = await planWaiverReminders(NOW)
    expect(plan.remind).toEqual([])
    expect(plan.signed.map((f) => f.email)).toEqual([s.customer.email])
  })

  it('signed with a different email but the same phone: not reminded', async () => {
    const s = seat()
    mockSeats.mockResolvedValue([s])
    mockHousehold.mockImplementation(async (c: string) => (c.includes('@') ? null : CURRENT))
    expect((await planWaiverReminders(NOW)).remind).toEqual([])
  })

  it('signed through this booking’s own link with a different email and phone: not reminded', async () => {
    const s = seat()
    mockSeats.mockResolvedValue([s])
    mockRsvps.mockResolvedValue([{ waiverId: 'wvr_1', ref: { bookingId: s.bookingId } }])
    mockWaiver.mockImplementation(async (id: string) => (id === 'wvr_1' ? CURRENT : null))
    expect((await planWaiverReminders(NOW)).signed).toHaveLength(1)
  })

  it('a signature through ANOTHER booking’s link does not count for this one', async () => {
    const s = seat()
    mockSeats.mockResolvedValue([s])
    mockRsvps.mockResolvedValue([{ waiverId: 'wvr_1', ref: { bookingId: 'clsbk_someone_else' } }])
    mockWaiver.mockResolvedValue(CURRENT)
    expect((await planWaiverReminders(NOW)).remind).toHaveLength(1)
  })

  it('an expired agreement is reminded, marked expired', async () => {
    mockSeats.mockResolvedValue([seat()])
    mockHousehold.mockResolvedValue(EXPIRED)
    expect((await planWaiverReminders(NOW)).remind[0].state).toBe('expired')
  })

  it('an agreement on old terms is reminded, marked outdated', async () => {
    mockSeats.mockResolvedValue([seat()])
    mockHousehold.mockResolvedValue(OLD)
    expect((await planWaiverReminders(NOW)).remind[0].state).toBe('outdated')
  })

  it('a booking Square says was cancelled is left out entirely', async () => {
    mockSeats.mockResolvedValue([seat()])
    mockGetSeat.mockImplementation(async (id: string) => ({ id, status: 'canceled_by_seller', startAt: PAILS.startAt, scheduleId: PAILS.scheduleId }))
    const plan = await planWaiverReminders(NOW)
    expect([plan.remind, plan.signed, plan.unsure]).toEqual([[], [], []])
  })

  it('a booking Square no longer has is left out', async () => {
    mockSeats.mockResolvedValue([seat()])
    mockGetSeat.mockResolvedValue(null)
    expect((await planWaiverReminders(NOW)).remind).toEqual([])
  })

  it('a booking Square moved to another time or class is left out', async () => {
    mockSeats.mockResolvedValue([seat()])
    mockGetSeat.mockImplementation(async (id: string) => ({ id, status: 'accepted', startAt: '2026-10-25T18:00:00.000Z', scheduleId: PAILS.scheduleId }))
    expect((await planWaiverReminders(NOW)).remind).toEqual([])
  })

  it('counts a multi-seat booking if any one of its Square seats is still accepted', async () => {
    mockSeats.mockResolvedValue([seat({ record: { squareBookingIds: ['clsbk_a', 'clsbk_b'] } })])
    mockGetSeat.mockImplementation(async (id: string) => (id === 'clsbk_a' ? null : { id, status: 'accepted', startAt: PAILS.startAt, scheduleId: PAILS.scheduleId }))
    expect((await planWaiverReminders(NOW)).remind).toHaveLength(1)
  })

  it('a staff seat added in Square by hand (no Square id) counts as booked', async () => {
    mockSeats.mockResolvedValue([seat({ record: { bookingId: 'comp_abc123', comped: true } })])
    expect((await planWaiverReminders(NOW)).remind).toHaveLength(1)
    expect(mockGetSeat).not.toHaveBeenCalled()
  })

  it('when Square can’t be asked, never guesses: no message, owners told', async () => {
    mockSeats.mockResolvedValue([seat()])
    mockGetSeat.mockRejectedValue(new Error('Square 503'))
    const plan = await planWaiverReminders(NOW)
    expect(plan.remind).toEqual([])
    expect(plan.unsure[0].why).toMatch(/couldn't confirm their Bedazzled Pumpkin Pails booking/)
  })

  it('when the signed agreements can’t be read, never guesses: no message, owners told', async () => {
    mockSeats.mockResolvedValue([seat()])
    mockHousehold.mockRejectedValue(new Error('blobs down'))
    const plan = await planWaiverReminders(NOW)
    expect(plan.remind).toEqual([])
    expect(plan.unsure[0].why).toBe("couldn't read the signed agreements")
  })

  it('a class that has started, or is on another day, is left out', async () => {
    mockWorkshops.mockResolvedValue([
      { ...PAILS, scheduleId: 'early', startAt: '2026-10-18T13:30:00.000Z' },
      { ...PAILS, scheduleId: 'tomorrow', startAt: '2026-10-19T18:00:00.000Z' },
      { ...PAILS, scheduleId: 'yesterday', startAt: '2026-10-17T23:00:00.000Z' },
    ])
    mockSeats.mockResolvedValue([seat()])
    await planWaiverReminders(NOW)
    expect(mockSeats).not.toHaveBeenCalled()
  })

  it('11 PM the night before is a different day (studio time, not UTC)', async () => {
    const late = { ...PAILS, startAt: '2026-10-19T03:30:00.000Z' } // 10:30 PM Sun CDT
    mockWorkshops.mockResolvedValue([late])
    mockGetSeat.mockImplementation(accepted(late))
    mockSeats.mockResolvedValue([seat()])
    const plan = await planWaiverReminders(NOW)
    expect(plan.day).toBe('2026-10-18')
    expect(plan.remind).toHaveLength(1)
  })

  it('test bookings are ignored', async () => {
    mockSeats.mockResolvedValue([seat({ record: { simulated: true } })])
    expect((await planWaiverReminders(NOW)).remind).toEqual([])
  })

  it('one family in two classes today is one reminder listing both', async () => {
    mockWorkshops.mockResolvedValue([PAILS, COOKIES])
    const email = `two-${Date.now()}@example.com`
    mockSeats.mockImplementation(async (_k: string, id: string) => [seat({ email, record: { eventId: id, bookingId: `clsbk_for_${id}` } })])
    mockGetSeat.mockImplementation(async (bid: string) => {
      const w = bid.endsWith(PAILS.scheduleId) ? PAILS : COOKIES
      return { id: bid, status: 'accepted', startAt: w.startAt, scheduleId: w.scheduleId }
    })
    const plan = await planWaiverReminders(NOW)
    expect(plan.remind).toHaveLength(1)
    expect(classList(plan.remind[0].classes)).toBe('Bedazzled Pumpkin Pails at 1 PM and Halloween Cookie Decorating at 4 PM')
    const run = await runWaiverReminders(NOW, 'https://x.test')
    expect(mockText).toHaveBeenCalledTimes(1)
    expect(run.sent).toHaveLength(1)
  })

  it('already signed: no text and no email at all', async () => {
    const s = seat()
    mockSeats.mockResolvedValue([s])
    mockHousehold.mockResolvedValue(CURRENT)
    const run = await runWaiverReminders(NOW, 'https://x.test')
    expect(run.sent).toEqual([])
    expect(mockText).not.toHaveBeenCalled()
    expect(mockEmail.mock.calls.filter((c) => c[0].to === s.customer.email)).toEqual([])
  })

  it('no email and no usable phone: owners told, nobody to message', async () => {
    mockSeats.mockResolvedValue([seat({ email: '', phone: '12' })])
    const plan = await planWaiverReminders(NOW)
    expect(plan.unsure[0].why).toBe('no email or phone to reach them')
  })
})

describe('sending', () => {
  it('emails and texts the link once, then never again that day', async () => {
    const s = seat()
    mockSeats.mockResolvedValue([s])
    const first = await runWaiverReminders(NOW, 'https://ourhometownstudio.com')
    expect(first.sent).toEqual([expect.objectContaining({ email: true, text: true })])
    const mail = mockEmail.mock.calls.find((c) => c[0].to === s.customer.email)![0]
    expect(mail.subject).toBe('Please sign before class today')
    expect(mail.text).toContain(`/waiver?workshop=clssch_pails&booking=${s.bookingId}`)
    expect(mockText.mock.calls[0][0].content).toContain('utm_medium=sms')
    vi.clearAllMocks()
    mockEmail.mockResolvedValue({ sent: true })
    const second = await runWaiverReminders(NOW, 'https://ourhometownstudio.com')
    expect(second.sent).toEqual([])
    expect(second.plan.alreadyReminded).toHaveLength(1)
    expect(mockEmail.mock.calls.filter((c) => c[0].to === s.customer.email)).toEqual([])
    expect(mockText).not.toHaveBeenCalled()
  })

  it('a text that fails still counts the email; both failing is tried again and flagged', async () => {
    const a = seat()
    mockSeats.mockResolvedValue([a])
    mockText.mockRejectedValue(new Error('quo down'))
    const run1 = await runWaiverReminders(NOW, 'https://x.test')
    expect(run1.sent[0]).toMatchObject({ email: true, text: false })

    const b = seat()
    mockSeats.mockResolvedValue([b])
    mockEmail.mockImplementation(async ({ to }: any) => ({ sent: to !== b.customer.email }))
    const run2 = await runWaiverReminders(NOW, 'https://x.test')
    expect(run2.sent[0]).toMatchObject({ email: false, text: false })
    const summary = ownerSummary(run2.plan, run2.sent)!
    expect(summary.text).toContain('NOT REACHED')
    // Not remembered as reminded, so a later run tries again.
    expect((await planWaiverReminders(NOW)).remind.map((f) => f.email)).toEqual([b.customer.email])
  })

  it('no text when the studio’s texting isn’t set up', async () => {
    quoOn = false
    mockSeats.mockResolvedValue([seat()])
    const run = await runWaiverReminders(NOW, 'https://x.test')
    expect(run.sent[0]).toMatchObject({ email: true, text: false })
    expect(mockText).not.toHaveBeenCalled()
  })

  it('emails the owners a summary', async () => {
    const s = seat({ givenName: 'Ashley', familyName: 'Singleton' })
    const t = seat({ givenName: 'Meredith', familyName: 'Black' })
    mockSeats.mockResolvedValue([s, t])
    mockHousehold.mockImplementation(async (c: string) => (c === t.customer.email ? CURRENT : null))
    await runWaiverReminders(NOW, 'https://x.test')
    const owners = mockEmail.mock.calls.filter((c) => c[0].subject.startsWith('Waivers for today'))
    expect(owners.map((c) => c[0].to).sort()).toEqual(['catherine@ourhometownstudio.com', 'kaden@ourhometownstudio.com'])
    expect(owners[0][0].subject).toBe("Waivers for today's classes, 1 not signed yet")
    expect(owners[0][0].text).toContain('Ashley Singleton, Bedazzled Pumpkin Pails at 1 PM, emailed and texted')
    expect(owners[0][0].text).toContain('Signed and good to go\n  Meredith Black, Bedazzled Pumpkin Pails at 1 PM')
  })

  it('no classes or no bookings today: nothing sent, not even a summary', async () => {
    mockWorkshops.mockResolvedValue([])
    const run = await runWaiverReminders(NOW, 'https://x.test')
    expect(run.summarySent).toBe(false)
    expect(mockEmail).not.toHaveBeenCalled()
  })
})

describe('wording', () => {
  const fam = { key: 'k', givenName: 'Maxie', familyName: 'Gardner', email: 'm@x.com', phone: '', classes: [{ ...PAILS, bookingId: 'b' }] }
  it('times read "1 PM" and "7:30 PM"', () => {
    expect(shortTime('2026-10-18T18:00:00.000Z')).toBe('1 PM')
    expect(shortTime('2026-10-18T00:30:00.000Z')).toBe('7:30 PM')
  })
  it('lists one, two or three classes naturally', () => {
    const c = (name: string, at: string) => ({ scheduleId: 's', name, startAt: at, bookingId: 'b' })
    expect(classList([c('A', PAILS.startAt)])).toBe('A at 1 PM')
    expect(classList([c('A', PAILS.startAt), c('B', COOKIES.startAt)])).toBe('A at 1 PM and B at 4 PM')
    expect(classList([c('A', PAILS.startAt), c('B', COOKIES.startAt), c('C', '2026-10-19T00:00:00.000Z')])).toBe('A at 1 PM, B at 4 PM and C at 7 PM')
  })
  it('the text and the email', () => {
    expect(reminderText(fam, 'LINK')).toBe("Hometown Studio here. You're booked for Bedazzled Pumpkin Pails at 1 PM today. We still need a signed participation agreement before class. It takes about two minutes. LINK")
    const e = reminderEmail({ ...fam, givenName: 'Flynn' }, 'LINK')
    // The booking name is often the child's: never greet by it.
    expect(e.text.split('\n')[0]).toBe('Hi there,')
    expect(e.text).not.toContain('Flynn')
    expect(e.html).toContain('href="LINK"')
  })
})
