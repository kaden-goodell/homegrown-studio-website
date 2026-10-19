import { describe, it, expect, vi, beforeEach } from 'vitest'

const own = vi.hoisted(() => ({ classes: [] as any[], ledgers: new Map<string, any>() }))
vi.mock('@lib/classes/class-store', () => ({ listClasses: async () => own.classes }))
vi.mock('@lib/classes/seat-ledger', async (orig) => ({
  ...(await orig<typeof import('@lib/classes/seat-ledger')>()),
  getLedger: async (id: string) => own.ledgers.get(id) ?? { classId: id, lines: [] },
}))
// Never sent from a test.
const mockAlert = vi.fn()
vi.mock('@lib/owner-alert', () => ({ alertOwners: (...a: any[]) => mockAlert(...a) }))
const mockEmail = vi.fn()
vi.mock('@lib/email', () => ({ sendEmail: (...a: any[]) => mockEmail(...a) }))

import { minimumAlertsDue, minimumAlertText, runMinimumToRunAlerts } from '@lib/classes/minimum-to-run'
import { defaultRules } from '@lib/classes/validate'

// decide by Thu 22 Oct 2026, 5 PM CDT
const DECIDE = '2026-10-22T22:00:00.000Z'
let n = 0
function potholders(over: Record<string, any> = {}): any {
  n++
  return {
    id: over.id ?? `cls_pot${n}`, libraryId: null, libraryVersion: null, status: over.status ?? 'open',
    content: {
      name: 'Potholders', description: '', imageUrl: null, instructor: null,
      rules: { ...defaultRules(), minimumToRun: over.min === undefined ? { count: 6, decideByIso: DECIDE } : over.min },
      ticketTypes: [{ id: 'person', label: 'Person' }], passes: [{ id: 'all', label: 'All', covers: { kind: 'all' } }],
      prices: { all: { person: 2000 } }, questions: [], addOns: [], defaultCapacity: 12, defaultMinutes: 90,
    },
    sessions: over.sessions ?? [{ id: 'ses_1', startIso: '2026-10-24T18:00:00.000Z', endIso: '2026-10-24T19:30:00.000Z', capacity: 12 }],
    square: { itemId: null, variations: {} }, createdAt: '', updatedAt: '', by: { id: 'k', name: 'K' }, history: [],
  }
}
const seat = (state = 'confirmed'): any => ({
  id: `led_${Math.random()}`, bookingId: `bkg_${Math.random()}`, sessionIds: ['ses_1'], ticketTypeId: 'person', passId: 'all', seat: 1,
  priceCents: 2000, taxCents: 0, addOns: {}, addOnCents: 0, addOnTaxCents: 0, answers: {}, source: 'online', state, holdExpiresAt: null,
  customer: { givenName: 'A', familyName: 'B', email: 'a@example.com', phone: '' }, square: { orderId: 'o', paymentId: 'p', lineUid: null }, by: null, refunds: [], at: '',
})
const ledgerOf = (cls: any, seats: number) => own.ledgers.set(cls.id, { classId: cls.id, lines: Array.from({ length: seats }, () => seat()) })

// Wed 21 Oct 7 AM CDT (the day before), Thu 22 Oct 7 AM CDT (the day), Tue 20 Oct (too early)
const WED = new Date('2026-10-21T12:00:00.000Z')
const THU = new Date('2026-10-22T12:00:00.000Z')
const TUE = new Date('2026-10-20T12:00:00.000Z')

beforeEach(() => {
  vi.clearAllMocks()
  own.classes = []
  own.ledgers.clear()
  mockAlert.mockResolvedValue({ attempted: 2, sent: 2 })
  mockEmail.mockResolvedValue({ sent: true })
})

