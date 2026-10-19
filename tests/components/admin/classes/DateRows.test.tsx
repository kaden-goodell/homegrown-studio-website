import { describe, it, expect } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, within } from '@testing-library/react'
import DateRows, { checkRows, newDateRow, onOrAfter, rowsOf, weekLater, type DateRow } from '@components/admin/classes/DateRows'
import { localToUtcISO } from '@lib/party-slots'

const at = (d: string, t: string) => localToUtcISO(d, t)
function Harness({ start }: { start: DateRow[] }) {
  const [rows, setRows] = useState(start)
  return <DateRows rows={rows} onChange={setRows} />
}
const date = (n: number) => screen.getByRole('group', { name: `Date ${n}` })

describe('DateRows: the one way /admin picks dates', () => {
  it('each date is a fieldset "Date N" with Day · Starts · Ends · Seats; the end follows the start, keeping the length', () => {
    render(<Harness start={[newDateRow({ day: '2031-03-12', start: '10:00', end: '11:30', capacity: 8 })]} />)
    const d1 = date(1)
    for (const l of ['Day', 'Starts', 'Ends', 'Seats']) expect(within(d1).getByLabelText(l)).toBeInTheDocument()
    fireEvent.change(within(d1).getByLabelText('Starts'), { target: { value: '13:00' } })
    expect(within(d1).getByLabelText('Ends')).toHaveValue('14:30')
    fireEvent.change(within(d1).getByLabelText('Day'), { target: { value: '2031-03-19' } })
    expect(within(d1).getByLabelText('Ends')).toHaveValue('14:30')
    // A typed end sets a new length from then on.
    fireEvent.change(within(d1).getByLabelText('Ends'), { target: { value: '15:00' } })
    fireEvent.change(within(d1).getByLabelText('Starts'), { target: { value: '09:00' } })
    expect(within(d1).getByLabelText('Ends')).toHaveValue('11:00')
    expect(screen.queryByText(/Session/)).toBeNull()
  })

  it('+ Add another date adds one a week after the last, same times and seats; each can be removed', () => {
    render(<Harness start={[newDateRow({ day: '2031-03-12', start: '18:00', end: '20:00', capacity: 6 })]} />)
    expect(screen.queryByRole('button', { name: 'Remove date 1' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '+ Add another date' }))
    expect(within(date(2)).getByLabelText('Day')).toHaveValue('2031-03-19')
    expect(within(date(2)).getByLabelText('Starts')).toHaveValue('18:00')
    expect(within(date(2)).getByLabelText('Ends')).toHaveValue('20:00')
    expect(within(date(2)).getByLabelText('Seats')).toHaveValue('6')
    expect(screen.getByText('More than one date makes one class that meets on each of them.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Remove date 1' }))
    expect(screen.queryByRole('group', { name: 'Date 2' })).toBeNull()
    expect(within(date(1)).getByLabelText('Day')).toHaveValue('2031-03-19')
  })

  it('Run it again: the same dates a week on, each keeping its own length and seats, as new dates', () => {
    const sessions = [{ id: 'ses_1', startIso: at('2031-03-12', '10:00'), endIso: at('2031-03-12', '12:00'), capacity: 6 }]
    const rows = weekLater(sessions)
    expect(rows[0]).toMatchObject({ day: '2031-03-19', start: '10:00', end: '12:00', capacity: '6', minutes: 120 })
    expect(rows[0].id).not.toBe('ses_1')
    render(<Harness start={rows} />)
    fireEvent.change(within(date(1)).getByLabelText('Starts'), { target: { value: '13:00' } })
    expect(within(date(1)).getByLabelText('Ends')).toHaveValue('15:00')
  })

  it('checks the rows and sends studio-time instants; saved dates keep their ids', () => {
    const saved = rowsOf([{ id: 'ses_9', startIso: at('2031-03-12', '10:00'), endIso: at('2031-03-12', '11:30'), capacity: 12 }])
    expect(checkRows(saved)).toEqual({ ok: true, sessions: [{ id: 'ses_9', startIso: at('2031-03-12', '10:00'), endIso: at('2031-03-12', '11:30'), capacity: 12 }] })
    expect(checkRows([{ ...saved[0], end: '09:00' }])).toEqual({ ok: false, error: 'A date has to end after it starts.' })
    expect(checkRows([{ ...saved[0], capacity: '0' }])).toEqual({ ok: false, error: 'Seats is 1 to 999.' })
    expect(checkRows([{ ...saved[0], day: '' }])).toEqual({ ok: false, error: 'Each date needs a day, a start and an end.' })
    expect(checkRows([])).toEqual({ ok: false, error: 'Add a date.' })
  })

  it('a refusal about the dates (a clash) shows right under them', () => {
    render(<DateRows rows={[newDateRow({ day: '2031-03-12', start: '10:00', end: '11:00', capacity: 4 })]} onChange={() => {}} error="Clashes with Party for Sam, Wed Mar 12 10 AM." />)
    expect(screen.getByRole('alert')).toHaveTextContent('Clashes with Party for Sam')
  })

  it('R37: copied dates in the past move on by whole weeks, keeping weekday, times and the gap between them', () => {
    const rows = [newDateRow({ day: '2026-10-03', start: '10:00', end: '12:00', capacity: 6 }), newDateRow({ day: '2026-10-10', start: '10:00', end: '12:00', capacity: 6 })]
    const moved = onOrAfter(rows, '2026-10-29')
    expect(moved.map((r) => r.day)).toEqual(['2026-10-31', '2026-11-07'])
    expect(onOrAfter(rows, '2026-10-01')).toBe(rows)
    expect(onOrAfter(rows, '2026-10-29', (d) => d === '2026-10-31').map((r) => r.day)).toEqual(['2026-11-07', '2026-11-14'])
  })

  it('QN1, QN2: a booked date has no Remove (it says "Has bookings"); read-only dates show no booked hint', () => {
    const rows = [newDateRow({ id: 'ses_a', day: '2031-03-12', start: '10:00', end: '11:00', capacity: 4 }), newDateRow({ id: 'ses_b', day: '2031-03-19', start: '10:00', end: '11:00', capacity: 4 })]
    const { unmount } = render(<DateRows rows={rows} onChange={() => {}} booked={{ ses_a: 2 }} />)
    expect(screen.queryByRole('button', { name: 'Remove date 1' })).toBeNull()
    expect(within(date(1)).getByText('Has bookings')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove date 2' })).toBeInTheDocument()
    unmount()
    render(<DateRows rows={rows} onChange={() => {}} booked={{ ses_a: 2 }} disabled />)
    expect(screen.queryByText(/booked on this date/)).toBeNull()
  })
})

