import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import ClassesTab from '@components/admin/ClassesTab'
import { localToUtcISO } from '@lib/party-slots'

const at = (d: string, t: string) => localToUtcISO(d, t)
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
const c = (id: string, name: string, status: string, day: string, extra: any = {}) => ({
  id, content: { name, passes: [{ id: 'p', label: 'Full', covers: { kind: 'all' } }], ticketTypes: [{ id: 'person', label: 'Person' }], prices: { p: { person: 3000 } } },
  status, updatedAt: 'x', libraryId: null,
  sessions: [{ id: `ses_${id}`, startIso: at(day, '18:00'), endIso: at(day, '20:00'), capacity: 12 }], ...extra,
})
const classes = [
  c('cls_a', 'Pottery', 'open', '2026-10-22'),
  c('cls_b', 'Candles', 'draft', '2026-10-30'),
  c('cls_c', 'Watercolor', 'open', '2026-10-10'),
  c('cls_d', 'Macramé', 'cancelled', '2026-10-24'),
  c('cls_e', 'Wreaths', 'closed', '2026-10-22', { sessions: [
    { id: 'ses_e1', startIso: at('2026-10-22', '13:00'), endIso: at('2026-10-22', '15:00'), capacity: 8 },
    { id: 'ses_e2', startIso: at('2026-10-29', '13:00'), endIso: at('2026-10-29', '15:00'), capacity: 8 },
  ] }),
  c('cls_f', 'Old Pottery', 'open', '2026-10-03'),
]
const libList = [
  { id: 'lib_1', archived: false, versions: [{ version: 1, at: '', by: { id: 'k', name: 'K' }, note: '', content: { name: 'Pottery', imageUrl: 'https://x.test/p.jpg', passes: [{ id: 'p', label: 'Full', covers: { kind: 'all' } }], ticketTypes: [{ id: 'person', label: 'Person' }], prices: { p: { person: 3500 } } } }] },
]
function server() {
  return vi.fn(async (url: string) => {
    const path = url.split('?')[0]
    if (path === '/api/admin/classes/classes.json') {
      return ok({ data: { classes, seatsTaken: { ses_cls_a: 5, ses_e1: 8 }, totals: { cls_c: { bookings: 3, seats: 5, cents: 19000 }, cls_f: { bookings: 1, seats: 1, cents: 3000 } } } })
    }
    if (path === '/api/admin/classes/calendar.json') return ok({ data: { items: [] } })
    if (path === '/api/admin/classes/library.json') return ok({ data: { library: url.includes('archived=1') ? [...libList, { ...libList[0], id: 'lib_2', archived: true }] : libList, runs: { lib_1: { lastIso: at('2026-10-10', '18:00'), nextIso: null, startIso: at('2026-10-10', '18:00'), endIso: at('2026-10-10', '20:00') } } } })
    if (path.includes('seed-sandbox')) throw new Error('the Classes tab never asks about the sandbox')
    throw new Error(`unexpected ${url}`)
  })
}
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-19T15:00:00Z')) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('Classes tab', () => {
  it('Upcoming: grouped by day, "N of M booked", sign-ups closed tagged; cancelled folded away at the end; tapping opens the class sheet', async () => {
    vi.stubGlobal('fetch', server())
    const onOpen = vi.fn()
    render(<ClassesTab onOpen={onOpen} />)
    const thu = await screen.findByRole('region', { name: 'Thu Oct 22' })
    const rows = within(thu).getAllByRole('button')
    expect(rows.map((r) => r.querySelector('b')!.textContent)).toEqual(['Wreaths', 'Pottery'])
    expect(rows[1]).toHaveTextContent('5 of 12 booked')
    expect(rows[0]).toHaveTextContent('8 of 8 booked · 2 dates')
    expect(rows[0]).toHaveTextContent('Sign-ups closed')
    expect(screen.queryByText('Candles')).toBeNull()
    const folded = screen.getByText('Cancelled (1)').closest('details')!
    expect(folded.querySelector('summary .adm-chevron')).not.toBeNull()
    expect(folded).not.toHaveAttribute('open')
    expect(within(folded).getByRole('button', { name: /Macramé/ })).toHaveTextContent('Cancelled')
    fireEvent.click(rows[1])
    expect(onOpen).toHaveBeenCalledWith({ kind: 'class', id: 'cls_a' })
  })

  it('Drafts: the note, and each draft with its day and price', async () => {
    vi.stubGlobal('fetch', server())
    render(<ClassesTab onOpen={() => {}} />)
    await screen.findByRole('region', { name: 'Thu Oct 22' })
    fireEvent.click(screen.getByRole('button', { name: 'Drafts' }))
    expect(screen.getByText('Drafts are saved but not on the website yet.')).toBeInTheDocument()
    // The segment already says Draft: no tag on each row (Q14).
    expect(screen.getByRole('button', { name: /Candles/ }).querySelector('small')!.textContent).toBe('Fri Oct 30 · $30')
  })

  it('Past: newest first, "N bookings · N seats · $X", and what tapping one is for', async () => {
    vi.stubGlobal('fetch', server())
    render(<ClassesTab onOpen={() => {}} />)
    await screen.findByRole('region', { name: 'Thu Oct 22' })
    fireEvent.click(screen.getByRole('button', { name: 'Past' }))
    const names = screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'))
    expect(names).toEqual(['Sat Oct 10', 'Sat Oct 3'])
    expect(screen.getByRole('button', { name: /Watercolor/ })).toHaveTextContent('3 bookings · 5 seats · $190')
    expect(screen.getByRole('button', { name: /Old Pottery/ })).toHaveTextContent('1 booking · 1 seat · $30')
    expect(screen.getByText('Tap a past class to see who came or refund someone.')).toBeInTheDocument()
  })

  it('Library: the note and a photo tile per class, "Last ran <date> · $price"; a tile opens its sheet; archived ones on request', async () => {
    vi.stubGlobal('fetch', server())
    const onOpen = vi.fn()
    render(<ClassesTab onOpen={onOpen} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Library' }))
    expect(screen.getByText('Every class you add lands here on its own. Tap one to run it again.')).toBeInTheDocument()
    const tile = await screen.findByRole('button', { name: /Pottery/ })
    expect(tile).toHaveTextContent('Last ran Oct 10 · $35')
    expect(tile.querySelector('img')).toHaveAttribute('src', 'https://x.test/p.jpg')
    fireEvent.click(tile)
    expect(onOpen).toHaveBeenCalledWith({ kind: 'lib', id: 'lib_1' }, expect.objectContaining({ id: 'lib_1' }))
    expect(screen.queryByText('Archived')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show archived' }))
    expect(await screen.findByText('Archived')).toBeInTheDocument()
  })

  it('+ New class sits in the header', async () => {
    vi.stubGlobal('fetch', server())
    const onOpen = vi.fn()
    render(<ClassesTab onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: '+ New class' }))
    expect(onOpen).toHaveBeenCalledWith({ kind: 'new' })
    await screen.findByRole('region', { name: 'Thu Oct 22' })
  })
})

