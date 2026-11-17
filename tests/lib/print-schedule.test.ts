// tests/lib/print-schedule.test.ts — the window schedule: what goes on it, and how it's laid out.
import { describe, it, expect, vi } from 'vitest'
import { buildDays, densityOf, pagesOf, renderPrintSchedule, timeRange, mondayOf, LAYOUTS, SHOWS, FIT_SCRIPT } from '@lib/print-schedule'
import { THANKSGIVING_WEEK, BUSY_WEEK } from '../fixtures/print-schedule-weeks'

const text = (html: string) => html.replace(/<style>[\s\S]*?<\/style>|<script>[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ')

describe('times and weeks', () => {
  it('reads like a person writes it', () => {
    expect(timeRange('09:00', '14:00')).toBe('9 AM – 2 PM')
    expect(timeRange('16:00', '20:00')).toBe('4 – 8 PM')
    expect(timeRange('13:30')).toBe('1:30 PM')
    expect(timeRange('18:30', '20:30')).toBe('6:30 – 8:30 PM')
  })
  it('weeks run Monday to Sunday', () => {
    expect(mondayOf('2026-11-29')).toBe('2026-11-23')
    expect(mondayOf('2026-11-23')).toBe('2026-11-23')
  })
})

describe('what goes on the schedule', () => {
  const full = buildDays(THANKSGIVING_WEEK, '2026-11-23', 7, 'full')

  it('never prints an open party time', () => {
    expect(full.flatMap((d) => d.items).some((i) => /^Party$/.test(i.title))).toBe(false)
    expect(full[6].items.map((i) => i.title)).toEqual(['Christmas Embroidery Wreath Sash'])
  })
  it('a booked party is just "Private party" and its start time', () => {
    const sat = full[5]
    expect(sat.items.map((i) => [i.title, i.time])).toEqual([
      ['Craft Café', '9 AM – 1 PM'],
      ['Private party', '1:30 PM'],
      ['Craft Café', '4 – 8 PM'],
    ])
  })
  it('closed days carry the holiday name', () => {
    expect(full[3].closed).toBe('Closed for Thanksgiving')
    expect(full[3].items).toEqual([])
  })
  it('café only: café windows, no workshops or parties', () => {
    const cafe = buildDays(BUSY_WEEK, '2026-12-07', 7, 'cafe')
    expect(cafe.flatMap((d) => d.items).every((i) => i.kind === 'cafe')).toBe(true)
    expect(cafe[3].items).toEqual([]) // Thursday: no café
  })
  it('workshops only: just workshops', () => {
    const ws = buildDays(BUSY_WEEK, '2026-12-07', 7, 'workshops')
    expect(ws.flatMap((d) => d.items).map((i) => i.kind)).toEqual(Array(7).fill('workshop'))
  })
  it('private events show as "Private Event" on the full schedule', () => {
    expect(buildDays(BUSY_WEEK, '2026-12-07', 7, 'full')[5].items[1]).toMatchObject({ kind: 'event', title: 'Private Event', time: '10 AM – 12 PM' })
  })
  it('two weeks print as two pages, one week each', () => {
    const days = buildDays(BUSY_WEEK, '2026-11-30', 14, 'full')
    expect(pagesOf(days).map((p) => p.length)).toEqual([7, 7])
    expect(renderPrintSchedule({ days, layout: 'list', show: 'full' }).match(/<section class="page/g)).toHaveLength(2)
  })
  it('never more than 14 days', () => {
    expect(buildDays([], '2026-11-23', 40, 'full')).toHaveLength(14)
  })
})

describe('moved classes stay off (through the public calendar)', () => {
  it('prints only what /api/calendar.json gives a stranger', async () => {
    vi.resetModules()
    const seen: Request[] = []
    vi.doMock('../../src/pages/api/calendar.json', () => ({
      GET: async ({ request }: { request: Request }) => {
        seen.push(request)
        // The public calendar has already dropped the moved Square class; only its new-system copy is here.
        return new Response(JSON.stringify({ events: [
          { id: 'cls-new', kind: 'workshop', title: 'Embroidery 101', date: '2026-12-13', startTime: '18:00', endTime: '20:00' },
          { id: 'next-month', kind: 'workshop', title: 'Out of range', date: '2026-12-20', startTime: '18:00' },
        ] }))
      },
    }))
    const { publicScheduleEvents } = await import('@lib/print-schedule-source')
    const { events } = await publicScheduleEvents('https://ourhometownstudio.com', '2026-11-30', '2026-12-13')
    expect(events.map((e) => e.id)).toEqual(['cls-new'])
    expect(seen[0].url).toContain('month=2026-11&months=2')
    expect(seen[0].headers.get('cookie')).toBeNull() // no test-link cookie: what the public sees
    vi.doUnmock('../../src/pages/api/calendar.json')
  })
})

describe('every layout × every choice', () => {
  for (const { id: layout } of LAYOUTS) for (const { id: show } of SHOWS) {
    it(`${layout} / ${show}`, () => {
      const html = renderPrintSchedule({ days: buildDays(THANKSGIVING_WEEK, '2026-11-23', 7, show), layout, show })
      const t = text(html)
      expect(t).toContain('525 Hughes Rd, Ste F · Madison')
      expect(t).toContain('(256) 464-1710 · ourhometownstudio.com')
      expect(html.toLowerCase()).not.toContain('homegrown')
      expect(html).not.toMatch(/402.?980.?2907/)
      expect(html).toContain('@page{size:letter portrait;margin:0}')
      expect(html).toContain('print-color-adjust:exact')
      if (show !== 'workshops') expect(t).toContain('9 AM – 2 PM')
      if (show !== 'cafe') expect(t).toContain('Christmas Embroidery Wreath Sash')
      if (show === 'full') expect(t).toContain('Private party')
      if (show !== 'full') expect(t).not.toContain('Private party')
      if (show !== 'workshops') expect(t).toMatch(/Thanksgiving|Closed/)
    })
  }
  it('an empty workshops week says to see Craft Café hours', () => {
    for (const { id: layout } of LAYOUTS) {
      const t = text(renderPrintSchedule({ days: buildDays([], '2026-11-23', 7, 'workshops'), layout, show: 'workshops' }))
      expect(t).toMatch(/No workshops this week/)
      expect(t).toMatch(/Craft Café hours|Craft Café any open hour/)
    }
  })
  it('only asks the printer when asked to', () => {
    const days = buildDays(THANKSGIVING_WEEK, '2026-11-23', 7, 'full')
    expect(renderPrintSchedule({ days, layout: 'list', show: 'full', autoPrint: true })).toContain('window.print()')
    expect(renderPrintSchedule({ days, layout: 'list', show: 'full' })).not.toContain('window.print()')
  })
})

describe('fits one page', () => {
  it('a busy week is set tighter than a quiet one', () => {
    const quiet = buildDays(THANKSGIVING_WEEK, '2026-11-23', 7, 'full')
    const busy = buildDays(BUSY_WEEK, '2026-12-07', 7, 'full')
    expect(densityOf(quiet, 'list', 'full')).toBe('roomy')
    expect(densityOf(busy, 'list', 'full')).not.toBe('roomy')
    expect(densityOf(busy, 'poster', 'full')).not.toBe('roomy')
  })
  it('every page is one letter sheet that hides overflow, and the page shrinks anything still too full', () => {
    const html = renderPrintSchedule({ days: buildDays(BUSY_WEEK, '2026-12-07', 7, 'full'), layout: 'cards', show: 'full' })
    expect(html).toContain('.page{width:8.5in;height:11in;')
    expect(html).toMatch(/\.page\{[^}]*overflow:hidden/)
    expect(html).toContain('fitPages()')
    expect(FIT_SCRIPT).toContain('style.zoom')
  })
  // jsdom has no layout: the page reads too tall until its contents are shrunk past `fitsBelow`.
  const fit = (fitsBelow: number) => {
    document.body.innerHTML = '<section class="page tight"><div class="a"></div><div class="foot"></div></section>'
    const p = document.querySelector('.page') as HTMLElement
    const kid = p.querySelector('.a') as HTMLElement
    Object.defineProperty(p, 'clientHeight', { get: () => 1056 })
    Object.defineProperty(p, 'scrollHeight', { get: () => (Number(kid.style.zoom || 1) < fitsBelow ? 1000 : 1200) })
    // eslint-disable-next-line no-new-func
    new Function(`${FIT_SCRIPT};fitPages()`)()
    return { p, kid, foot: p.querySelector('.foot') as HTMLElement }
  }
  it('a little too full: snug, shrunk just enough, footer untouched', () => {
    const { p, kid, foot } = fit(0.9)
    expect(p.className).toBe('page snug')
    expect(Number(kid.style.zoom)).toBeGreaterThan(0.85)
    expect(p.getAttribute('data-fit')).toBe('ok')
    expect(foot.style.zoom).toBe('')
  })
  it('much too full: tight', () => {
    const { p } = fit(0.6)
    expect(p.className).toBe('page tight')
    expect(p.getAttribute('data-fit')).toBe('ok')
  })
  it('fits roomy: stays roomy, nothing shrunk', () => {
    const { p, kid } = fit(2)
    expect(p.className).toBe('page roomy')
    expect(kid.style.zoom).toBe('')
  })
})
