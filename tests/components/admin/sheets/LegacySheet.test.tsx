/** /admin › a class still run from Square (Kaden, 17 Nov 2026): seats, price, who's coming and their waiver, a way to the /staff roster. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, within } from '@testing-library/react'
import { renderSheet, ok, refuse } from './harness'
import { LegacyDetails } from '@components/admin/sheets/CalendarSheets'
import { itemSub } from '@components/admin/shell/items'

const item = { kind: 'legacy-class', id: 'clssch_felt', label: 'Christmas Needle Felting', startIso: '2026-11-21T01:00:00.000Z', endIso: '2026-11-21T03:00:00.000Z', booked: 7, capacity: 20, remaining: 13, priceCents: 3000 } as any

const f = vi.fn()
beforeEach(() => { f.mockReset(); vi.stubGlobal('fetch', f) })
afterEach(() => vi.unstubAllGlobals())

describe('Square class sheet', () => {
  it('seats booked of the size, seats left and the price; who’s coming with each waiver; the roster button', async () => {
    f.mockResolvedValue(ok({ data: { booked: 7, capacity: 20, remaining: 13, priceCents: 3000, families: [
      { name: 'Ann Lee', seats: 2, waiver: 'current' },
      { name: 'Ben Ray', seats: 1, waiver: 'none' },
      { name: 'Cal Fox', seats: 1, waiver: 'expired', comped: true },
      { name: 'Dee Oak', seats: 1, waiver: 'outdated' },
    ] } }))
    renderSheet(<LegacyDetails item={item} />)
    expect(screen.getByLabelText('Seats')).toHaveTextContent('7 of 20 booked · 13 left · $30 a seat')
    const list = await screen.findByRole('list', { name: 'Booked' })
    const rows = within(list).getAllByRole('listitem').map((li) => li.textContent)
    expect(rows).toEqual([
      'Ann Lee · 2 seatsWaiver signed ✓',
      'Ben Ray · 1 seatNeeds to sign',
      'Cal Fox · 1 seat · compWaiver expired',
      'Dee Oak · 1 seatNeeds to sign again (new terms)',
    ])
    expect(screen.getByText('3 families still need to sign the waiver.')).toBeInTheDocument()
    expect(screen.getByText(/2 seats were added in Square directly/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open the roster on /staff' })).toHaveAttribute('href', '/staff?open=workshop%3Aclssch_felt')
    expect(f.mock.calls[0][0]).toBe('/api/admin/classes/legacy.json?id=clssch_felt')
  })

  it('nobody yet says so; a list that couldn’t be read points to /staff; a failed load can be tried again', async () => {
    f.mockResolvedValueOnce(ok({ data: { booked: 0, capacity: 20, remaining: 20, families: [] } }))
    const { unmount } = renderSheet(<LegacyDetails item={item} />)
    expect(await screen.findByText('Nobody has booked online yet.')).toBeInTheDocument()
    unmount()
    f.mockResolvedValueOnce(ok({ data: { booked: 7, capacity: 20, remaining: 13, families: null } }))
    const second = renderSheet(<LegacyDetails item={item} />)
    expect(await screen.findByText(/The roster on \/staff has everyone/)).toBeInTheDocument()
    second.unmount()
    f.mockResolvedValueOnce(refuse(503, { error: 'Try again.' }))
    renderSheet(<LegacyDetails item={item} />)
    expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument()
  })
})

describe('Square class rows', () => {
  it('show booked of size like our classes, and plain "Square class" when seats aren’t known', () => {
    expect(itemSub(item)).toBe('7 of 20 booked')
    expect(itemSub({ ...item, booked: undefined, capacity: undefined, remaining: undefined })).toBe('Square class')
  })
})
