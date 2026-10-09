import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import StaffHeader from '@components/staff/StaffHeader'

const base = { title: 'Today', staff: { name: 'Sam' }, onSwitch: () => {}, onKits: () => {}, onGiftCards: () => {}, onLogout: () => {} }

describe('floating Check in button', () => {
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ data: { events: [{ kind: 'workshop', id: 'clssch_a', title: 'Fall Earring Bar', startIso: '2026-10-17T00:00:00Z' }], households: [] } }) }))
  beforeEach(() => { fetchMock.mockClear(); vi.stubGlobal('fetch', fetchMock) })
  afterEach(() => vi.unstubAllGlobals())

  it('is on every staff screen and asks what they are here for first', async () => {
    render(<StaffHeader {...base} />)
    fireEvent.click(screen.getByRole('button', { name: 'Check in a family' }))
    expect(screen.getByRole('dialog', { name: 'Check in' })).toBeTruthy()
    expect(screen.getByText('What are they here for?')).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: /Fall Earring Bar/ }))
    expect(screen.getByRole('button', { name: '✍️ New family? Sign on this iPad' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '← Fall Earring Bar' })).toBeTruthy()
  })

  it('on a roster, hands off to that event’s own add-family sheet', () => {
    const onCheckIn = vi.fn()
    render(<StaffHeader {...base} onCheckIn={onCheckIn} />)
    fireEvent.click(screen.getByRole('button', { name: 'Check in a family' }))
    expect(onCheckIn).toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: 'Check in' })).toBeNull()
  })
})
