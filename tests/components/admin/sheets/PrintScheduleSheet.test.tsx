// tests/components/admin/sheets/PrintScheduleSheet.test.tsx — More › Print schedule.
import { describe, it, expect } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { PrintScheduleSheet, printScheduleHref } from '@components/admin/sheets/PrintScheduleSheet'
import { renderSheet } from './harness'

const preview = () => screen.getByTitle('Preview of the schedule') as HTMLIFrameElement
const printLink = () => screen.getByRole('link', { name: /^Print/ }) as HTMLAnchorElement
const params = (href: string) => new URL(href, 'https://x.test').searchParams

describe('Print schedule', () => {
  it('starts on List, full schedule, next week, and previews what it prints', () => {
    renderSheet(<PrintScheduleSheet />)
    const q = params(preview().getAttribute('src')!)
    expect(q.get('layout')).toBe('list')
    expect(q.get('show')).toBe('full')
    expect(q.get('days')).toBe('7')
    expect(new Date(`${q.get('from')}T12:00:00Z`).getUTCDay()).toBe(1) // a Monday
    const p = params(printLink().getAttribute('href')!)
    expect(p.get('print')).toBe('1')
    expect(p.get('from')).toBe(q.get('from'))
    expect(printLink().target).toBe('_blank')
  })

  it('every look and every choice changes the page', () => {
    renderSheet(<PrintScheduleSheet />)
    for (const [btn, key, val] of [['Cards', 'layout', 'cards'], ['Poster', 'layout', 'poster'], ['Craft Café hours only', 'show', 'cafe'], ['Workshops only', 'show', 'workshops']]) {
      fireEvent.click(screen.getByRole('button', { name: btn }))
      expect(params(preview().getAttribute('src')!).get(key)).toBe(val)
    }
  })

  it('this week, or any day for up to two weeks (two pages)', () => {
    renderSheet(<PrintScheduleSheet />)
    const next = params(preview().getAttribute('src')!).get('from')!
    fireEvent.click(screen.getByRole('button', { name: 'This week' }))
    const thisWeek = params(preview().getAttribute('src')!).get('from')!
    expect(Date.parse(next) - Date.parse(thisWeek)).toBe(7 * 86_400_000)
    fireEvent.click(screen.getByRole('button', { name: 'Pick a day' }))
    fireEvent.change(screen.getByLabelText('Starting'), { target: { value: '2026-12-07' } })
    fireEvent.change(screen.getByLabelText('How many days'), { target: { value: '14' } })
    expect(params(preview().getAttribute('src')!).get('from')).toBe('2026-12-07')
    expect(printLink().textContent).toBe('Print (2 pages)')
  })

  it('builds plain addresses', () => {
    expect(printScheduleHref({ from: '2026-11-23', days: 7, layout: 'poster', show: 'cafe' })).toBe('/admin/print-schedule?from=2026-11-23&days=7&layout=poster&show=cafe')
  })
})
