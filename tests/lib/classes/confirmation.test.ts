import { describe, it, expect, vi } from 'vitest'

const sent = vi.hoisted(() => ({ last: null as any }))
vi.mock('@lib/email', () => ({ sendWorkshopConfirmationEmail: async (x: any) => { sent.last = x; return { sent: true } } }))

import { sendClassConfirmation } from '@lib/classes/confirmation'
import { defaultRules } from '@lib/classes/validate'
import type { ScheduledClass } from '@lib/classes/types'

const cls: ScheduledClass = {
  id: 'cls_conf1', libraryId: null, libraryVersion: null,
  content: {
    name: 'Camp', description: 'Paint.', imageUrl: null, instructor: null, rules: defaultRules(),
    ticketTypes: [{ id: 'person', label: 'Person' }], passes: [{ id: 'all', label: 'All', covers: { kind: 'all' } }],
    prices: { all: { person: 1000 } }, questions: [], addOns: [], defaultCapacity: 8, defaultMinutes: 120,
  },
  sessions: [
    { id: 'ses_1', startIso: '2026-11-02T18:00:00.000Z', endIso: '2026-11-02T20:00:00.000Z', capacity: 8 },
    { id: 'ses_2', startIso: '2026-11-03T18:00:00.000Z', endIso: '2026-11-03T20:00:00.000Z', capacity: 8 },
    { id: 'ses_3', startIso: '2026-11-04T18:00:00.000Z', endIso: '2026-11-04T20:00:00.000Z', capacity: 8 },
  ],
  status: 'open', square: { itemId: null, variations: {} }, createdAt: '', updatedAt: '', by: { id: 'u', name: 'u' }, history: [],
}

describe('class confirmation email (M6)', () => {
  it('the calendar invite covers every session booked', async () => {
    await sendClassConfirmation({
      origin: 'https://x.test', bookingId: 'bkg_1', cls, sessionIds: ['ses_1', 'ses_3'], seats: 1, seatsLabel: '1 seat',
      email: 'a@b.co', givenName: 'Ada', receiptUrl: null, totalChargedCents: 1000,
    })
    const ics: string = sent.last.icsContent
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2)
    expect(ics).toContain('DTSTART:20261102T180000Z')
    expect(ics).toContain('DTSTART:20261104T180000Z')
    expect(ics).not.toContain('DTSTART:20261103T180000Z')
  })
})
