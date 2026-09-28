import { describe, it, expect, vi } from 'vitest'
vi.mock('@lib/party-store', () => ({ getPartyRecord: vi.fn(async (id: string) => id === 'p1' ? { bookingId: 'p1', title: 'Rivera Party', craftName: 'Slime', startIso: '2026-10-20T15:00:00.000Z', dropOff: true } : null), listParties: vi.fn(async () => [{ bookingId: 'p1', title: 'Rivera Party', craftName: 'Slime', startIso: '2026-10-20T15:00:00.000Z', dropOff: true }]) }))
vi.mock('@config/providers', () => ({ providers: { workshop: { listWorkshops: vi.fn(async () => [{ scheduleId: 'cs1', name: 'Macramé', startAt: '2026-10-21T04:30:00.000Z', seatsAvailable: 8 }]) } } }))
vi.mock('@lib/event-meta', () => ({ getEventMeta: vi.fn(async (kind: string, id: string) => id === 'cs1' ? { dropOff: true, days: ['2026-10-20', '2026-10-21', '2026-10-22'], updatedAt: '', by: { id: 'k', name: 'K' }, history: [] } : null) }))
import { getEvent, listEvents, eventKey } from '@lib/events'
describe('events', () => {
  it('party falls back to the record dropOff and derives days in studio TZ', async () => {
    const e = await getEvent('party', 'p1'); expect(e).toMatchObject({ kind: 'party', dropOff: true, days: ['2026-10-20'] })
  })
  it('workshop merges meta (dropOff, multi-day) and is listed on each of its days', async () => {
    const e = await getEvent('workshop', 'cs1'); expect(e).toMatchObject({ title: 'Macramé', dropOff: true, days: ['2026-10-20', '2026-10-21', '2026-10-22'] })
    expect((await listEvents({ from: '2026-10-22', to: '2026-10-22' })).map(x => x.id)).toEqual(['cs1'])
    expect((await listEvents({ from: '2026-10-20', to: '2026-10-20' })).map(x => x.id).sort()).toEqual(['cs1', 'p1'])
  })
  it('a 11:30pm UTC start is the previous studio day', async () => {
    // 2026-10-21T04:30Z = Oct 20 11:30pm CDT
    const e = await getEvent('workshop', 'cs1'); expect(e!.startIso).toBe('2026-10-21T04:30:00.000Z')
  })
  it('eventKey keeps party ids bare (legacy) and namespaces the rest', () => {
    expect(eventKey('party', 'p1')).toBe('p1'); expect(eventKey('workshop', 'cs1')).toBe('workshop:cs1')
  })
})
