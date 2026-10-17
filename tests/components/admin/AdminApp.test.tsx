import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import AdminApp from '@components/admin/AdminApp'

const app = (over: any = {}) => ({
  id: '2026-10-15-abcdef12', at: '2026-10-15T15:00:00Z', status: 'new', photos: 2,
  about: { name: 'Lou Maker', business: 'Lou Makes', email: 'lou@example.com', phone: '(256) 555-0100', city: 'Huntsville' },
  links: { instagram: '@loumakes', website: '', tiktok: '', etsy: '', video: '' },
  classIdea: { what: 'Linocut printing', takeHome: 'Three prints', audience: 'adults', dropOffOk: '', length: '2 hours', groupMin: '4', groupMax: '12', price: '$45', suppliesCost: '$10', needs: '' },
  experience: '', when: { days: 'Weekday evenings', howOften: 'monthly' }, ...over,
})
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
afterEach(() => vi.unstubAllGlobals())

const request = (over: any = {}) => ({
  id: '2026-10-17-abcdef12', at: '2026-10-17T15:00:00Z', status: 'new', photos: 1,
  event: { kind: 'team', kindOther: '', date: '2026-11-21', backupDate: '', flexible: true, startTime: '14:00', length: '2 hours', guests: 18, crafters: 'adults', youngest: '' },
  where: { place: 'yours', address: '100 Main St', setting: 'indoors', tables: 'yes', sink: 'no', setupFrom: '1 PM', access: '' },
  craft: { pick: 'custom', vision: 'Desk plants', theme: '', personalized: '', link: 'pinterest.com/pin/1' },
  extras: { food: 'studio', drinks: '', dessert: '', decor: '', tableware: '', favors: '' },
  allergies: '', budget: '1000-2500',
  about: { name: 'Dana Planner', email: 'dana@example.com', phone: '(256) 555-0142', org: 'Rocket Co', contactBy: 'text', heard: '' },
  notes: '', ...over,
})

/**
 * Answers by address: the two lists, sign-in, and the status moves. `lists`
 * starts signed out when `signedOut` is set, until a sign-in succeeds.
 */
const message = (over: any = {}) => ({ id: '2026-10-17-11111111', at: '2026-10-17T16:00:00Z', status: 'new', photos: 0, name: 'Sam Asker', email: 'sam@example.com', phone: '(256) 555-0177', topic: 'cafe', message: 'Are you open on Thanksgiving weekend?', ...over })

function server({ apps = [app()], requests = [request()], messages = [message()], signedOut = false, passcodeOk = true }: any = {}) {
  let out = signedOut
  return vi.fn(async (url: string, init?: any) => {
    if (url === '/api/admin/login.json') {
      if (!passcodeOk) return { ok: false, status: 401, json: async () => ({ error: 'That passcode isn’t right.' }) }
      out = false
      return ok({ data: { ok: true } })
    }
    if (out) return { ok: false, status: 401, json: async () => ({}) }
    if (url === '/api/admin/applications.json') {
      if (init?.method === 'POST') { const b = JSON.parse(init.body); return ok({ data: { application: { ...apps.find((a: any) => a.id === b.id), status: b.status } } }) }
      return ok({ data: { applications: apps } })
    }
    if (url === '/api/admin/event-requests.json') {
      if (init?.method === 'POST') { const b = JSON.parse(init.body); return ok({ data: { request: { ...requests.find((r: any) => r.id === b.id), status: b.status } } }) }
      return ok({ data: { requests } })
    }
    if (url === '/api/admin/messages.json') {
      if (init?.method === 'POST') { const b = JSON.parse(init.body); return ok({ data: { message: { ...messages.find((m: any) => m.id === b.id), status: b.status } } }) }
      return ok({ data: { messages } })
    }
    throw new Error(`unexpected ${url}`)
  })
}
const teachers = () => fireEvent.click(screen.getByRole('tab', { name: /^Teachers/ }))

