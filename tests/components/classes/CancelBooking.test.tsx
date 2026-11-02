// D2: the customer's "Can't make it?" page.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import CancelBooking from '@components/classes/CancelBooking'

afterEach(() => vi.unstubAllGlobals())

const seat = (n: number, over: any = {}) => ({ lineId: `led_${n}`, seat: n, label: 'Adult', cents: 2180, state: 'booked', canPick: true, ...over })
const view = (over: any = {}) => ({
  className: 'Candles', whenLabel: 'Sat, Nov 14 · 1:00 PM CT', state: 'open', mode: 'self', why: null, policyHours: 48,
  seats: [seat(1), seat(2)], wholeOnly: false, request: null, refundedCents: 0, ...over,
})
const ok = (data: any) => ({ ok: true, status: 200, json: async () => ({ data }) })
const refuse = (status: number, body: any) => ({ ok: false, status, json: async () => body })

function show(initial: any, answer: (body: any) => any) {
  const f = vi.fn(async (_url: string, init?: any) => answer(JSON.parse(init.body)))
  vi.stubGlobal('fetch', f)
  render(<CancelBooking token="cls_1.bkg_1.sig" initial={initial} />)
  return f
}
const bodies = (f: any) => f.mock.calls.map((c: any) => JSON.parse(c[1].body))

describe('Can’t make it? page', () => {
  it('48+ hours: pick seats, the button says the refund, a second Yes in the page, then Done with the amount', async () => {
    const f = show(view(), (b) => ok({ result: 'cancelled', cents: 2180, view: view({ seats: [seat(1, { state: 'cancelled', canPick: false, cents: 0 }), seat(2)], refundedCents: 2180 }) }))
    expect(screen.getByRole('heading', { name: 'Can’t make it?' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pick the seats to cancel' })).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: /Seat 1 · Adult · \$21\.80 back/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel and refund $21.80' }))
    const ask = screen.getByRole('group', { name: 'Cancel for sure?' })
    expect(ask).toHaveTextContent('Cancel your seat and refund $21.80?')
    fireEvent.click(within(ask).getByRole('button', { name: 'Keep my booking' }))
    expect(f).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel and refund $21.80' }))
    fireEvent.click(within(screen.getByRole('group', { name: 'Cancel for sure?' })).getByRole('button', { name: 'Yes, cancel and refund' }))
    expect(await screen.findByText('Done. We refunded $21.80 to the card you paid with, and we sent you an email to say so.')).toBeInTheDocument()
    expect(bodies(f)[0]).toMatchObject({ t: 'cls_1.bkg_1.sig', action: 'cancel', lineIds: ['led_1'] })
    expect(bodies(f)[0].attempt).toMatch(/^[A-Za-z0-9_-]{6,80}$/)
    expect(screen.getByRole('checkbox', { name: /Seat 1 · Adult · cancelled/ })).toBeDisabled()
  })

  it('a booking for several dates: every seat ticked and locked', () => {
    show(view({ wholeOnly: true }), () => ok({}))
    expect(screen.getByText('This booking covers more than one date, so all of its seats are cancelled together.')).toBeInTheDocument()
    for (const c of screen.getAllByRole('checkbox')) { expect(c).toBeChecked(); expect(c).toBeDisabled() }
    expect(screen.getByRole('button', { name: 'Cancel and refund $43.60' })).toBeEnabled()
  })

  it('Square didn’t answer: says it’s being finished and the seats are held', async () => {
    show(view({ seats: [seat(1)] }), () => ok({ result: 'cancelling', cents: 2180, view: view({ state: 'cancelling', seats: [seat(1, { state: 'cancelling', canPick: false })] }) }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel and refund $21.80' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, cancel and refund' }))
    expect(await screen.findByText(/We’re finishing your refund with our card processor\. Your seats stay held until it’s done/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Your cancel is in' })).toBeInTheDocument()
  })

  it('turned down: the error says nothing changed; the next press is a new attempt', async () => {
    const f = show(view({ seats: [seat(1)] }), () => refuse(502, { code: 'square', error: 'The refund didn’t go through just now, so nothing changed and your seats are still booked. Try again in a few minutes, or send us a note.', view: view({ seats: [seat(1)] }) }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel and refund $21.80' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, cancel and refund' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The refund didn’t go through just now')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel and refund $21.80' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, cancel and refund' }))
    await waitFor(() => expect(f).toHaveBeenCalledTimes(2))
    expect(bodies(f)[0].attempt).not.toBe(bodies(f)[1].attempt)
  })

  it('inside 48 hours: the policy and a note box; sending it says we got it', async () => {
    const why = 'Your class is less than 48 hours away, so it can’t be cancelled and refunded online.'
    const f = show(view({ mode: 'request', why, seats: [seat(1, { canPick: false })] }), () => ok({ result: 'requested', view: view({ mode: 'request', why, state: 'requested', request: { at: '', note: 'Sick' }, seats: [seat(1, { canPick: false })] }) }))
    expect(screen.getByText(why)).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.getByRole('button', { name: 'Send us a note' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Your note'), { target: { value: 'Sick' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send us a note' }))
    expect(await screen.findByText('Thanks, we got your note. We’ll reply by email or text.')).toBeInTheDocument()
    expect(bodies(f)[0]).toEqual({ t: 'cls_1.bkg_1.sig', action: 'request', note: 'Sick' })
  })

  it('a free booking: nothing to refund, Cancel my seat', () => {
    show(view({ mode: 'free', seats: [seat(1, { cents: 0 })] }), () => ok({}))
    expect(screen.getByText(/This booking was free, so there’s nothing to refund/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel my seat' })).toBeEnabled()
  })

  it('already cancelled: says so, no buttons', () => {
    show(view({ state: 'cancelled', mode: 'none', refundedCents: 4360, seats: [seat(1, { state: 'cancelled', canPick: false }), seat(2, { state: 'cancelled', canPick: false })] }), () => ok({}))
    expect(screen.getByRole('heading', { name: 'Your booking is cancelled' })).toBeInTheDocument()
    expect(screen.getByText('$43.60 was refunded to the card you paid with.')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
