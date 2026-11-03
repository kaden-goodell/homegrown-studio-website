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

describe('a day announced on /admin after the page was built (G9)', () => {
  const NOW = Date.parse('2026-12-01T18:00:00Z')
  const LIVE = {
    date: '2026-12-12', headline: 'Holiday Market Day', weekday: 'SAT', monthDay: 'DEC 12', shortDate: 'Sat Dec 12',
    hours: '10 AM – 4 PM', regularHours: 'Saturdays 9 AM – 1 PM', showFromIso: '2026-11-28T06:00:00.000Z', showUntilIso: '2026-12-12T22:00:00.000Z',
  }
  beforeEach(() => {
    document.body.innerHTML = `
      <a data-day-notice="bar" data-date="2026-11-07" data-from="${FROM}" data-until="${UNTIL}"><strong data-day-notice-headline>Grand Opening Day</strong></a>
      <template data-day-notice-template="bar"><a data-day-notice="bar" hidden><strong data-day-notice-headline></strong> <span data-day-notice-short-date></span> · Craft Café <span data-day-notice-hours></span></a></template>
      <template data-day-notice-template="card"><section data-day-notice="card" aria-label="x" hidden><span data-day-notice-headline></span><span data-day-notice-weekday></span><strong data-day-notice-month-day></strong><p data-day-notice-hours></p><p data-day-notice-regular hidden><span data-day-notice-regular-hours></span></p></section></template>`
  })

  it('adds the bar and the card from the page’s templates, filled in, and shows them in their window', () => {
    applyLiveDayNotices([LIVE], NOW, '/')
    const bar = document.querySelector<HTMLElement>('[data-day-notice="bar"][data-date="2026-12-12"]')!
    expect(bar.hidden).toBe(false)
    expect(bar.textContent).toBe('Holiday Market Day Sat Dec 12 · Craft Café 10 AM – 4 PM')
    const card = document.querySelector<HTMLElement>('[data-day-notice="card"][data-date="2026-12-12"]')!
    expect(card.hidden).toBe(false)
    expect(card.getAttribute('aria-label')).toBe('Holiday Market Day, Sat Dec 12')
    expect(card.querySelector('[data-day-notice-month-day]')!.textContent).toBe('DEC 12')
    expect(card.querySelector<HTMLElement>('[data-day-notice-regular]')!.hidden).toBe(false)
    // the built grand-opening bar isn't announced any more: gone
    expect(document.querySelector<HTMLElement>('[data-day-notice="bar"][data-date="2026-11-07"]')!.hidden).toBe(true)
  })

  it('not before its window, and never twice on a second load', () => {
    applyLiveDayNotices([LIVE], Date.parse('2026-11-20T18:00:00Z'), '/')
    applyLiveDayNotices([LIVE], Date.parse('2026-11-20T18:00:00Z'), '/')
    expect(document.querySelectorAll('[data-day-notice="bar"][data-date="2026-12-12"]')).toHaveLength(1)
    expect(document.querySelector<HTMLElement>('[data-day-notice="bar"][data-date="2026-12-12"]')!.hidden).toBe(true)
  })

  it('a headline changed on /admin shows on the built bar too', () => {
    applyLiveDayNotices([{ ...LIVE, date: '2026-11-07', headline: 'Grand Opening!', showFromIso: FROM, showUntilIso: UNTIL }], Date.parse('2026-11-02T12:00:00Z'), '/')
    expect(document.querySelector('[data-day-notice="bar"][data-date="2026-11-07"] [data-day-notice-headline]')!.textContent).toBe('Grand Opening!')
  })
})

describe('two announced days with overlapping windows (I5)', () => {
  const DEC5 = { date: '2026-12-05', headline: 'Ornament Day', weekday: 'SAT', monthDay: 'DEC 5', shortDate: 'Sat Dec 5', hours: '9 AM – 4 PM', regularHours: '', showFromIso: '2026-11-21T06:00:00.000Z', showUntilIso: '2026-12-05T22:00:00.000Z' }
  const DEC12 = { date: '2026-12-12', headline: 'Holiday Market Day', weekday: 'SAT', monthDay: 'DEC 12', shortDate: 'Sat Dec 12', hours: '10 AM – 4 PM', regularHours: '', showFromIso: '2026-11-28T06:00:00.000Z', showUntilIso: '2026-12-12T22:00:00.000Z' }
  beforeEach(() => {
    document.body.innerHTML = `
      <template data-day-notice-template="bar"><a data-day-notice="bar" hidden><strong data-day-notice-headline></strong></a></template>
      <template data-day-notice-template="card"><section data-day-notice="card" hidden><span data-day-notice-headline></span></section></template>`
  })
  const shown = (kind: string) => [...document.querySelectorAll<HTMLElement>(`[data-day-notice="${kind}"]`)].filter((el) => !el.hidden).map((el) => el.dataset.date)

  it('shows only the sooner day’s bar and card while both windows are open (given in either order)', () => {
    applyLiveDayNotices([DEC12, DEC5], Date.parse('2026-12-01T18:00:00Z'), '/')
    expect(shown('bar')).toEqual(['2026-12-05'])
    expect(shown('card')).toEqual(['2026-12-05'])
  })

  it('once the sooner day is over, the later one takes its place', () => {
    applyLiveDayNotices([DEC5, DEC12], Date.parse('2026-12-06T18:00:00Z'), '/')
    expect(shown('bar')).toEqual(['2026-12-12'])
    expect(shown('card')).toEqual(['2026-12-12'])
  })
})