describe('AdminApp (/admin)', () => {
  it('asks for the passcode when signed out, then opens on private events', async () => {
    const fetchMock = server({ signedOut: true })
    vi.stubGlobal('fetch', fetchMock)
    render(<AdminApp />)
    fireEvent.change(await screen.findByLabelText('Passcode'), { target: { value: 'owner-secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Dana Planner · Rocket Co')).toBeInTheDocument()
    expect(JSON.parse(fetchMock.mock.calls.find((c) => c[0] === '/api/admin/login.json')![1].body)).toEqual({ passcode: 'owner-secret' })
    expect(screen.getByRole('tab', { name: 'Private events (1 new)', selected: true })).toBeInTheDocument()
  })

  it('a private event request shows the headline, how to reach them, and the answers', async () => {
    vi.stubGlobal('fetch', server())
    render(<AdminApp />)
    expect(await screen.findByText('Team building · Sat Nov 21 at 2:00 PM · 18 guests · At your place')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'dana@example.com' })).toHaveAttribute('href', 'mailto:dana@example.com')
    expect(screen.getByText('Prefers text')).toBeInTheDocument()
    expect(screen.getByText('100 Main St')).toBeInTheDocument()
    expect(screen.getByText('Please provide')).toBeInTheDocument()
    expect(screen.getByText('$1,000 to $2,500')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'pinterest.com/pin/1' })).toHaveAttribute('href', 'https://pinterest.com/pin/1')
    expect(screen.getByAltText('Dana Planner, inspiration photo 1')).toHaveAttribute('src', '/api/admin/event-request-photo?id=2026-10-17-abcdef12&n=0')
  })

  it('moves a request along: New, Quoted, Booked, Not this time', async () => {
    const fetchMock = server()
    vi.stubGlobal('fetch', fetchMock)
    render(<AdminApp />)
    const group = await screen.findByRole('group', { name: 'Status for Dana Planner' })
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['New', 'Quoted', 'Booked', 'Not this time'])
    fireEvent.click(within(group).getByRole('button', { name: 'Quoted' }))
    expect(await within(group).findByRole('button', { name: 'Quoted', pressed: true })).toBeInTheDocument()
    const post = fetchMock.mock.calls.find((c) => c[0] === '/api/admin/event-requests.json' && c[1]?.method === 'POST')!
    expect(JSON.parse(post[1].body)).toEqual({ id: '2026-10-17-abcdef12', status: 'quoted' })
  })

  it('a wrong passcode says so', async () => {
    vi.stubGlobal('fetch', server({ signedOut: true, passcodeOk: false }))
    render(<AdminApp />)
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('That passcode isn’t right.')).toBeInTheDocument()
  })

  it('the Teachers tab shows the applications', async () => {
    vi.stubGlobal('fetch', server())
    render(<AdminApp />)
    await screen.findByText('Dana Planner · Rocket Co')
    teachers()
    expect(screen.getByText('Lou Maker · Lou Makes')).toBeInTheDocument()
    expect(screen.getByText('Linocut printing')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Instagram' })).toHaveAttribute('href', 'https://instagram.com/loumakes')
    expect(screen.getAllByAltText(/Lou Maker, photo/)).toHaveLength(2)
  })

  it('moves an application along and filters by status', async () => {
    const fetchMock = server({ apps: [app(), app({ id: '2026-10-14-00000000', about: { ...app().about, name: 'Bea' }, status: 'booked' })] })
    vi.stubGlobal('fetch', fetchMock)
    render(<AdminApp />)
    await screen.findByText('Dana Planner · Rocket Co')
    teachers()
    const group = screen.getByRole('group', { name: 'Status for Lou Maker' })
    fireEvent.click(within(group).getByRole('button', { name: 'Talking' }))
    expect(await within(group).findByRole('button', { name: 'Talking', pressed: true })).toBeInTheDocument()
    const post = fetchMock.mock.calls.find((c) => c[0] === '/api/admin/applications.json' && c[1]?.method === 'POST')!
    expect(JSON.parse(post[1].body)).toEqual({ id: '2026-10-15-abcdef12', status: 'talking' })
    fireEvent.click(screen.getByRole('button', { name: 'Booked (1)' }))
    expect(screen.queryByText(/Lou Maker/)).toBeNull()
    expect(screen.getByText('Bea · Lou Makes')).toBeInTheDocument()
  })

  it('empty lists say where things come from', async () => {
    vi.stubGlobal('fetch', server({ apps: [], requests: [], messages: [] }))
    render(<AdminApp />)
    expect(await screen.findByText(/ourhometownstudio.com\/private-events/)).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Private events' })).toBeInTheDocument()
    teachers()
    expect(screen.getByText(/ourhometownstudio.com\/teach/)).toBeInTheDocument()
  })

  it('the Messages tab shows each message and marks it Replied', async () => {
    const fetchMock = server()
    vi.stubGlobal('fetch', fetchMock)
    render(<AdminApp />)
    await screen.findByText('Dana Planner · Rocket Co')
    fireEvent.click(screen.getByRole('tab', { name: 'Messages (1 new)' }))
    expect(screen.getByText('Are you open on Thanksgiving weekend?')).toBeInTheDocument()
    expect(screen.getByText(/Craft Café/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'sam@example.com' })).toHaveAttribute('href', 'mailto:sam@example.com')
    const group = screen.getByRole('group', { name: 'Status for Sam Asker' })
    fireEvent.click(within(group).getByRole('button', { name: 'Replied' }))
    expect(await within(group).findByRole('button', { name: 'Replied', pressed: true })).toBeInTheDocument()
    expect(await screen.findByRole('tab', { name: 'Messages' })).toBeInTheDocument()
  })

  it('a list that fails to load offers to try again', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })))
    render(<AdminApp />)
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})
