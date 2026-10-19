import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import RefundPanel, { STAFF_REFUND } from '@components/shared/RefundPanel'

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

  it('the same refund already made: says so; "Refund again" names it and keeps ONE token across retries', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok({ data: { cents: 6540, emailed: true, already: { at: '2026-10-18T15:00:00Z', by: { id: 'admin', name: 'Owner' }, message: 'Already refunded on Oct 18, 2026 by Owner.', count: 1, latest: { requestId: 'req_latest', at: '2026-10-18T15:00:00Z', by: { id: 'admin', name: 'Owner' }, cents: 6540 } } } }))
      .mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({ error: "Square didn't confirm the refund. Try again. It won't refund twice." }) })
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
    expect(await screen.findByText(/It won't refund twice/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Refund again' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    const [b1, b2, b3] = fetchMock.mock.calls.map((c: any) => JSON.parse(c[1].body))
    expect(b1.again).toBeUndefined()
    expect(b2.again).toEqual({ of: 'req_latest', token: expect.stringMatching(/^[A-Za-z0-9_-]{6,80}$/) })
    expect(b3.again).toEqual(b2.again)
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

  it('a retried Refund again that Square already finished shows as refunded, not "Already refunded"', async () => {
    const already = (askedId: string) => ok({ data: { cents: 6540, emailed: true, already: { at: null, by: { id: 'admin', name: 'Owner' }, message: 'Refunded twice already, last on Oct 19, 2026 by Owner.', count: 2, askedId, latest: { requestId: 'req_repeat', at: null, by: { id: 'admin', name: 'Owner' }, cents: 1000 } } } })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok({ data: { cents: 6540, emailed: true, already: { at: null, by: { id: 'admin', name: 'Owner' }, message: 'Already refunded by Owner.', count: 1, askedId: 'req_first', latest: { requestId: 'req_first', at: null, by: { id: 'admin', name: 'Owner' }, cents: 1000 } } } }))
      .mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({ error: "Square didn't confirm the refund. Try again. It won't refund twice." }) })
      .mockResolvedValueOnce(already('req_repeat'))
    vi.stubGlobal('fetch', fetchMock)
    const onDone = vi.fn()
    render(<RefundPanel classId="cls_1" booking={booking} onDone={onDone} />)
    fireEvent.click(screen.getByRole('button', { name: 'Refund' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm refund' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Refund again' }))
    expect(await screen.findByText(/It won't refund twice/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Refund again' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(await screen.findByText(/^Refunded \$10(\.00)?\.$/)).toBeInTheDocument()
    const sent = fetchMock.mock.calls.slice(1).map((c: any) => JSON.parse(c[1].body).again)
    expect(sent[0]).toEqual({ of: 'req_first', token: expect.any(String) })
    expect(sent[1]).toEqual(sent[0])
  })

  it('crew: a refund waiting on Square shows "I checked Square" with a reason, and posts the outcome', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: any) => ok({ data: { status: 'done', lines: [] } }))
    vi.stubGlobal('fetch', fetchMock)
    const onDone = vi.fn()
    const waiting = { requestId: 'req_w', cents: 3270, at: '2026-10-18T15:00:00Z', by: { id: 'sam', name: 'Sam' }, people: [{ name: 'Ada Lovelace', cents: 3270 }], dates: [] }
    render(<RefundPanel classId="cls_1" booking={booking} endpoint={STAFF_REFUND} reasonRequired waiting={waiting} onDone={onDone} />)
    expect(screen.getByText(/\$32\.70 for Ada Lovelace, asked by Sam on Oct 18/)).toBeInTheDocument()
    const went = screen.getByRole('button', { name: 'It went through' })
    expect(went).toBeDisabled()
    fireEvent.change(screen.getByLabelText('What you saw in Square'), { target: { value: 'Shows refunded' } })
    fireEvent.click(went)
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(fetchMock.mock.calls[0][0]).toBe(STAFF_REFUND)
    expect(JSON.parse((fetchMock.mock.calls[0] as any)[1].body)).toEqual({ action: 'clear-request', classId: 'cls_1', bookingId: 'bkg_1', requestId: 'req_w', outcome: 'went-through', reason: 'Shows refunded' })
    expect(await screen.findByText('Saved. $32.70 refunded.')).toBeInTheDocument()
  })

  it('a new refund refused because one is waiting on Square turns into the check', async () => {
    const pending = { requestId: 'req_p', cents: 1000, at: '2026-10-18T15:00:00Z', by: { id: 'admin', name: 'Owner' }, people: [], dates: [] }
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 409, json: async () => ({ error: 'A refund on this booking is still waiting on Square. Check it in Square first.', pending }) })))
    render(<RefundPanel classId="cls_1" booking={booking} endpoint={STAFF_REFUND} reasonRequired />)
    fireEvent.click(screen.getByRole('button', { name: 'Refund' }))
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Sick kid' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm refund' }))
    expect(await screen.findByRole('group', { name: 'Check a refund in Square' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'It didn’t go through' })).toBeInTheDocument()
  })

  it('I2: fields have a visible border and 16px text; a disabled Confirm looks disabled and says what is missing', () => {
    render(<RefundPanel classId="cls_1" booking={booking} endpoint={STAFF_REFUND} reasonRequired />)
    fireEvent.click(screen.getByRole('button', { name: 'Refund' }))
    const reasonInput = screen.getByLabelText('Reason') as HTMLInputElement
    expect(reasonInput.style.border).toContain('solid')
    expect(reasonInput.style.fontSize).toBe('1rem')
    const confirm = screen.getByRole('button', { name: 'Confirm refund' })
    expect(confirm).toBeDisabled()
    expect(confirm.style.opacity).toBe('0.5')
    expect(screen.getByTestId('refund-hint')).toHaveTextContent('Add a reason to refund.')
    fireEvent.change(reasonInput, { target: { value: 'Sick kid' } })
    expect(confirm).not.toBeDisabled()
    expect(screen.queryByTestId('refund-hint')).toBeNull()
    // another amount with nothing typed
    fireEvent.click(screen.getByLabelText('Another amount'))
    expect(screen.getByTestId('refund-hint')).toHaveTextContent('Add an amount to refund.')
  })

  it('free their seat and the Square check say what is missing too', () => {
    const waiting = { requestId: 'req_w', cents: 100, at: '2026-10-18T15:00:00Z', by: { id: 'sam', name: 'Sam' }, people: [], dates: [] }
    const { unmount } = render(<RefundPanel classId="cls_1" booking={booking} endpoint={STAFF_REFUND} reasonRequired waiting={waiting} />)
    expect(screen.getByTestId('refund-hint')).toHaveTextContent('Add what you saw in Square.')
    expect(screen.getByRole('button', { name: 'It went through' }).style.opacity).toBe('0.5')
    unmount()
    render(<RefundPanel classId="cls_1" booking={booking} endpoint={STAFF_REFUND} reasonRequired />)
    fireEvent.click(screen.getByRole('button', { name: 'Free their seat' }))
    expect(screen.getByTestId('refund-hint')).toHaveTextContent('Add a reason to free the seat.')
  })

  it('an unpaid "pay at the counter" seat: nothing to refund, free the seat instead', () => {
    const unpaid = { ...booking, source: 'door-counter', paidHere: false, refundableCents: 0, refundable: booking.refundable.map((r: any) => ({ ...r, remainingCents: 4000 })) }
    render(<RefundPanel classId="cls_1" booking={unpaid} endpoint={STAFF_REFUND} reasonRequired />)
    expect(screen.getByText('Nothing was paid for this seat. Free the seat instead.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Refund' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Free their seat' })).toBeInTheDocument()
  })

  it('/staff: a counter sale is refunded at the register', () => {
    render(<RefundPanel classId="cls_1" booking={{ ...booking, source: 'pos' }} endpoint={STAFF_REFUND} reasonRequired counterSalesAtRegister />)
    expect(screen.getByText('Refund this at the register, where it was rung up.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Refund' })).toBeNull()
  })

  it('/admin hands in its own sender, so the owner’s name and the sign-in check go with every refund call', async () => {
    const send = vi.fn(async (_url: string, _body: unknown) => ({ ok: true, status: 200, data: { cents: 6000, emailed: false }, extra: {} }))
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(<RefundPanel classId="cls_1" booking={booking} send={send as any} />)
    fireEvent.click(screen.getByRole('button', { name: 'Refund' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm refund' }))
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send.mock.calls[0][0]).toBe('/api/admin/classes/refund.json')
    expect(send.mock.calls[0][1]).toMatchObject({ classId: 'cls_1', kind: 'booking' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await screen.findByText(/Refunded \$60/)).toBeInTheDocument()
  })
})

