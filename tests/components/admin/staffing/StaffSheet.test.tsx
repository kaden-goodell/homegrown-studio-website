import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import { renderSheet } from '../sheets/harness'
import { StaffSheet } from '@components/admin/sheets/StaffSheet'
import { setAdminWho } from '@components/admin/classes/api'
import { CONTACTS, bodies, dayIn, ok, person, refuse, row } from './fixtures'

const STAFFING = '/api/admin/staffing.json'
const FEED = '/api/admin/feed.json'
const PEOPLE = '/api/admin/staff-people.json'

const short = row({ event: { key: 'ses:a', title: 'Potholder Looms', openHref: '#class-cls_a' } })
const staffed = row({
  day: dayIn(4),
  event: { key: 'party:pty_1', kind: 'party', title: 'Party · 14 guests', openHref: `#party-${dayIn(4)}-pty_1` },
  people: [person('TM1', 'Kaden', { verdict: 'can', assigned: true }), person('TM2', 'Jessica', { verdict: 'cant', markNote: 'dentist', assigned: true }), person('TM3', 'Sam', { verdict: 'partly', hours: '4–9 PM' })],
})

let fetchMock: ReturnType<typeof vi.fn>
function server(o: { rows?: any[]; boardFails?: boolean; feed?: { has: boolean }; people?: any[] } = {}) {
  return vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = String(url).split('?')[0]
    const method = init.method ?? 'GET'
    if (path === STAFFING && method === 'GET') {
      if (o.boardFails) return refuse(503, { error: "We couldn't reach the staffing records. Try again." })
      return ok({ data: { rows: o.rows ?? [short, staffed], team: [], teamSource: 'local', contacts: CONTACTS } })
    }
    if (path === FEED && method === 'GET') return ok({ data: { mine: o.feed ?? { has: false }, people: [] } })
    if (path === FEED && method === 'POST') return ok({ data: { https: 'https://x.test/api/calendar/feed/T.ics', webcal: 'webcal://x.test/api/calendar/feed/T.ics' } })
    if (path === PEOPLE && method === 'GET') return ok({ data: { people: o.people ?? [], saved: true, startedFrom: 'square' } })
    if (path === STAFFING && method === 'POST') return ok({ data: { row: short } })
    throw new Error(`unexpected ${method} ${url}`)
  })
}

beforeEach(() => { setAdminWho('Catherine') })
afterEach(() => { vi.unstubAllGlobals(); setAdminWho('') })

describe('More › Staff › Who’s on', () => {
  it('lists To check, Needs someone (short or nobody only) and Everything, with words for who’s on', async () => {
    fetchMock = server()
    vi.stubGlobal('fetch', fetchMock)
    renderSheet(<StaffSheet />)
    expect(await screen.findByText('Needs someone (1)')).toBeInTheDocument()
    expect(screen.getByText('To check (1)')).toBeInTheDocument()
    expect(screen.getByText('Everything (2)')).toBeInTheDocument()
    // the party is staffed, so it isn't under Needs someone; it's under To check because Jessica said Can't
    const cards = screen.getAllByRole('button', { name: /Potholder Looms|Party · 14 guests/ })
    expect(cards.map((c) => c.querySelector('b')?.textContent)).toEqual(['Party · 14 guests', 'Potholder Looms', 'Potholder Looms', 'Party · 14 guests'])
    expect(screen.getAllByText('Kaden and Jessica on').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('group', { name: 'Check with Jessica' }).length).toBeGreaterThan(0)
    // This week starts now and runs a week
    const q = new URL(`https://x.test${fetchMock.mock.calls.find((c: any) => String(c[0]).startsWith(`${STAFFING}?from`))![0]}`).searchParams
    expect(Date.parse(q.get('to')!) - Date.parse(q.get('from')!)).toBeLessThanOrEqual(7 * 86_400_000)
  })

  it('Who can work: everyone × the days with something on, in words', async () => {
    vi.stubGlobal('fetch', server())
    renderSheet(<StaffSheet />)
    const table = await screen.findByRole('table')
    const rows = within(table).getAllByRole('row').slice(1)
    const jess = rows.find((r) => within(r).queryByRole('rowheader', { name: 'Jessica' }))!
    const cells = within(jess).getAllByRole('cell').map((c) => c.textContent)
    expect(cells).toEqual(['—', 'Can’tOn'])
    const sam = rows.find((r) => within(r).queryByRole('rowheader', { name: 'Sam' }))!
    expect(within(sam).getAllByRole('cell').map((c) => c.textContent)).toEqual(['—', 'Part'])
    expect(table).toHaveTextContent('— means they haven’t said.')
  })

  it('a card opens its Staff section in place (from what the board has), and Open the class hands the sheet the key', async () => {
    vi.stubGlobal('fetch', fetchMock = server())
    const { sheet } = renderSheet(<StaffSheet />)
    const need = await screen.findByText('Needs someone (1)')
    const card = need.nextElementSibling as HTMLElement
    fireEvent.click(within(card).getByRole('button', { name: /Potholder Looms/ }))
    expect(within(card).getByRole('list', { name: 'Who can work' })).toBeInTheDocument()
    // no second read for the row
    expect(fetchMock.mock.calls.filter((c: any) => String(c[0]).includes('key='))).toHaveLength(0)
    fireEvent.click(within(card).getByRole('button', { name: 'Open the class' }))
    expect(sheet.open).toHaveBeenCalledWith({ kind: 'class', id: 'cls_a' }, { staffKey: 'ses:a' })
  })

  it('Next week and Pick a week read other ranges', async () => {
    vi.stubGlobal('fetch', fetchMock = server({ rows: [] }))
    renderSheet(<StaffSheet />)
    expect(await screen.findByText('Nothing on this week.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))
    await screen.findByText('Nothing on this week.')
    fireEvent.click(screen.getByRole('button', { name: 'Pick a week' }))
    fireEvent.change(screen.getByLabelText('Week starting'), { target: { value: '2031-03-10' } })
    await vi.waitFor(() => expect(fetchMock.mock.calls.some((c: any) => String(c[0]).includes('from=2031-03-10'))).toBe(true))
  })

  it("a failed board read says so with Try again (never 'nobody needed')", async () => {
    vi.stubGlobal('fetch', server({ boardFails: true }))
    renderSheet(<StaffSheet />)
    expect(await screen.findByText("We couldn't reach the staffing records. Try again.")).toBeInTheDocument()
    expect(screen.queryByText(/Needs someone/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})

describe('Calendar link for my phone (owner)', () => {
  it('uses the owner link and owner words, with X-Admin-Who', async () => {
    vi.stubGlobal('fetch', fetchMock = server())
    renderSheet(<StaffSheet />)
    fireEvent.click(await screen.findByRole('button', { name: 'Calendar link for my phone' }))
    const dialog = screen.getByRole('dialog', { name: 'The studio on my phone' })
    expect(dialog).toHaveTextContent('every class, party, closed day and blocked time')
    expect(dialog).not.toHaveTextContent('Catherine or Kaden put you on')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Get my calendar link' }))
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Show my link' }))
    expect(within(dialog).getByRole('link', { name: 'Add to my iPhone calendar' })).toHaveAttribute('href', 'webcal://x.test/api/calendar/feed/T.ics')
    expect(dialog).toHaveTextContent('Google Calendar app › Settings › Hometown Studio, and turn on Sync')
    expect(bodies(fetchMock, FEED)[0].headers['X-Admin-Who']).toBe('Catherine')
  })
})
