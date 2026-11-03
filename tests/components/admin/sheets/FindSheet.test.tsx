// tests/components/admin/sheets/FindSheet.test.tsx — Find a booking (final review I5): a caller's bookings, with Refund right there.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { screen, fireEvent, within, waitFor } from '@testing-library/react'
import { FindSheet, FIND } from '@components/admin/sheets/FindSheet'
import { at, booking, ok, posts, renderSheet } from './harness'

afterEach(() => vi.unstubAllGlobals())

const result = {
  classes: [{ classId: 'cls_1', className: 'Pottery', startIso: at('2031-03-12', '10:00'), endIso: at('2031-03-12', '11:30'), status: 'open', ticketTypes: [{ id: 'person', label: 'Person' }], booking: booking() }],
  parties: [{ bookingId: 'pty_1', startIso: at('2031-04-01', '13:00'), hostName: 'Ada Lovelace', craftName: 'Mugs', guestCount: 10, status: 'booked', inSquare: false }],
  waitlist: [{ classId: 'cls_2', className: 'Looms', startIso: at('2031-03-19', '10:00'), seats: 2, name: 'Ada Lovelace' }],
  more: false,
}

describe('Find a booking', () => {
  it('searches by what she types and shows class bookings with Refund, parties and waitlist places, each with Open', async () => {
    const f = vi.fn(async (url: string, init?: any) => {
      if (String(url).startsWith(FIND)) return ok({ data: result })
      if (url === '/api/admin/classes/refund.json' && init?.method === 'POST') return ok({ data: { cents: 6540, emailed: true } })
      throw new Error(`unexpected ${url}`)
    })
    vi.stubGlobal('fetch', f)
    const { sheet } = renderSheet(<FindSheet />)
    fireEvent.change(screen.getByLabelText('Name, email or phone'), { target: { value: 'Lovelace' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    const row = await screen.findByRole('article', { name: 'Ada Lovelace, Pottery' })
    expect(f.mock.calls[0][0]).toBe(`${FIND}?q=Lovelace`)
    expect(within(row).getByRole('button', { name: 'Refund' })).toBeInTheDocument()
    fireEvent.click(within(row).getByRole('button', { name: 'Open the class' }))
    expect(sheet.open).toHaveBeenCalledWith({ kind: 'class', id: 'cls_1' }, expect.anything())
    fireEvent.click(within(screen.getByRole('article', { name: 'Ada Lovelace party' })).getByRole('button', { name: 'Open the party' }))
    expect(sheet.open).toHaveBeenLastCalledWith({ kind: 'party', day: '2031-04-01', id: 'pty_1' }, expect.anything())
    expect(within(screen.getByRole('article', { name: 'Ada Lovelace waiting' })).getByText(/waiting for 2 seats/)).toBeInTheDocument()
    fireEvent.click(within(row).getByRole('button', { name: 'Refund' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm refund' }))
    await waitFor(() => expect(posts(f, '/api/admin/classes/refund.json')).toHaveLength(1))
    expect(posts(f, '/api/admin/classes/refund.json')[0].body).toMatchObject({ classId: 'cls_1', bookingId: 'bkg_1' })
  })

  it('says plainly when nothing matches, and asks for two letters first', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok({ data: { classes: [], parties: [], waitlist: [], more: false } })))
    renderSheet(<FindSheet />)
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Type at least two letters')
    fireEvent.change(screen.getByLabelText('Name, email or phone'), { target: { value: 'Zed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(await screen.findByText(/Nothing found for “Zed”/)).toBeInTheDocument()
  })
})
