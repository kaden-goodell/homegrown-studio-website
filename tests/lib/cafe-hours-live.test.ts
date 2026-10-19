import { describe, it, expect, vi, afterEach } from 'vitest'
import { applyCafeHours, loadCafeHours } from '@lib/cafe-hours-live'

const page = () => {
  document.body.innerHTML = `
    <div data-cafe-hours><div><span>Saturday</span><span>9 AM – 12 PM</span></div></div>
    <div data-cafe-special hidden></div>`
  return document
}
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = '' })

describe('/craft-cafe and the home page take the owners’ café hours', () => {
  it('swaps in the weekly hours and shows the coming special days', () => {
    const doc = page()
    applyCafeHours(doc, { weekly: [{ days: 'Saturday', time: '9 AM – 1 PM' }, { days: 'Sunday', time: '2 – 4 PM' }], special: [{ date: '2026-11-07', name: 'Craft Café grand opening', time: '9 AM – 9 PM' }] })
    expect(doc.querySelector('[data-cafe-hours]')!.textContent).toBe('Saturday9 AM – 1 PMSunday2 – 4 PM')
    const special = doc.querySelector<HTMLElement>('[data-cafe-special]')!
    expect(special.hidden).toBe(false)
    expect(special.textContent).toBe('Saturday, Nov 7 · Craft Café grand opening9 AM – 9 PM')
  })
  it('no weekly café days: the built hours never stay; it says by special day only (with them, or the calendar)', () => {
    let doc = page()
    applyCafeHours(doc, { weekly: [], special: [] })
    expect(doc.querySelector('[data-cafe-hours]')!.textContent).toBe('Craft Café is by special day onlySee the calendar for the next café day')
    doc = page()
    applyCafeHours(doc, { weekly: [], special: [{ date: '2026-12-12', name: 'Holiday market', time: '10 AM – 4 PM' }] })
    expect(doc.querySelector('[data-cafe-hours]')!.textContent).toBe('Craft Café is by special day onlySaturday, Dec 12, 10 AM – 4 PM')
  })
  it('a failed request leaves the page as it was built', async () => {
    const doc = page()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    await loadCafeHours(doc)
    expect(doc.querySelector('[data-cafe-hours]')!.textContent).toBe('Saturday9 AM – 12 PM')
    expect(doc.querySelector<HTMLElement>('[data-cafe-special]')!.hidden).toBe(true)
  })
})
