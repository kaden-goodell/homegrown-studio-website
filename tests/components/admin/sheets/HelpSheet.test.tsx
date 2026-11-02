import { describe, it, expect } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { HelpSheet } from '@components/admin/sheets/HelpSheet'
import { visibleHelp } from '@lib/admin-help'
import { renderSheet } from './harness'

describe('More › Help', () => {
  it('opens on How to, with every section shown in this build (Staff included) and none of stage 4', () => {
    const { container } = renderSheet(<HelpSheet />)
    expect(screen.getByRole('heading', { name: 'Help' })).toBeTruthy()
    const titles = [...container.querySelectorAll('summary')].map((x) => x.textContent)
    expect(titles).toEqual(visibleHelp().sections.map((s) => s.title))
    expect(titles).not.toContain('Promotions and early-bird')
    expect(titles).toContain('Staff') // staffing (stage 3) is merged
    // button names are bold
    expect(screen.getAllByText('Cancel this class').some((el) => el.tagName === 'B')).toBe(true)
  })

  it('When you see this lists every shown line, with the Square path marked, and Find narrows it', () => {
    const { container } = renderSheet(<HelpSheet />)
    fireEvent.click(screen.getByRole('button', { name: 'When you see this' }))
    expect(container.querySelectorAll('[data-help-row]').length).toBe(visibleHelp().rows.length)
    expect(screen.getAllByText('Look in Square').length).toBeGreaterThan(0)
    fireEvent.change(screen.getByLabelText('Find'), { target: { value: 'payment to check' } })
    const rows = container.querySelectorAll('[data-help-row]')
    expect(rows.length).toBe(1)
    expect(rows[0].textContent).toMatch(/Put it toward the party/)
    fireEvent.change(screen.getByLabelText('Find'), { target: { value: 'zzzz' } })
    expect(screen.getByText(/Nothing matches/)).toBeTruthy()
  })
})
