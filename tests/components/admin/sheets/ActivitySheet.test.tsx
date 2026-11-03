import { describe, it, expect, vi, afterEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { ActivitySheet } from '@components/admin/sheets/ActivitySheet'
import { renderSheet, ok } from './harness'

afterEach(() => vi.unstubAllGlobals())

const REPLY = {
  data: {
    rows: [
      { id: 'au_1', at: '2026-11-07T19:00:00.000Z', who: 'Sam', role: 'crew', byId: 'sam', area: 'money', what: 'Refunded $85.00 on Pottery Sat: “no-show”', action: 'class-refund' },
      { id: 'au_2', at: '2026-11-07T18:00:00.000Z', who: 'Catherine', role: 'owner', byId: 'cat', area: 'setup', what: 'Studio settings', action: 'studio-settings' },
    ],
    people: [{ id: 'cat', name: 'Catherine', role: 'owner' }, { id: 'sam', name: 'Sam', role: 'crew' }],
    truncated: false, days: 7,
  },
}

describe('More › Activity (DV19)', () => {
  it('lists who did what, and filters by time, area and person', async () => {
    const f = vi.fn(async (_url: string, _init?: unknown) => ok(REPLY))
    vi.stubGlobal('fetch', f)
    renderSheet(<ActivitySheet />)
    expect(await screen.findByText('Refunded $85.00 on Pottery Sat: “no-show”')).toBeTruthy()
    expect(screen.getAllByText('Sam').length).toBeGreaterThan(0)
    expect(String(f.mock.calls[0][0])).toBe('/api/admin/activity.json?days=7')
    fireEvent.click(screen.getByRole('button', { name: '30 days' }))
    await waitFor(() => expect(String(f.mock.calls.at(-1)![0])).toBe('/api/admin/activity.json?days=30'))
    fireEvent.change(screen.getByLabelText('What'), { target: { value: 'money' } })
    await waitFor(() => expect(String(f.mock.calls.at(-1)![0])).toBe('/api/admin/activity.json?days=30&area=money'))
    await screen.findByText('Refunded $85.00 on Pottery Sat: “no-show”')
    fireEvent.change(screen.getByLabelText('Who'), { target: { value: 'sam' } })
    await waitFor(() => expect(String(f.mock.calls.at(-1)![0])).toBe('/api/admin/activity.json?days=30&area=money&by=sam'))
  })
  it('says so when nothing happened, and offers a retry when it can’t load', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok({ data: { rows: [], people: [], truncated: false, days: 7 } })))
    renderSheet(<ActivitySheet />)
    expect(await screen.findByText('Nothing in this period.')).toBeTruthy()
  })
})