describe('minimum to run', () => {
  it('the alert reads plainly with the decide-by day and time in studio time', () => {
    expect(minimumAlertText({ classId: 'c', name: 'Potholders', booked: 4, count: 6, decideByIso: DECIDE, day: '2026-10-22' })).toMatch(/^Potholders has 4 of 6, needs 6 by Thu 5 PM/)
  })

  it('is due the day before the decide-by day and on the day itself, never earlier', async () => {
    const cls = potholders()
    own.classes = [cls]
    ledgerOf(cls, 4)
    const due = (now: Date) => minimumAlertsDue([{ cls, ledger: own.ledgers.get(cls.id) }], now)
    expect(due(TUE)).toEqual([])
    expect(due(WED)).toMatchObject([{ classId: cls.id, booked: 4, count: 6, day: '2026-10-21' }])
    expect(due(THU)).toMatchObject([{ classId: cls.id, booked: 4, day: '2026-10-22' }])
    expect(due(new Date('2026-10-23T12:00:00.000Z'))).toEqual([])
  })

  it('says nothing once the class has its minimum, for drafts or cancelled classes, or a class with no minimum', () => {
    const full = potholders(); const draft = potholders({ status: 'draft' }); const gone = potholders({ status: 'cancelled' }); const none = potholders({ min: null })
    const rows = [full, draft, gone, none].map((cls) => ({ cls, ledger: { classId: cls.id, lines: Array.from({ length: cls === full ? 6 : 1 }, () => seat()) } }))
    expect(minimumAlertsDue(rows, WED)).toEqual([])
  })

  it('texts and emails the owners once per class per day, however many runs, and never cancels anything', async () => {
    const cls = potholders()
    own.classes = [cls]
    ledgerOf(cls, 4)
    const first = await runMinimumToRunAlerts(WED)
    expect(first.alerted.map((a) => a.classId)).toEqual([cls.id])
    expect(mockAlert).toHaveBeenCalledTimes(1)
    expect(mockAlert.mock.calls[0][0]).toMatch(/^Potholders has 4 of 6, needs 6 by Thu 5 PM/)
    expect(mockEmail).toHaveBeenCalledTimes(1)
    expect(mockEmail.mock.calls[0][0].subject).toBe('Potholders has 4 of 6, needs 6 by Thu 5 PM')
    expect(mockEmail.mock.calls[0][0].text).toMatch(/Nothing has been cancelled/)
    // a second run the same day sends nothing
    const again = await runMinimumToRunAlerts(new Date(WED.getTime() + 3_600_000))
    expect(again.alerted).toEqual([])
    expect(mockAlert).toHaveBeenCalledTimes(1)
    // the next day (decide-by day) it goes again
    await runMinimumToRunAlerts(THU)
    expect(mockAlert).toHaveBeenCalledTimes(2)
    // the class itself is untouched
    expect(own.classes[0].status).toBe('open')
    expect(own.ledgers.get(cls.id).lines.every((l: any) => l.state === 'confirmed')).toBe(true)
  })

  it('a day when nothing reached the owners can be tried again', async () => {
    const cls = potholders()
    own.classes = [cls]
    ledgerOf(cls, 2)
    mockAlert.mockResolvedValue({ attempted: 0, sent: 0 })
    mockEmail.mockResolvedValue({ sent: false })
    expect((await runMinimumToRunAlerts(WED)).failed).toHaveLength(1)
    mockAlert.mockResolvedValue({ attempted: 2, sent: 2 })
    mockEmail.mockResolvedValue({ sent: true })
    expect((await runMinimumToRunAlerts(WED)).alerted).toHaveLength(1)
  })

  it('a multi-session class counts its first session, and says nothing once that has started', () => {
    const cls = potholders({ sessions: [
      { id: 'ses_1', startIso: '2026-10-21T11:00:00.000Z', endIso: '2026-10-21T13:00:00.000Z', capacity: 12 },
      { id: 'ses_2', startIso: '2026-10-28T18:00:00.000Z', endIso: '2026-10-28T20:00:00.000Z', capacity: 12 },
    ] })
    expect(minimumAlertsDue([{ cls, ledger: { classId: cls.id, lines: [] } }], WED)).toEqual([])
  })
})
