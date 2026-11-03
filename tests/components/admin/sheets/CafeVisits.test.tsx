/** /admin › Reports: Craft Café visits for the picked month; the Calendar's Craft Café sheet: who came. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, within, fireEvent, waitFor } from '@testing-library/react'
import { renderSheet, ok } from './harness'
import { CafeVisits, ReportsSheet } from '@components/admin/sheets/ReportsSheet'
import { CafeSheet } from '@components/admin/sheets/CalendarSheets'

const month = {
  month: '2026-11',
  days: [
    { date: '2026-11-07', households: 5, people: 14, adults: 6, kids: 8 },
    { date: '2026-11-14', households: 1, people: 1, adults: 1, kids: 0 },
  ],
  totals: { households: 6, people: 15, adults: 7, kids: 8 },
}

const f = vi.fn()
beforeEach(() => {
  f.mockReset()
  vi.stubGlobal('fetch', f)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-20T18:00:00Z'))
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('Craft Café visits (Reports)', () => {
  it('the month’s people, adults, kids and families, and each day with check-ins', async () => {
    f.mockResolvedValue(ok({ data: month }))
    renderSheet(<CafeVisits month="2026-11" />)
    const region = await screen.findByRole('region', { name: 'Craft Café visits' })
    expect(await within(region).findByText('15')).toBeInTheDocument()
    expect(within(region).getByText('people (7 adults, 8 kids)')).toBeInTheDocument()
    expect(within(region).getByText('6')).toBeInTheDocument()
    expect(within(region).getByText('Sat, Nov 7')).toBeInTheDocument()
    expect(within(region).getByText('14 people · 6 adults · 8 kids · 5 families')).toBeInTheDocument()
    expect(within(region).getByText('1 person · 1 adult · 0 kids · 1 family')).toBeInTheDocument()
    expect(f.mock.calls[0][0]).toBe('/api/admin/cafe-visits.json?month=2026-11')
  })

  it('a month with nobody checked in says so; a failed load has Try again', async () => {
    f.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ error: "Craft Café visits couldn't be loaded. Try again." }) })
      .mockResolvedValue(ok({ data: { month: '2026-10', days: [], totals: { households: 0, people: 0, adults: 0, kids: 0 } } }))
    renderSheet(<CafeVisits month="2026-10" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('No one was checked in at Craft Café this month.')).toBeInTheDocument()
  })

  it('Reports shows it for a month, and asks for a month when a whole year is picked', async () => {
    f.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/admin/cafe-visits.json')) return ok({ data: month })
      if (url.startsWith('/api/admin/reports.json')) return ok({ data: { month: '2026-11', seatsSold: 0, classSalesCents: 0, refunds: 0, refundedCents: 0, partiesBooked: 0, partyFeesCents: 0, discountCents: 0, codeDiscountCents: 0 } })
      return ok({ data: null })
    })
    renderSheet(<ReportsSheet />)
    expect(await screen.findByText('Craft Café visits, November 2026')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox', { name: 'Show' }), { target: { value: '2026' } })
    expect(await screen.findByText('Pick a month under Show to see its Craft Café visits.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Craft Café visits' })).toBeNull())
  })
})

describe('Calendar › Craft Café: who came', () => {
  it('lists the families the crew checked in that day', async () => {
    f.mockResolvedValue(ok({ data: { date: '2026-11-07', totals: { households: 1, people: 3, adults: 1, kids: 2 }, entries: [{ name: 'Jane Doe', people: ['Jane Doe', 'Mia', 'Leo'], at: '2026-11-07T15:10:00.000Z', by: 'Sam', adults: 1, kids: 2 }] } }))
    renderSheet(<CafeSheet day="2026-11-07" />)
    const region = await screen.findByRole('region', { name: 'Who came' })
    expect(await within(region).findByText('Jane Doe (Jane Doe, Mia, Leo)')).toBeInTheDocument()
    expect(within(region).getByText('3 people · 1 adult · 2 kids · 1 family')).toBeInTheDocument()
    expect(within(region).getByText('9:10 AM · Sam')).toBeInTheDocument()
  })

  it('a day still to come asks nothing', () => {
    renderSheet(<CafeSheet day="2026-12-05" />)
    expect(screen.queryByRole('region', { name: 'Who came' })).toBeNull()
    expect(f.mock.calls.some((c) => String(c[0]).includes('cafe-visits'))).toBe(false)
  })
})
