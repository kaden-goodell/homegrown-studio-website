import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import StaffHeader from '@components/staff/StaffHeader'
import { StaffNavContext, type StaffNav } from '@components/staff/nav'

function setup(active: StaffNav['active'] = 'today') {
  const nav: StaffNav = { active, go: vi.fn(), switchStaff: vi.fn(), logout: vi.fn() }
  render(<StaffNavContext.Provider value={nav}><StaffHeader staff={{ name: 'Sam' }} /></StaffNavContext.Provider>)
  return nav
}

describe('staff tabs', () => {
  it('shows four tabs with the current one marked, and switches on tap', () => {
    const nav = setup('kits')
    for (const t of ['Today', 'Parties', 'Kits', 'Gift cards']) expect(screen.getByRole('button', { name: t })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Kits' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('button', { name: 'Today' }).getAttribute('aria-current')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Parties' }))
    expect(nav.go).toHaveBeenCalledWith('parties')
  })

  it('the name opens Switch person and Log out', () => {
    const nav = setup()
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Sam ▾' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Switch person' }))
    expect(nav.switchStaff).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Sam ▾' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Log out' }))
    expect(nav.logout).toHaveBeenCalled()
  })
})
