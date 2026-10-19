import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
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
    expect(screen.getByText('Booking opens soon. Check back, or see what’s on the calendar.')).toBeInTheDocument()
  })
})
