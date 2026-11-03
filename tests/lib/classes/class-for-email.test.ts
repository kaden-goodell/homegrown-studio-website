// "Email me this class" for our own classes: what the email says, and when there's nothing to send.
import { describe, it, expect } from 'vitest'
import { ownClassForEmail } from '@lib/classes/class-for-email'
import { defaultRules } from '@lib/classes/validate'
import type { ScheduledClass } from '@lib/classes/types'

const NOW = new Date('2026-11-03T12:00:00Z')
const s = (id: string, iso: string) => ({ id, startIso: iso, endIso: new Date(Date.parse(iso) + 90 * 60_000).toISOString(), capacity: 10 })
const cls = (over: Partial<ScheduledClass> = {}, joinPartway = true): ScheduledClass => ({
  id: 'cls_camp1', libraryId: null, libraryVersion: null, status: 'open',
  content: {
    name: 'Winter Craft Camp', description: 'Four mornings.', imageUrl: null, instructor: null, rules: { ...defaultRules(), joinPartway },
    ticketTypes: [{ id: 'person', label: 'Person' }],
    passes: [{ id: 'all', label: 'Full series', covers: { kind: 'all' } }, { id: 'day', label: 'Any one day', covers: { kind: 'choose', count: 1 } }],
    prices: { all: { person: 12000 }, day: { person: 3500 } }, questions: [], addOns: [], defaultCapacity: 20, defaultMinutes: 180,
  },
  sessions: [s('ses_1', '2026-11-01T15:00:00Z'), s('ses_2', '2026-11-05T15:00:00Z'), s('ses_3', '2026-11-06T15:00:00Z')],
  square: { itemId: null, variations: {} }, createdAt: '', updatedAt: '', by: { id: '', name: '' }, history: [],
  ...over,
})

describe('ownClassForEmail', () => {
  it('a class partway through that takes people partway: told from its next date, with the dates left', () => {
    expect(ownClassForEmail(cls(), NOW)).toMatchObject({
      id: 'cls_camp1', startAt: '2026-11-05T15:00:00Z', durationMinutes: 90, path: '/classes/cls_camp1',
      priceLabel: 'From $35', sessionsLabel: expect.stringMatching(/^2 sessions · starts /),
    })
  })
  it('nothing to send: partway through one that doesn’t take people partway, every date started, or not viewable', () => {
    expect(ownClassForEmail(cls({}, false), NOW)).toBeUndefined()
    expect(ownClassForEmail(cls({ sessions: [s('ses_1', '2026-11-01T15:00:00Z')] }), NOW)).toBeUndefined()
    expect(ownClassForEmail(cls({ status: 'draft' }), NOW)).toBeUndefined()
    expect(ownClassForEmail(null, NOW)).toBeUndefined()
  })
})
