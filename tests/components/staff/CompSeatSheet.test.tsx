import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import CompSeatSheet from '@components/staff/CompSeatSheet'

const event = { id: 'SCHED123', title: 'Pumpkins', day: '2026-10-20' }
const options = [{ id: 'color', label: 'Pumpkin color', choices: ['Orange', 'White'] }] as any

function fill() {
  fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Ada' } })
  fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Lovelace' } })
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@x.com' } })
}

describe('CompSeatSheet', () => {
  const fetchMock = vi.fn()
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock) })
  afterEach(() => vi.unstubAllGlobals())

  it('links to the class in Square with the id and day', () => {
    render(<CompSeatSheet event={event} options={[]} onRecorded={() => {}} onClose={() => {}} />)
    const a = screen.getByRole('link', { name: 'Open this class in Square' })
    expect(a.getAttribute('href')).toBe('https://app.squareup.com/dashboard/appointments/calendar/classes/SCHED123?date=2026-10-20&view=week')
    expect(a.getAttribute('target')).toBe('_blank')
  })

  it('shows the server error when a pick is missing', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'Pick a Pumpkin color for seat 1.' }) })
    const onRecorded = vi.fn()
    render(<CompSeatSheet event={event} options={options} onRecorded={onRecorded} onClose={() => {}} />)
    fill()
    fireEvent.click(screen.getByRole('button', { name: 'Record comped seat' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Pick a Pumpkin color for seat 1.')
    expect(onRecorded).not.toHaveBeenCalled()
  })

  it('posts picks per seat and calls onRecorded on 200', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { bookingId: 'b1', emailSent: true } }) })
    const onRecorded = vi.fn()
    render(<CompSeatSheet event={event} options={options} onRecorded={onRecorded} onClose={() => {}} />)
    fill()
    fireEvent.change(screen.getByLabelText('Seat 1 · Pumpkin color'), { target: { value: 'Orange' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record comped seat' }))
    await waitFor(() => expect(onRecorded).toHaveBeenCalled())
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toMatchObject({ scheduleId: 'SCHED123', email: 'ada@x.com', seats: 1, picks: [{ seat: 1, optionId: 'color', choice: 'Orange' }] })
    expect(screen.getByText(/Recorded\. They’ll get the usual confirmation email\./)).toBeTruthy()
  })

  it('lets the seats field be cleared and retyped, and clamps it on leaving', () => {
    render(<CompSeatSheet event={event} options={options} onRecorded={() => {}} onClose={() => {}} />)
    const seats = screen.getByLabelText('Seats') as HTMLInputElement
    fireEvent.change(seats, { target: { value: '' } })
    expect(seats.value).toBe('')
    fireEvent.change(seats, { target: { value: '3' } })
    expect(screen.getByLabelText('Seat 3 · Pumpkin color')).toBeTruthy()
    fireEvent.change(seats, { target: { value: '' } })
    fireEvent.blur(seats)
    expect(seats.value).toBe('1')
  })

  it('marks name and email required', () => {
    render(<CompSeatSheet event={event} options={[]} onRecorded={() => {}} onClose={() => {}} />)
    for (const l of ['First name', 'Last name', 'Email']) expect((screen.getByLabelText(l) as HTMLInputElement).required).toBe(true)
    expect((screen.getByLabelText('Phone (optional)') as HTMLInputElement).required).toBe(false)
  })
})