describe('Classes tab, fix round 1', () => {
  it('Q14: Past says what tapping is for above the list; M1: the segment is remembered for a refresh', async () => {
    vi.stubGlobal('fetch', server())
    const { unmount } = render(<ClassesTab onOpen={() => {}} />)
    await screen.findByRole('region', { name: 'Thu Oct 22' })
    fireEvent.click(screen.getByRole('button', { name: 'Past' }))
    const note = screen.getByText('Tap a past class to see who came or refund someone.')
    expect(note.compareDocumentPosition(screen.getAllByRole('region')[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    unmount()
    render(<ClassesTab onOpen={() => {}} />)
    expect(screen.getByRole('button', { name: 'Past' })).toHaveAttribute('aria-pressed', 'true')
    await screen.findByRole('region', { name: 'Sat Oct 10' })
  })

  it('Q15: a library class with no photo shows the camera glyph; the most recently run come first', async () => {
    const noPhoto = { ...libList[0], id: 'lib_9', versions: [{ ...libList[0].versions[0], content: { ...libList[0].versions[0].content, name: 'Zebra', imageUrl: null } }] }
    const f = vi.fn(async (url: string) => (url.startsWith('/api/admin/classes/library.json')
      ? ok({ data: { library: [...libList, noPhoto], runs: { lib_1: { lastIso: at('2026-09-01', '18:00'), nextIso: null, startIso: '', endIso: '' }, lib_9: { lastIso: at('2026-10-10', '18:00'), nextIso: null, startIso: '', endIso: '' } } } })
      : server()(url)))
    vi.stubGlobal('fetch', f)
    render(<ClassesTab onOpen={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Library' }))
    await screen.findByRole('button', { name: /Zebra/ })
    const tiles = [...document.querySelectorAll('.adm-tile')]
    expect(tiles.map((t) => t.querySelector('b')!.textContent)).toEqual(['Zebra', 'Pottery'])
    expect(tiles[0].querySelector('.adm-nophoto')).not.toBeNull()
  })
})

describe('Classes tab, fix round 2', () => {
  it('QN4: the library goes by when each last ran, newest first; ones only coming up next; "Not run yet" last', async () => {
    const mk = (id: string, name: string, at2: string) => ({ ...libList[0], id, versions: [{ ...libList[0].versions[0], at: at2, content: { ...libList[0].versions[0].content, name } }] })
    const f = vi.fn(async (url: string) => (url.startsWith('/api/admin/classes/library.json')
      ? ok({ data: { library: [mk('l_new', 'Never Run', '2026-10-19T10:00:00Z'), mk('l_old', 'Ran Long Ago', '2026-01-01T00:00:00Z'), mk('l_soon', 'Coming Up', '2026-10-18T00:00:00Z'), mk('l_recent', 'Ran Lately', '2026-02-01T00:00:00Z')],
        runs: { l_old: { lastIso: at('2026-05-01', '18:00'), nextIso: null, startIso: '', endIso: '' }, l_recent: { lastIso: at('2026-10-10', '18:00'), nextIso: null, startIso: '', endIso: '' }, l_soon: { lastIso: null, nextIso: at('2026-11-05', '18:00'), startIso: '', endIso: '' } } } })
      : server()(url)))
    vi.stubGlobal('fetch', f)
    render(<ClassesTab onOpen={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Library' }))
    await screen.findByRole('button', { name: /Never Run/ })
    expect([...document.querySelectorAll('.adm-tile b')].map((b) => b.textContent)).toEqual(['Ran Lately', 'Ran Long Ago', 'Coming Up', 'Never Run'])
  })
})

