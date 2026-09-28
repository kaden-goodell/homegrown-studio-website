/**
 * Tests for incident-store: create/get/listByEvent/listSince. Runs in fs
 * mode against an isolated temp dir (tests/setup.ts sets BLOB_STORE_FS_DIR),
 * same pattern as tests/lib/event-meta.test.ts.
 */
import { describe, it, expect } from 'vitest'
import { createIncident, getIncident, listIncidentsByEvent, listIncidentsSince, type IncidentRecord } from '@lib/incident-store'

const by = { id: 'k', name: 'Kaden' }

function baseInput(overrides: Partial<Omit<IncidentRecord, 'id' | 'reportedAt'>> = {}): Omit<IncidentRecord, 'id' | 'reportedAt'> {
  return {
    at: '2026-09-28T20:00:00.000Z',
    by,
    event: { kind: 'party', id: 'p1', title: 'Pottery Party', day: '2026-09-28' },
    who: [{ waiverId: 'wvr_1', personId: 'child:0', name: 'Remy' }],
    what: 'Scraped knee on the concrete step outside.',
    firstAid: 'Cleaned and bandaged.',
    witnesses: 'Staffer Jo',
    parentNotified: { at: '2026-09-28T20:05:00.000Z', by: 'Kaden', how: 'phone' },
    followUp: '',
    ...overrides,
  }
}

describe('incident-store', () => {
  it('creates a record with a generated id and reportedAt, then reads it back', async () => {
    const created = await createIncident(baseInput())
    expect(created.id).toMatch(/^inc_[a-z0-9]+_[a-z0-9]{6}$/)
    expect(created.reportedAt).toBeTruthy()

    const fetched = await getIncident(created.id)
    expect(fetched).toEqual(created)
  })

  it('returns null for an unknown id', async () => {
    expect(await getIncident('inc_nope')).toBeNull()
  })

  it('listIncidentsByEvent returns only incidents for that event, newest first', async () => {
    const evtId = 'p_' + Date.now()
    const other = 'p_' + Date.now() + '_other'
    const first = await createIncident(baseInput({ at: '2026-09-28T18:00:00.000Z', event: { kind: 'party', id: evtId, title: 'A', day: '2026-09-28' } }))
    const second = await createIncident(baseInput({ at: '2026-09-28T19:00:00.000Z', event: { kind: 'party', id: evtId, title: 'A', day: '2026-09-28' } }))
    await createIncident(baseInput({ event: { kind: 'party', id: other, title: 'B', day: '2026-09-28' } }))

    const list = await listIncidentsByEvent('party', evtId)
    expect(list.map((r) => r.id)).toEqual([second.id, first.id])
  })

  it('listIncidentsByEvent excludes incidents with no event (open studio)', async () => {
    const evtId = 'p_' + Date.now() + '_none'
    await createIncident(baseInput({ event: null }))
    const list = await listIncidentsByEvent('party', evtId)
    expect(list).toEqual([])
  })

  it('listIncidentsSince returns incidents at/after the given date, newest first', async () => {
    const early = await createIncident(baseInput({ at: '2026-01-01T00:00:00.000Z' }))
    const late = await createIncident(baseInput({ at: '2026-12-01T00:00:00.000Z' }))
    const list = await listIncidentsSince('2026-06-01T00:00:00.000Z')
    const ids = list.map((r) => r.id)
    expect(ids).toContain(late.id)
    expect(ids).not.toContain(early.id)
  })
})
