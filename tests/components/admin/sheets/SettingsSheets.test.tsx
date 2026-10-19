import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ReactElement } from 'react'
import { act, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { ClosedDaysSheet, HoursSheet } from '@components/admin/sheets/SettingsSheets'
import { StudioProvider, useStudio } from '@components/admin/shell/studio'
import { at, ok, posts, refuse, renderSheet } from './harness'

const SETTINGS = '/api/admin/settings.json'
const view = () => ({
  cafeWeekly: [{ weekday: 'Saturday', opens: '09:00', closes: '12:00' }],
  cafeSpecialDays: [{ date: '2026-11-07', opens: '09:00', closes: '21:00', name: 'Craft Café grand opening' }],
  closures: [
    { id: 'cfg-2026-10-30', from: '2026-10-30', to: '2026-11-01', name: 'Halloween weekend', holiday: 'halloween' },
    { id: 'cfg-2026-11-26', from: '2026-11-26', to: '2026-11-27', name: 'Thanksgiving', holiday: 'thanksgiving' },
  ],
  updatedAt: null as string | null, by: null, history: [],
})

/** The settings route: keeps what was saved, answers 409 to an old updatedAt, and says how Square went. */
function server(o: { square?: any; booked?: any[]; stale?: boolean; fail?: boolean } = {}) {
  let cur: any = view()
  let n = 0
  const fn = vi.fn(async (url: string, init?: any) => {
    if (url.split('?')[0] !== SETTINGS) throw new Error(`unexpected ${url}`)
    if (init?.method !== 'POST') return ok({ data: { settings: cur } })
    const b = JSON.parse(init.body)
    if (b.action === 'square-retry') return ok({ data: { square: { status: 'updated', message: 'Square has the new café hours.' } } })
    if (o.fail) return refuse(503, { error: 'Didn’t save. Try again.' })
    if (o.stale || b.expectedUpdatedAt !== cur.updatedAt) {
      o.stale = false
      cur = { ...cur, updatedAt: `other-${++n}`, closures: [] }
      return refuse(409, { error: 'Someone else changed these settings. Check them and save again.', stale: true, current: cur })
    }
    const closures = b.closures.map((c: any, i: number) => ({ ...c, id: c.id ?? `clo_new${i}`, to: c.to || c.from, name: c.name || 'a break' }))
    cur = { ...cur, cafeWeekly: b.cafeWeekly, cafeSpecialDays: b.cafeSpecialDays, closures, updatedAt: `saved-${++n}`, by: { id: 'owner-catherine', name: 'Catherine' } }
    return ok({ data: { settings: cur, changed: ['x'], booked: o.booked ?? [], square: o.square === undefined ? { status: 'updated', message: 'Square has the new café hours.' } : o.square } })
  })
  return fn
}
/*
 * Cheap stand-ins for getByRole('button' | 'group', { name }) over the whole page. Same rule (a button's name is
 * its aria-label, else its text; a group's is its legend or aria-label), without testing-library working out the
 * accessible name of every element on each call (~100× slower here). Under a loaded full run those role queries,
 * repeated by findBy polling, ran this file into the 5 s test timeout.
 */
const nameOf = (el: Element) => (el.getAttribute('aria-label') ?? el.textContent ?? '').replace(/\s+/g, ' ').trim()
const one = <T extends Element>(what: string, hits: T[]): T => {
  if (hits.length !== 1) throw new Error(`expected one ${what}, found ${hits.length}`)
  return hits[0]
}
const button = (name: string) => one(`button "${name}"`, [...document.querySelectorAll('button')].filter((b) => nameOf(b) === name)) as HTMLButtonElement
const group = (name: string) => one(`group "${name}"`, [
  ...[...document.querySelectorAll('fieldset')].filter((f) => !f.hasAttribute('aria-label') && f.querySelector(':scope > legend')?.textContent?.trim() === name),
  ...[...document.querySelectorAll('[role="group"][aria-label], fieldset[aria-label]')].filter((g) => g.getAttribute('aria-label') === name),
]) as HTMLElement
/**
 * Found, then React's pending effects flushed before the test types: the form's mount effect (show someone else's
 * save) must not run after the first keystroke. A person can't type that fast; a quick query can.
 */
const settled = async <T,>(find: () => T): Promise<T> => {
  await waitFor(find)
  await act(async () => {})
  return find()
}
const findButton = (name: string) => settled(() => button(name))
const findGroup = (name: string) => settled(() => group(name))
const sheet = (ui: ReactElement) => renderSheet(<StudioProvider>{ui}</StudioProvider>)
const footer = () => document.querySelector('.adm-sheet-foot') as HTMLElement

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-19T15:00:00Z'))
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('More › Hours & Craft Café', () => {
  it('shows the weekly hours, special days coming up, and studio hours; Save waits for a change', async () => {
    vi.stubGlobal('fetch', server())
    sheet(<HoursSheet />)
    const set = await findGroup('Saturdays')
    expect(within(set).getByLabelText('Opens')).toHaveValue('09:00')
    expect(screen.getByText('Saturdays 9 AM–12 PM')).toBeInTheDocument()
    expect(screen.getByText('Sat Nov 7 · Craft Café grand opening')).toBeInTheDocument()
    expect(button('Save café hours')).toBeDisabled()
    expect(screen.getByText('A special day replaces the usual hours for that day. Closed days beat both.')).toBeInTheDocument()
    expect(screen.getByText('Thursday & Friday')).toBeInTheDocument()
  })

  it('changes Saturday, adds Sunday, saves the whole document with the loaded updatedAt, and says Square has it', async () => {
    const f = server()
    vi.stubGlobal('fetch', f)
    const { dirty } = sheet(<HoursSheet />)
    const sat = await findGroup('Saturdays')
    fireEvent.change(within(sat).getByLabelText('Closes'), { target: { value: '13:00' } })
    fireEvent.change(screen.getByLabelText('Add another day'), { target: { value: 'Sunday' } })
    const sun = group('Sundays')
    fireEvent.change(within(sun).getByLabelText('Opens'), { target: { value: '13:00' } })
    fireEvent.change(within(sun).getByLabelText('Closes'), { target: { value: '15:00' } })
    expect(dirty()).toBe(true)
    fireEvent.click(button('Save café hours'))
    expect(await screen.findByText('Café hours saved.')).toBeInTheDocument()
    const body = posts(f, SETTINGS)[0].body
    expect(body.expectedUpdatedAt).toBeNull()
    expect(body.cafeWeekly).toEqual([{ weekday: 'Saturday', opens: '09:00', closes: '13:00' }, { weekday: 'Sunday', opens: '13:00', closes: '15:00' }])
    expect(body.closures).toHaveLength(2)
    await waitFor(() => expect(dirty()).toBe(false))
  })

  it('closing before it opens is caught before sending', async () => {
    const f = server()
    vi.stubGlobal('fetch', f)
    sheet(<HoursSheet />)
    const sat = await findGroup('Saturdays')
    fireEvent.change(within(sat).getByLabelText('Closes'), { target: { value: '08:00' } })
    fireEvent.click(button('Save café hours'))
    expect(screen.getByRole('alert')).toHaveTextContent('Saturday: it has to close after it opens.')
    expect(posts(f, SETTINGS)).toHaveLength(0)
  })

  it('adds a special day (warning when it is a closed day), with Undo; removes one with Undo', async () => {
    const f = server()
    vi.stubGlobal('fetch', f)
    sheet(<HoursSheet />)
    fireEvent.click(await findButton('+ Add a special day'))
    const set = group('New special day')
    fireEvent.change(within(set).getByLabelText('Day'), { target: { value: '2026-11-26' } })
    expect(within(set).getByText('That day is closed for Thanksgiving. Closed days beat special hours.')).toBeInTheDocument()
    fireEvent.change(within(set).getByLabelText('Day'), { target: { value: '2026-12-12' } })
    fireEvent.change(within(set).getByLabelText('What is it?'), { target: { value: 'Holiday market' } })
    fireEvent.click(within(set).getByRole('button', { name: 'Add day' }))
    expect(await screen.findByText('Added Sat Dec 12. It’s on the calendar.')).toBeInTheDocument()
    expect(posts(f, SETTINGS)[0].body.cafeSpecialDays).toContainEqual({ date: '2026-12-12', opens: '09:00', closes: '17:00', name: 'Holiday market' })
    expect(screen.getByText('Sat Dec 12 · Holiday market')).toBeInTheDocument()
    fireEvent.click(button('Undo'))
    await waitFor(() => expect(posts(f, SETTINGS)).toHaveLength(2))
    expect(posts(f, SETTINGS)[1].body.cafeSpecialDays.map((d: any) => d.date)).toEqual(['2026-11-07'])
    expect(posts(f, SETTINGS)[1].body.expectedUpdatedAt).toBe('saved-1')

    fireEvent.click(await findButton('Remove Sat Nov 7'))
    expect(await screen.findByText('Removed Sat Nov 7. Usual hours that day.')).toBeInTheDocument()
    expect(posts(f, SETTINGS)[2].body.cafeSpecialDays).toEqual([])
  })

  it('Square refused: the settings are saved, the sheet says so and Try again rewrites', async () => {
    const f = server({ square: { status: 'failed', message: 'Square didn’t take the new café hours.' } })
    vi.stubGlobal('fetch', f)
    sheet(<HoursSheet />)
    const sat = await findGroup('Saturdays')
    fireEvent.change(within(sat).getByLabelText('Opens'), { target: { value: '10:00' } })
    fireEvent.click(button('Save café hours'))
    expect(await screen.findByText('Café hours saved. Square didn’t update.', undefined, { timeout: 3000 })).toBeInTheDocument()
    const panel = screen.getByText('Saved here. Square didn’t take the new café hours.').closest('.adm-panel') as HTMLElement
    fireEvent.click(within(panel).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(posts(f, SETTINGS).at(-1)!.body).toEqual({ action: 'square-retry' }), { timeout: 3000 })
    expect(await screen.findByText('Square has the new café hours.', undefined, { timeout: 3000 })).toBeInTheDocument()
  })

  it('the test site: saved, and Square is said to be skipped', async () => {
    vi.stubGlobal('fetch', server({ square: { status: 'skipped', message: 'Square café hours not updated on the test site.' } }))
    sheet(<HoursSheet />)
    const sat = await findGroup('Saturdays')
    fireEvent.change(within(sat).getByLabelText('Opens'), { target: { value: '10:00' } })
    fireEvent.click(button('Save café hours'))
    expect(await screen.findByText('Café hours saved. Square café hours not updated on the test site.')).toBeInTheDocument()
  })

  it('a stale save keeps the typing and says someone else changed them; the next save uses their updatedAt', async () => {
    const f = server({ stale: true })
    vi.stubGlobal('fetch', f)
    sheet(<HoursSheet />)
    const sat = await findGroup('Saturdays')
    fireEvent.change(within(sat).getByLabelText('Opens'), { target: { value: '10:00' } })
    fireEvent.click(button('Save café hours'))
    expect(await screen.findByText('Someone else changed these settings. Check them and save again.')).toBeInTheDocument()
    expect(within(group('Saturdays')).getByLabelText('Opens')).toHaveValue('10:00')
    fireEvent.click(button('Save café hours'))
    await screen.findByText('Café hours saved.')
    expect(posts(f, SETTINGS)[1].body.expectedUpdatedAt).toBe('other-1')
  })
})

describe('More › Closed days', () => {
  it('lists the closed days coming up, with the note; Add closed days sits in the footer', async () => {
    vi.stubGlobal('fetch', server())
    sheet(<ClosedDaysSheet />)
    expect(await screen.findByText('Halloween weekend')).toBeInTheDocument()
    expect(screen.getByText('Fri Oct 30 – Sun Nov 1')).toBeInTheDocument()
    expect(screen.getByText('2 coming up')).toBeInTheDocument()
    expect(screen.getByText('Nothing can be booked on closed days. Anything already booked stays booked, and we’ll tell you about it.')).toBeInTheDocument()
    expect(within(footer()).getByRole('button', { name: 'Add closed days' })).toBeInTheDocument()
  })

  it('From is needed; To before From is caught; nothing is sent', async () => {
    const f = server()
    vi.stubGlobal('fetch', f)
    sheet(<ClosedDaysSheet />)
    await screen.findByText('Halloween weekend')
    fireEvent.click(within(footer()).getByRole('button', { name: 'Add closed days' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Pick the first closed day.')
    expect(screen.getByLabelText('From')).toHaveAttribute('aria-invalid', 'true')
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2027-03-19' } })
    fireEvent.change(screen.getByLabelText('To (blank for one day)'), { target: { value: '2027-03-15' } })
    fireEvent.click(within(footer()).getByRole('button', { name: 'Add closed days' }))
    expect(screen.getByRole('alert')).toHaveTextContent('The last closed day can’t be before the first.')
    expect(posts(f, SETTINGS)).toHaveLength(0)
  })

  it('adds a closed day with a holiday look; what is booked then is listed and stays booked; Undo removes it', async () => {
    const booked = [{ closureId: 'clo_new2', name: 'a snow day', from: '2026-12-05', to: '2026-12-05', items: [
      { kind: 'party', id: 'bk_1', label: 'the Justice party', startIso: at('2026-12-05', '13:30'), endIso: at('2026-12-05', '16:00') },
    ] }]
    const f = server({ booked })
    vi.stubGlobal('fetch', f)
    const { dirty } = sheet(<ClosedDaysSheet />)
    await screen.findByText('Halloween weekend')
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-12-05' } })
    fireEvent.change(screen.getByLabelText('Why'), { target: { value: 'a snow day' } })
    fireEvent.change(screen.getByLabelText(/Holiday look/), { target: { value: 'christmas' } })
    expect(dirty()).toBe(true)
    fireEvent.click(within(footer()).getByRole('button', { name: 'Add closed days' }))
    expect(await screen.findByText('Closed Sat Dec 5. Heads up: 1 thing is booked then. Nothing was cancelled.')).toBeInTheDocument()
    expect(posts(f, SETTINGS)[0].body.closures.at(-1)).toEqual({ from: '2026-12-05', to: '2026-12-05', name: 'a snow day', holiday: 'christmas' })
    const panel = screen.getByText('Already booked on those days').closest('.adm-panel') as HTMLElement
    expect(within(panel).getByText('The Justice party · Sat Dec 5 · 1:30–4 PM')).toBeInTheDocument()
    expect(within(panel).getByText(/nothing was cancelled/)).toBeInTheDocument()
    await waitFor(() => expect(dirty()).toBe(false))
    fireEvent.click(button('Undo'))
    await waitFor(() => expect(posts(f, SETTINGS)).toHaveLength(2))
    expect(posts(f, SETTINGS)[1].body.closures.map((c: any) => c.name)).toEqual(['Halloween weekend', 'Thanksgiving'])
  })

  it('Remove asks in the sheet; Keep it closed sends nothing; Open these days removes it, with Undo putting it back', async () => {
    const f = server()
    vi.stubGlobal('fetch', f)
    sheet(<ClosedDaysSheet />)
    fireEvent.click(await findButton('Remove Thanksgiving'))
    const ask = group('Open Thu Nov 26 – Fri Nov 27 again?')
    fireEvent.click(within(ask).getByRole('button', { name: 'Keep it closed' }))
    expect(posts(f, SETTINGS)).toHaveLength(0)
    fireEvent.click(button('Remove Thanksgiving'))
    fireEvent.click(within(group('Open Thu Nov 26 – Fri Nov 27 again?')).getByRole('button', { name: 'Open these days' }))
    expect(await screen.findByText('Opened Thu Nov 26 – Fri Nov 27 again.')).toBeInTheDocument()
    expect(posts(f, SETTINGS)[0].body.closures.map((c: any) => c.name)).toEqual(['Halloween weekend'])
    fireEvent.click(button('Undo'))
    await waitFor(() => expect(posts(f, SETTINGS)).toHaveLength(2))
    expect(posts(f, SETTINGS)[1].body.closures.map((c: any) => c.name)).toEqual(['Halloween weekend', 'Thanksgiving'])
  })

  it('a failed save keeps the form and says so', async () => {
    vi.stubGlobal('fetch', server({ fail: true }))
    sheet(<ClosedDaysSheet />)
    await screen.findByText('Halloween weekend')
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-12-05' } })
    fireEvent.click(within(footer()).getByRole('button', { name: 'Add closed days' }))
    expect(await screen.findByText('Didn’t save. Try again.')).toBeInTheDocument()
    expect(screen.getByLabelText('From')).toHaveValue('2026-12-05')
  })

  it('a settings load failure shows Try again', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => refuse(503, { error: 'The studio settings couldn’t be reached. Try again.' })))
    sheet(<ClosedDaysSheet />)
    expect(await screen.findByText('The studio settings couldn’t be reached. Try again.')).toBeInTheDocument()
    expect(button('Try again')).toBeInTheDocument()
  })
})

describe('the studio days every /admin screen uses', () => {
  function Probe() {
    const { days } = useStudio()
    return <p>{days.closures.map((c) => c.name).join(', ')}</p>
  }
  it('are the saved ones once loaded (the config before)', async () => {
    vi.stubGlobal('fetch', server())
    renderSheet(<StudioProvider><Probe /></StudioProvider>)
    expect(screen.getByText(/Halloween weekend, Thanksgiving, the Christmas holidays/)).toBeInTheDocument()
    expect(await screen.findByText('Halloween weekend, Thanksgiving')).toBeInTheDocument()
  })
})
