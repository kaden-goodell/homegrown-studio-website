// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { applyLiveDayNotices, showDayNotices } from '@lib/day-notice-client'

const FROM = '2026-10-17T05:00:00.000Z'
const UNTIL = '2026-11-08T02:00:00.000Z'

describe('showDayNotices', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <a data-day-notice="bar" data-from="${FROM}" data-until="${UNTIL}" hidden>bar</a>
      <section data-day-notice="card" data-from="${FROM}" data-until="${UNTIL}">card</section>`
  })
  const bar = () => document.querySelector<HTMLElement>('[data-day-notice="bar"]')!
  const card = () => document.querySelector<HTMLElement>('[data-day-notice="card"]')!

  it('shows both inside the window, even when the build hid them', () => {
    showDayNotices(Date.parse('2026-11-02T12:00:00Z'), '/')
    expect(bar().hidden).toBe(false)
    expect(card().hidden).toBe(false)
  })

  it('hides both once the café has closed that day, even when the build showed them', () => {
    showDayNotices(Date.parse(UNTIL), '/')
    expect(bar().hidden).toBe(true)
    expect(card().hidden).toBe(true)
  })

  it('keeps the bar off the staff, waiver and party-host pages', () => {
    for (const path of ['/staff', '/waiver', '/admin', '/party/abc']) {
      showDayNotices(Date.parse('2026-11-02T12:00:00Z'), path)
      expect(bar().hidden).toBe(true)
    }
  })
})

describe('applyLiveDayNotices (the owners’ saved café hours)', () => {
  const NOW = Date.parse('2026-11-02T12:00:00Z')
  beforeEach(() => {
    document.body.innerHTML = `
      <a data-day-notice="bar" data-date="2026-11-07" data-from="${FROM}" data-until="${UNTIL}">Craft Café <span data-day-notice-hours>9 AM – 8 PM</span></a>
      <section data-day-notice="card" data-date="2026-11-07" data-from="${FROM}" data-until="${UNTIL}">
        <p data-day-notice-hours>9 AM – 8 PM</p>
        <p data-day-notice-regular>Regular hours are <span data-day-notice-regular-hours>Saturdays 9 AM – 1 PM</span>.</p>
      </section>`
  })
  const bar = () => document.querySelector<HTMLElement>('[data-day-notice="bar"]')!
  const card = () => document.querySelector<HTMLElement>('[data-day-notice="card"]')!

  it('shows the hours as saved', () => {
    applyLiveDayNotices([{ date: '2026-11-07', hours: '10 AM – 6 PM', regularHours: '', showFromIso: FROM, showUntilIso: '2026-11-08T00:00:00.000Z' }], NOW, '/')
    expect(bar().textContent).toContain('10 AM – 6 PM')
    expect(card().querySelector('[data-day-notice-hours]')!.textContent).toBe('10 AM – 6 PM')
    expect(card().querySelector<HTMLElement>('[data-day-notice-regular]')!.hidden).toBe(true)
    expect(bar().hidden).toBe(false)
    expect(card().hidden).toBe(false)
  })

  it('a day removed or closed on /admin since the build goes away', () => {
    applyLiveDayNotices([], NOW, '/')
    expect(bar().hidden).toBe(true)
    expect(card().hidden).toBe(true)
  })
})
