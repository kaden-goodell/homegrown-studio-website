import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import RefundPanel, { STAFF_REFUND } from '@components/admin/classes/RefundPanel'

const booking: any = {
  bookingId: 'bkg_1', customer: { givenName: 'Ada', familyName: 'Lovelace', email: 'ada@example.com', phone: '' },
  source: 'online', passId: 'all', seats: { adult: 2 }, sessionIds: ['ses_1', 'ses_2'], picks: [], addOns: {},
  paidCents: 6540, refundedCents: 0, refunds: [], state: 'confirmed', overCapacity: false, lineIds: ['led_1', 'led_2'], at: '',
  refundable: [
    { id: 'led_1', seat: 1, ticketTypeId: 'adult', sessions: 2, remainingCents: 3270, sessionCents: 1635, freed: false },
    { id: 'led_2', seat: 2, ticketTypeId: 'adult', sessions: 2, remainingCents: 3270, sessionCents: 1635, freed: false },
  ],
  paidHere: true, refundableCents: 6540,
}
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
afterEach(() => vi.unstubAllGlobals())

describe('RefundPanel', () => {
  it('whole booking by default, frees the seat, says to their card, posts line-free body', async () => {
    const fetchMock = vi.fn(async () => ok({ data: { cents: 6540, emailed: true } }))
    vi.stubGlobal('fetch', fetchMock)
    const onDone = vi.fn()
    render(<RefundPanel classId="cls_1" booking={booking} onDone={onDone} />)
    fireEvent.click(screen.getByRole('button', { name: 'Refund' }))
    expect(screen.getByText('Refund $65.40 to their card.')).toBeInTheDocument()
    expect((screen.getByLabelText(/Free the seat/) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm refund' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(JSON.parse((fetchMock.mock.calls[0] as any)[1].body)).toEqual({ classId: 'cls_1', bookingId: 'bkg_1', kind: 'booking', freeSeat: true, reason: '', attempt: expect.stringMatching(/^[A-Za-z0-9_-]{6,80}$/) })
    expect(await screen.findByText(/Refunded \$65\.40/)).toBeInTheDocument()
  })

  it('a retry after an error sends the same attempt token; the next refund after a success gets a new one', async () => {
    const fail = { ok: false, status: 502, json: async () => ({ error: "Square didn't confirm the refund. Try again. It won't refund twice." }) }
    const fetchMock = vi.fn().mockResolvedValueOnce(fail).mockResolvedValue(ok({ data: { cents: 6540, emailed: false } }))
    vi.stubGlobal('fetch', fetchMock)
    render(<RefundPanel classId="cls_1" booking={booking} />)
    fireEvent.click(screen.getByRole('button', { name: 'Refund' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm refund' }))
    expect(await screen.findByText(/It won't refund twice/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm refund' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    await screen.findByText(/Refunded/)
    fireEvent.click(screen.getByRole('button', { name: 'Refund' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm refund' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    const tokens = fetchMock.mock.calls.map((c: any) => JSON.parse(c[1].body).attempt)
    expect(tokens[1]).toBe(tokens[0])
    expect(tokens[2]).not.toBe(tokens[0])
  })

  it('the same refund already made: says so, sends nothing more, and "Refund again" sends again: true with a new token', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok({ data: { cents: 6540, emailed: true, already: { at: '2026-10-18T15:00:00Z', by: { id: 'admin', name: 'Owner' }, message: 'Already refunded on Oct 18, 2026 by Owner.' } } }))
      .mockResolvedValue(ok({ data: { cents: 6540, emailed: true } }))
    vi.stubGlobal('fetch', fetchMock)
    const onDone = vi.fn()
    render(<RefundPanel classId="cls_1" booking={booking} onDone={onDone} />)
    fireEvent.click(screen.getByRole('button', { name: 'Refund' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm refund' }))
    expect(await screen.findByText('Already refunded on Oct 18, 2026 by Owner.')).toBeInTheDocument()
    expect(screen.queryByText(/Refunded \$65\.40/)).not.toBeInTheDocument()
    expect(onDone).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Refund again' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const [b1, b2] = fetchMock.mock.calls.map((c: any) => JSON.parse(c[1].body))
    expect(b1.again).toBeUndefined()
    expect(b2.again).toBe(true)
    expect(b2.attempt).not.toBe(b1.attempt)
    await waitFor(() => expect(onDone).toHaveBeenCalled())
  })

  it('custom amount keeps the seat by default and shows the card ending', async () => {
    const fetchMock = vi.fn(async () => ok({ data: { cents: 1000, emailed: false } }))
    vi.stubGlobal('fetch', fetchMock)
    render(<RefundPanel classId="cls_1" booking={booking} last4="4242" />)
    fireEvent.click(screen.getByRole('button', { name: 'Refund' }))
    fireEvent.click(screen.getByLabelText('Another amount'))
    expect((screen.getByLabelText(/Free the seat/) as HTMLInputElement).checked).toBe(false)
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: '10' } })
    expect(screen.getByText('Refund $10 to the card ending in 4242.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm refund' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(JSON.parse((fetchMock.mock.calls[0] as any)[1].body)).toMatchObject({ kind: 'custom', cents: 1000, freeSeat: false })
  })

  it('one session totals the chosen seats’ shares and keeps the seat by default; one person frees it', () => {
    render(<RefundPanel classId="cls_1" booking={booking} />)
    fireEvent.click(screen.getByRole('button', { name: 'Refund' }))
    fireEvent.click(screen.getByLabelText('One session'))
    expect(screen.getByText('Refund $32.70 to their card.')).toBeInTheDocument()
    expect((screen.getByLabelText(/Free the seat/) as HTMLInputElement).checked).toBe(false)
    fireEvent.click(screen.getByLabelText('One person'))
    expect((screen.getByLabelText(/Free the seat/) as HTMLInputElement).checked).toBe(true)
  })

  it('caps the whole booking at what the booking can still give back', () => {
    render(<RefundPanel classId="cls_1" booking={{ ...booking, refundableCents: 6000 }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Refund' }))
    expect(screen.getByText('Refund $60 to their card.')).toBeInTheDocument()
  })

  it('one person and one session previews respect the booking cap like the server', () => {
    render(<RefundPanel classId="cls_1" booking={{ ...booking, refundableCents: 1000 }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Refund' }))
    fireEvent.click(screen.getByLabelText('One person'))
    expect(screen.getByText('Refund $10 to their card.')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('One session'))
    expect(screen.getByText('That is more than is left to refund.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm refund' })).toBeDisabled()
  })

  it('Free their seat asks first in the page, then posts a free-seat with no money', async () => {
    const fetchMock = vi.fn(async () => ok({ data: { lines: [] } }))
    vi.stubGlobal('fetch', fetchMock)
    const onDone = vi.fn()
    render(<RefundPanel classId="cls_1" booking={booking} onDone={onDone} />)
    fireEvent.click(screen.getByRole('button', { name: 'Free their seat' }))
    expect(fetchMock).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Which seat'), { target: { value: 'led_2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Yes, free the seat' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(JSON.parse((fetchMock.mock.calls[0] as any)[1].body)).toEqual({ action: 'free-seat', classId: 'cls_1', bookingId: 'bkg_1', reason: '', lineIds: ['led_2'] })
  })

  it('crew must give a reason before confirming, and it goes to the staff route', async () => {
    const fetchMock = vi.fn(async () => ok({ data: { cents: 6540, emailed: false } }))
    vi.stubGlobal('fetch', fetchMock)
    render(<RefundPanel classId="cls_1" booking={booking} endpoint={STAFF_REFUND} reasonRequired />)
    fireEvent.click(screen.getByRole('button', { name: 'Refund' }))
    expect(screen.getByRole('button', { name: 'Confirm refund' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Sick kid' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm refund' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect((fetchMock.mock.calls[0] as any)[0]).toBe(STAFF_REFUND)
  })

  it('a seat sold at the counter points to Square instead', () => {
    render(<RefundPanel classId="cls_1" booking={{ ...booking, source: 'pos', paidHere: false }} />)
    expect(screen.getByText('Refund this one in Square, where it was paid.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Refund' })).toBeNull()
  })
})
