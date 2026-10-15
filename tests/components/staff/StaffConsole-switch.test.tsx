import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import StaffConsole from '@components/staff/StaffConsole'

afterEach(() => { vi.restoreAllMocks(); history.replaceState(null, '', '/') })

describe('StaffConsole — Switch person', () => {
  it('opens a flyout of the team (no passcode screen) and switches who is signed in', async () => {
    history.replaceState(null, '', '/staff')
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, init?: any) => {
      const href = String(url)
      const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ data }) }) as Response
      if (href.includes('/api/staff/me.json')) return ok({ staff: { id: 'a', name: 'Kaden', role: 'owner' } })
      if (href.includes('/api/staff/switch.json') && init?.method === 'POST') return ok({ staff: { id: 'c', name: 'Ava', role: 'crew' } })
      if (href.includes('/api/staff/switch.json')) return ok({ staff: [{ id: 'a', name: 'Kaden', role: 'owner' }, { id: 'c', name: 'Ava', role: 'crew' }] })
      return ok({ events: [], sources: {}, count: 0, parties: [], incidents: [] })
    })
    render(<StaffConsole />)
    fireEvent.click(await screen.findByRole('button', { name: /Kaden/, expanded: false }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Switch person' }))
    const sheet = await screen.findByRole('dialog', { name: 'Switch person' })
    expect(screen.queryByLabelText(/passcode/i)).toBeNull()
    fireEvent.click(await within(sheet).findByRole('button', { name: 'Ava' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Switch person' })).toBeNull())
    expect(await screen.findByRole('button', { name: /Ava/, expanded: false })).toBeInTheDocument()
  })
})
