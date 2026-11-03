import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import StaffHeader from '@components/staff/StaffHeader'
import { StaffNavContext, visibleTabs, type StaffNav } from '@components/staff/nav'

function setup(active: StaffNav['active'] = 'today') {
  const nav: StaffNav = { active, go: vi.fn(), switchStaff: vi.fn(), logout: vi.fn() }
  render(<StaffNavContext.Provider value={nav}><StaffHeader staff={{ name: 'Sam' }} /></StaffNavContext.Provider>)
  return nav
}

describe('staff tabs', () => {
  it('Kits is hidden while kits are closed (site config), unless you are on it (I6)', () => {
    setup('today')
    expect(screen.queryByRole('button', { name: 'Kits' })).toBeNull()
    expect(visibleTabs('today', false).map((t) => t.id)).toEqual(['week', 'today', 'upcoming', 'calendar', 'shifts', 'giftcards'])
    expect(visibleTabs('today', true).map((t) => t.id)).toContain('kits')
    expect(visibleTabs('kits', false).map((t) => t.id)).toContain('kits')
  })

  it('one row that scrolls sideways (never wraps), on its own line on phones, with the current tab scrolled into view (I6)', () => {
    const spy = vi.fn()
    const orig = HTMLElement.prototype.scrollIntoView
    HTMLElement.prototype.scrollIntoView = spy
    try {
      setup('giftcards')
      const strip = screen.getByTestId('staff-tabs-strip')
      expect(strip.style.overflowX).toBe('auto')
      expect(strip.style.flexWrap).toBe('nowrap')
      const nav = screen.getByRole('navigation', { name: 'Staff sections' })
      expect(nav.style.flexWrap).toBe('nowrap')
      expect(strip.parentElement!.className).toBe('staff-tabs-row')
      // own row by default; only a wide HEADER (container query, not the screen) shares it (I4)
      expect(strip.parentElement!.style.flex).toBe('1 1 100%')
      expect(document.querySelector('style')!.textContent).toMatch(/\.staff-header \{ container-type: inline-size; \} @container \(min-width: 60rem\) \{ \.staff-tabs-row \{ flex-basis: 0/)
      expect(document.querySelector('style')!.textContent).not.toMatch(/@media/)
      expect(spy).toHaveBeenCalledWith({ inline: 'nearest', block: 'nearest' })
      expect(spy.mock.contexts[0]).toBe(screen.getByRole('button', { name: 'Gift cards' }))
      for (const b of Array.from(nav.querySelectorAll('button'))) expect(b.style.minHeight).toBe('2.75rem')
    } finally {
      HTMLElement.prototype.scrollIntoView = orig
    }
  })

  it('shows four tabs with the current one marked, and switches on tap', () => {
    const nav = setup('kits')
    for (const t of ['Today', 'Upcoming', 'Kits', 'Gift cards']) expect(screen.getByRole('button', { name: t })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Kits' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('button', { name: 'Today' }).getAttribute('aria-current')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Upcoming' }))
    expect(nav.go).toHaveBeenCalledWith('upcoming')
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
