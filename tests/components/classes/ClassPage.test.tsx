import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ClassPage from '@components/classes/ClassPage'
import { toPublicClass } from '@lib/classes/public-view'
import { defaultRules } from '@lib/classes/validate'
import type { ScheduledClass } from '@lib/classes/types'

vi.mock('@components/classes/ClassBookingPanel', () => ({
  default: ({ workshop }: { workshop: { name: string } }) => <div data-testid="class-panel">Panel for {workshop.name}</div>,
}))

const cls = (status: ScheduledClass['status'] = 'open'): ScheduledClass => ({
  id: 'cls_1', libraryId: null, libraryVersion: null, status,
  content: {
    name: 'Clay Camp', description: 'Make a pot.', imageUrl: null, instructor: null, rules: { ...defaultRules(), linkOnly: true },
    ticketTypes: [{ id: 'person', label: 'Person' }], passes: [{ id: 'all', label: 'Full', covers: { kind: 'all' } }],
    prices: { all: { person: 2000 } }, questions: [], addOns: [], defaultCapacity: 8, defaultMinutes: 120,
  },
  sessions: [{ id: 'ses_a', startIso: '2026-10-24T18:00:00Z', endIso: '2026-10-24T20:00:00Z', capacity: 8 }],
  square: { itemId: null, variations: {} }, createdAt: '', updatedAt: '', by: { id: 'u', name: 'u' }, history: [],
})
const NOW = new Date('2026-10-20T12:00:00Z')

describe('ClassPage (/classes/<id>)', () => {
  it('shows the card and opens the booking panel for a link-only class', () => {
    render(<ClassPage workshop={toPublicClass(cls(), { classId: 'cls_1', lines: [] }, NOW)} bookingsOpen />)
    expect(screen.getByRole('heading', { name: 'Clay Camp' })).toBeInTheDocument()
    expect(screen.getByTestId('class-panel')).toHaveTextContent('Clay Camp')
  })
  it('no panel when sign-ups are closed, or bookings aren’t open yet', () => {
    const { unmount } = render(<ClassPage workshop={toPublicClass(cls('closed'), { classId: 'cls_1', lines: [] }, NOW)} bookingsOpen />)
    expect(screen.getByText('Sign-ups closed')).toBeInTheDocument()
    expect(screen.queryByTestId('class-panel')).toBeNull()
    unmount()
    render(<ClassPage workshop={toPublicClass(cls(), { classId: 'cls_1', lines: [] }, NOW)} bookingsOpen={false} />)
    expect(screen.queryByTestId('class-panel')).toBeNull()
    expect(screen.queryByRole('button', { name: /book/i })).toBeNull()
    expect(screen.getByText('Online booking is paused for now. Check back soon, or see what’s on the calendar.')).toBeInTheDocument()
  })
  it('a paused class shows the owners’ pause note', () => {
    render(<ClassPage workshop={toPublicClass(cls(), { classId: 'cls_1', lines: [] }, NOW)} bookingsOpen={false} closedNote="Back online Monday. Call us to book." />)
    expect(screen.getByText('Back online Monday. Call us to book.')).toBeInTheDocument()
    expect(screen.queryByText(/grand opening/i)).toBeNull()
  })

  /** Sold out, with its waitlist open. */
  const soldOutWithWaitlist = () => {
    const full = Array.from({ length: 8 }, (_, i) => ({ id: `led_${i}`, bookingId: 'bkg_x', sessionIds: ['ses_a'], ticketTypeId: 'person', passId: 'all', seat: i + 1, priceCents: 2000, taxCents: 0, addOns: {}, addOnCents: 0, addOnTaxCents: 0, answers: {}, source: 'online', state: 'confirmed', holdExpiresAt: null, customer: null, square: { orderId: null, paymentId: null, lineUid: null }, by: null, refunds: [], at: '' }))
    const w = toPublicClass(cls(), { classId: 'cls_1', lines: full as any }, NOW)
    return { ...w, remainingSeats: 0, own: { ...w.own!, sessions: w.own!.sessions.map((x) => ({ ...x, left: 0, waitlist: { open: true, closesIso: '2026-10-22T18:00:00Z' } })) } } as any
  }
  it('a sold-out class with its waitlist open: Join the waitlist opens the panel (final review I2)', () => {
    render(<ClassPage workshop={soldOutWithWaitlist()} bookingsOpen />)
    expect(screen.queryByTestId('class-panel')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Join the waitlist' }))
    expect(screen.getByTestId('class-panel')).toBeInTheDocument()
  })
  it('while booking is paused, no Join the waitlist button: the pause note instead', () => {
    render(<ClassPage workshop={soldOutWithWaitlist()} bookingsOpen={false} />)
    expect(screen.queryByRole('button', { name: 'Join the waitlist' })).toBeNull()
    expect(screen.getByText('Online booking is paused for now. Check back soon, or see what’s on the calendar.')).toBeInTheDocument()
  })
})
