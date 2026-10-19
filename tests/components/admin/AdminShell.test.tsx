import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor, act } from '@testing-library/react'
import AdminShell from '@components/admin/AdminShell'
import { localToUtcISO } from '@lib/party-slots'

// Monday 19 Oct 2026, 10 AM in Alabama. Only Date is faked, so findBy and toasts still run.
const NOW = new Date('2026-10-19T15:00:00Z')
const TODAY = '2026-10-19'
const at = (day: string, hhmm: string) => localToUtcISO(day, hhmm)

const app = (over: any = {}) => ({
  id: '2026-10-15-abcdef12', at: '2026-10-15T15:00:00Z', status: 'new', photos: 2,
  about: { name: 'Lou Maker', business: 'Lou Makes', email: 'lou@example.com', phone: '(256) 555-0100', city: 'Huntsville' },
  links: { instagram: '@loumakes', website: '', tiktok: '', etsy: '', video: '' },
  classIdea: { what: 'Linocut printing', takeHome: 'Three prints', audience: 'adults', dropOffOk: '', length: '2 hours', groupMin: '4', groupMax: '12', price: '$45', suppliesCost: '$10', needs: '' },
  experience: '', when: { days: 'Weekday evenings', howOften: 'monthly' }, ...over,
})
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
const message = (over: any = {}) => ({ id: '2026-10-17-11111111', at: '2026-10-17T16:00:00Z', status: 'new', photos: 0, name: 'Sam Asker', email: 'sam@example.com', phone: '(256) 555-0177', topic: 'cafe', message: 'Are you open on Thanksgiving weekend?', ...over })

const sched = {
  id: 'cls_a', libraryId: null, libraryVersion: null, status: 'open', updatedAt: 'u1', createdAt: '', by: { id: 'admin', name: 'Owner' }, history: [],
  square: { itemId: null, variations: {} },
  content: {
    name: 'Pottery', description: '', imageUrl: null, instructor: null,
    rules: { ages: '', dropOff: false, madeToOrder: false, taxable: true, maxPerBooking: 10, signupCutoffHours: null, minimumToRun: null, linkOnly: false, joinPartway: true, waitlistCutoffHours: 2, canShareRoom: false },
    ticketTypes: [{ id: 'person', label: 'Person' }], passes: [{ id: 'all', label: 'Full class', covers: { kind: 'all' } }],
    prices: { all: { person: 3000 } }, questions: [], addOns: [], defaultCapacity: 10, defaultMinutes: 90,
  },
  sessions: [{ id: 'ses_a', startIso: at('2026-10-22', '18:00'), endIso: at('2026-10-22', '20:00'), capacity: 12 }],
}
const calendar = [
  { kind: 'class', id: 'cls_a', sessionId: 'ses_a', label: 'Pottery', startIso: at('2026-10-22', '18:00'), endIso: at('2026-10-22', '20:00'), status: 'open', booked: 5, capacity: 12 },
  { kind: 'party', id: 'bk_9', label: 'the Justice party', startIso: at('2026-10-24', '13:30'), endIso: at('2026-10-24', '15:00'), guests: 14 },
  { kind: 'blocked', id: 'blk_1', label: 'Deep clean', startIso: at('2026-10-23', '09:00'), endIso: at('2026-10-23', '12:00') },
  { kind: 'class', id: 'cls_d', sessionId: 'ses_d', label: 'Draft Candles', startIso: at(TODAY, '18:00'), endIso: at(TODAY, '19:30'), status: 'draft', booked: 0, capacity: 8 },
]
const party = {
  bookingId: 'bk_9', hostName: 'Stefanie Justice', hostEmail: 'stef@example.com', hostPhone: '(256) 555-0199', guestCount: 14,
  craftName: 'Beaded Necklace', title: null, startIso: at('2026-10-24', '13:30'), durationMinutes: 90, themeName: null, createdAt: '2026-10-02T00:00:00Z',
}

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
const status = (code: number, body: unknown = {}) => ({ ok: false, status: code, json: async () => body })

/** The admin routes, by address. `fail` makes one path answer 500; `signedOut` starts at 401 until a sign-in works. */
function server(o: any = {}) {
  const { apps = [app()], requests = [request()], messages = [message()], items = calendar, signedOut = false, passcodeOk = true, sandbox = false, fail = [] as string[], postFails = [] as string[] } = o
  let out = signedOut
  const fn = vi.fn(async (url: string, init?: any) => {
    const path = url.split('?')[0]
    if (path === '/api/admin/login.json') {
      if (init?.method === 'DELETE') { out = true; return ok({ data: { ok: true } }) }
      if (!passcodeOk) return status(401, { error: 'That passcode isn’t right.' })
      out = false
      return ok({ data: { ok: true } })
    }
    if (out) return status(401, { error: 'Sign in first.' })
    if (fail.includes(path)) return status(500, { error: 'That list couldn’t be loaded.' })
    const post = init?.method === 'POST' ? JSON.parse(init.body) : null
    if (post && postFails.includes(path)) return status(503, { error: 'down' })
    switch (path) {
      case '/api/admin/applications.json': return post ? ok({ data: { application: { ...apps.find((a: any) => a.id === post.id), status: post.status } } }) : ok({ data: { applications: apps } })
      case '/api/admin/event-requests.json': return post ? ok({ data: { request: { ...requests.find((r: any) => r.id === post.id), status: post.status } } }) : ok({ data: { requests } })
      case '/api/admin/messages.json': return post ? ok({ data: { message: { ...messages.find((m: any) => m.id === post.id), status: post.status } } }) : ok({ data: { messages } })
      case '/api/admin/to-decide.json': return ok({ data: { items: [] } })
      case '/api/admin/classes/calendar.json': return ok({ data: { items } })
      case '/api/admin/classes/classes.json': return ok({ data: { classes: [sched], seatsTaken: {} } })
      case '/api/admin/classes/bookings.json': return ok({ data: { class: sched, bookings: [] } })
      case '/api/admin/classes/library.json': return ok({ data: { library: [] } })
      case '/api/admin/classes/blocked.json':
        if (post?.action === 'remove') return ok({ data: { removed: post.id } })
        if (post?.action === 'add') return ok({ data: { blocked: { id: 'blk_new', startIso: post.startIso, endIso: post.endIso, reason: post.reason, by: { id: 'x', name: 'x' }, at: '' }, clashes: [] } })
        return ok({ data: { blocked: [] } })
      case '/api/admin/classes/day.json': return ok({ data: { day: TODAY, classes: [], events: [], other: [] } })
      case '/api/admin/classes/seed-sandbox.json':
        if (post) return ok({ data: { classesCategoryId: 'CAT1', classTaxId: 'TAX1', commands: ['npx netlify env:set A CAT1', 'npx netlify env:set B TAX1'] } })
        return ok({ data: { sandbox } })
      case '/api/admin/party.json': return ok({ data: { party, guests: [{ name: 'Ann Guest', kids: 2, coming: 3, waiver: 'current' }] } })
      case '/api/admin/reports.json': return ok({ data: { month: '2026-10', seatsSold: 74, classSalesCents: 196800, refunds: 1, refundedCents: 1635, partiesBooked: 3 } })
      case '/api/party/service-info.json': return ok({ data: { crafts: [{ id: 'c1', name: 'Beaded Necklace', perHeadCents: 1800, perHeadMaxCents: 1800 }] } })
    }
    throw new Error(`unexpected ${url}`)
  })
  return fn
}
const posts = (f: any, path: string) => f.mock.calls.filter((c: any) => c[0].split('?')[0] === path && c[1]?.method === 'POST').map((c: any) => JSON.parse(c[1].body))
const tab = (name: string) => fireEvent.click(within(screen.getByRole('navigation', { name: 'Admin sections' })).getByRole('button', { name: new RegExp(`^${name}`) }))
const dialog = () => screen.getByRole('dialog')

async function signedIn(f = server()) {
  vi.stubGlobal('fetch', f)
  render(<AdminShell />)
  await screen.findByRole('navigation', { name: 'Admin sections' })
  return f
}

/** This Node's own localStorage isn't usable under jsdom; a plain one in its place. */
function memoryStorage() {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, String(v)) }, removeItem: (k: string) => { m.delete(k) }, clear: () => m.clear() }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.stubGlobal('localStorage', memoryStorage())
  localStorage.setItem('admin-who', 'Catherine')
  window.history.replaceState(null, '', '/admin')
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('sign in', () => {
  it('asks for the passcode and who is using it, says Signing in…, then opens on Home', async () => {
    localStorage.clear()
    let release!: () => void
    const base = server({ signedOut: true })
    const f = vi.fn(async (url: string, init?: any) => {
      if (url === '/api/admin/login.json') await new Promise<void>((r) => { release = r })
      return base(url, init)
    })
    vi.stubGlobal('fetch', f)
    render(<AdminShell />)
    const code = await screen.findByLabelText('Passcode')
    expect(code).toHaveAttribute('type', 'password')
    fireEvent.click(screen.getByRole('button', { name: 'Show' }))
    expect(code).toHaveAttribute('type', 'text')
    fireEvent.change(code, { target: { value: 'owner-secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Pick who’s using this.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Kaden' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    const busy = await screen.findByRole('button', { name: 'Signing in…' })
    expect(busy).toBeDisabled()
    fireEvent.click(busy)
    await act(async () => release())
    expect(await screen.findByRole('heading', { name: 'Good morning, Kaden' })).toBeInTheDocument()
    expect(f.mock.calls.filter((c) => c[0] === '/api/admin/login.json')).toHaveLength(1)
    expect(JSON.parse(f.mock.calls.find((c) => c[0] === '/api/admin/login.json')![1].body)).toEqual({ passcode: 'owner-secret' })
    expect(localStorage.getItem('admin-who')).toBe('Kaden')
    expect(window.location.hash).toBe('#home')
  })

  it('a wrong passcode says so', async () => {
    const f = server({ signedOut: true, passcodeOk: false })
    vi.stubGlobal('fetch', f)
    render(<AdminShell />)
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Type the passcode.')).toBeInTheDocument()
    expect(f.mock.calls.some((c) => c[0] === '/api/admin/login.json')).toBe(false)
    fireEvent.change(screen.getByLabelText('Passcode'), { target: { value: 'nope' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('That passcode isn’t right.')).toBeInTheDocument()
  })

  it('signed in already but nobody picked yet: asks who once', async () => {
    localStorage.clear()
    vi.stubGlobal('fetch', server())
    render(<AdminShell />)
    fireEvent.click(await screen.findByRole('button', { name: 'Catherine' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByRole('heading', { name: 'Good morning, Catherine' })).toBeInTheDocument()
  })

  it('a 401 from anything, later, goes back to sign-in', async () => {
    let n = 0
    const base = server()
    await signedIn(vi.fn(async (url: string, init?: any) => (url.startsWith('/api/admin/classes/calendar.json') && ++n > 1 ? status(401) : base(url, init))))
    tab('Calendar')
    expect(await screen.findByLabelText('Passcode')).toBeInTheDocument()
  })

  it('every request says who is using it (X-Admin-Who)', async () => {
    const f = await signedIn()
    await screen.findByText('Draft Candles')
    const cal = f.mock.calls.find((c) => c[0].startsWith('/api/admin/classes/calendar.json'))!
    expect(cal[1].headers).toMatchObject({ 'X-Admin-Who': 'Catherine' })
    tab('Inbox')
    fireEvent.click(await screen.findByRole('button', { name: /Dana Planner/ }))
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Quoted' }))
    await waitFor(() => expect(posts(f, '/api/admin/event-requests.json')).toHaveLength(1))
    const post = f.mock.calls.find((c) => c[1]?.method === 'POST')!
    expect(post[1].headers).toMatchObject({ 'X-Admin-Who': 'Catherine', 'Content-Type': 'application/json' })
  })
})

describe('tabs and the address bar', () => {
  it('five tabs; switching marks the current one and writes the hash', async () => {
    await signedIn()
    const nav = screen.getByRole('navigation', { name: 'Admin sections' })
    expect(within(nav).getAllByRole('button').map((b) => b.textContent?.replace(/\d+, \d+ waiting$/, ''))).toEqual(['Home', 'Calendar', 'Classes', 'Inbox', 'More'])
    expect(within(nav).getByRole('button', { name: /^Home/ })).toHaveAttribute('aria-current', 'page')
    tab('More')
    expect(await screen.findByRole('heading', { name: 'More' })).toBeInTheDocument()
    expect(within(nav).getByRole('button', { name: /^More/ })).toHaveAttribute('aria-current', 'page')
    expect(window.location.hash).toBe('#more')
  })

  it('the Inbox tab carries a count of what is waiting', async () => {
    await signedIn()
    expect(await screen.findByRole('button', { name: 'Inbox, 3 waiting' })).toBeInTheDocument()
  })

  it('a refresh puts back the tab', async () => {
    window.history.replaceState(null, '', '/admin#calendar')
    await signedIn()
    expect(await screen.findByRole('heading', { name: 'Calendar' })).toBeInTheDocument()
  })

  it('a refresh on a sheet puts back the sheet over its tab, and Back closes it and stays in /admin', async () => {
    window.history.replaceState({ admTab: 'calendar' }, '', '/admin#more-hours')
    await signedIn()
    expect(await screen.findByRole('dialog', { name: 'Hours & Craft Café' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Calendar' })).toBeInTheDocument()
    act(() => window.history.back())
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(window.location.pathname).toBe('/admin')
    expect(window.location.hash).toBe('#calendar')
  })

  it('an address naming only a sheet opens it over the tab it belongs to', async () => {
    window.history.replaceState(null, '', '/admin#message-2026-10-17-11111111')
    await signedIn()
    expect(await screen.findByRole('dialog', { name: 'Sam Asker' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Inbox' })).toBeInTheDocument()
  })
})

describe('sheets', () => {
  it('one at a time: opening from inside a sheet replaces it, and the hash follows', async () => {
    await signedIn()
    tab('Calendar')
    fireEvent.click(await screen.findByRole('button', { name: 'Add on Thu Oct 22' }))
    expect(dialog()).toHaveAccessibleName('Thu Oct 22')
    expect(window.location.hash).toBe('#day-2026-10-22')
    fireEvent.click(await within(dialog()).findByRole('button', { name: /Pottery/ }))
    await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(1))
    expect(window.location.hash).toBe('#class-cls_a')
    expect(await within(dialog()).findByRole('button', { name: 'Edit class' })).toBeInTheDocument()
  })

  it('× and Escape close; focus goes back to what opened it; the page behind is inert on a phone', async () => {
    await signedIn()
    const opener = await screen.findByRole('button', { name: 'Block time' })
    opener.focus()
    fireEvent.click(opener)
    expect(dialog()).toHaveAccessibleName('Block time')
    expect(within(dialog()).getByRole('button', { name: 'Close' })).toHaveFocus()
    expect(document.querySelector('main')).toHaveAttribute('inert')
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(opener).toHaveFocus()
    expect(document.querySelector('main')).not.toHaveAttribute('inert')
    fireEvent.click(opener)
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('unsaved changes ask "Leave without saving?" on ×, Escape, another sheet or another tab', async () => {
    await signedIn()
    fireEvent.click(await screen.findByRole('button', { name: '+ New class' }))
    fireEvent.change(within(dialog()).getByLabelText('Name'), { target: { value: 'Macramé' } })
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Close' }))
    const ask = within(dialog()).getByRole('group', { name: 'Leave without saving?' })
    expect(within(ask).getByRole('button', { name: 'Keep editing' })).toHaveFocus()
    fireEvent.click(within(ask).getByRole('button', { name: 'Keep editing' }))
    expect(within(dialog()).getByLabelText('Name')).toHaveValue('Macramé')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(within(dialog()).getByRole('group', { name: 'Leave without saving?' })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(within(dialog()).queryByRole('group', { name: 'Leave without saving?' })).toBeNull()
    tab('More')
    expect(screen.getByRole('heading', { name: /Good morning/ })).toBeInTheDocument()
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Leave' }))
    expect(await screen.findByRole('heading', { name: 'More' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.body.textContent).not.toMatch(/Leave without saving/)
  })

  it('a form with nothing typed closes without asking', async () => {
    await signedIn()
    fireEvent.click(await screen.findByRole('button', { name: '+ New class' }))
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('Back with unsaved changes asks first and keeps the sheet', async () => {
    await signedIn()
    fireEvent.click(await screen.findByRole('button', { name: '+ New class' }))
    fireEvent.change(within(dialog()).getByLabelText('Name'), { target: { value: 'Macramé' } })
    act(() => window.history.back())
    expect(await within(dialog()).findByRole('group', { name: 'Leave without saving?' })).toBeInTheDocument()
    expect(within(dialog()).getByLabelText('Name')).toHaveValue('Macramé')
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Leave' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(window.location.hash).toBe('#home'))
  })
})

describe('Home', () => {
  it('greets by the studio clock, lists today and only the days this week with something, and counts what needs you', async () => {
    await signedIn()
    expect(screen.getByRole('heading', { name: 'Good morning, Catherine' })).toBeInTheDocument()
    expect(screen.getByText('Monday, October 19')).toBeInTheDocument()
    const today = await screen.findByRole('button', { name: /Draft Candles/ })
    expect(today).toHaveTextContent('0 of 8 booked')
    expect(today).toHaveTextContent('Draft')
    expect(screen.getByRole('region', { name: 'Thu Oct 22' })).toHaveTextContent('5 of 12 booked')
    expect(screen.getByRole('region', { name: 'Sat Oct 24' })).toHaveTextContent('14 guests')
    expect(screen.queryByRole('region', { name: 'Tue Oct 20' })).toBeNull()
    expect(await screen.findByRole('button', { name: 'Requests: 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Messages: 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Teachers: 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'To decide: 0' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Messages: 1' }))
    expect(await screen.findByRole('heading', { name: 'Inbox' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Messages 1' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('a closed day says so; the buttons open their sheets', async () => {
    vi.setSystemTime(new Date('2026-10-30T15:00:00Z'))
    await signedIn(server({ items: [] }))
    expect(await screen.findByText('The studio is closed today. Closed for Halloween weekend.')).toBeInTheDocument()
    // Nothing to print on a closed day with nothing on.
    expect(screen.queryByRole('button', { name: 'Print today' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '+ Book a party' }))
    expect(within(dialog()).getByRole('link', { name: 'Open the party booking page' })).toHaveAttribute('href', '/book')
  })
})

describe('Calendar sheets', () => {
  it('a day sheet adds on that day: New class, Book a party (with the date), Block time, Print', async () => {
    await signedIn()
    tab('Calendar')
    fireEvent.click(await screen.findByRole('button', { name: 'Add on Sat Oct 24' }))
    fireEvent.click(within(dialog()).getByRole('button', { name: '+ Book a party on this day' }))
    expect(within(dialog()).getByRole('link', { name: 'Open the party booking page' })).toHaveAttribute('href', '/book?date=2026-10-24')
    expect(within(dialog()).getByRole('link', { name: 'Open the party booking page' })).toHaveAttribute('target', '_blank')
  })

  it('a party opens read only: Details, Guests, Payments, and Call and Text with the number showing', async () => {
    await signedIn()
    tab('Calendar')
    fireEvent.click(await screen.findByRole('button', { name: /The Justice party/ }))
    const sheet = dialog()
    expect(await within(sheet).findByText('Stefanie Justice')).toBeInTheDocument()
    expect(within(sheet).getByText('Beaded Necklace')).toBeInTheDocument()
    expect(within(sheet).getByRole('link', { name: 'Call' })).toHaveAttribute('href', 'tel:2565550199')
    expect(within(sheet).getByRole('link', { name: 'Text' })).toHaveAttribute('href', 'sms:2565550199')
    // The number shows under the buttons as plain text you can select.
    expect(within(sheet).getAllByText('(256) 555-0199', { selector: '.adm-addr' })).toHaveLength(2)
    fireEvent.click(within(sheet).getByRole('button', { name: 'Guests' }))
    expect(within(sheet).getByText('Ann Guest')).toBeInTheDocument()
    expect(within(sheet).getByText('Waiver signed')).toBeInTheDocument()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Payments' }))
    expect(within(sheet).getByText('$300')).toBeInTheDocument()
    expect(within(sheet).queryByRole('button', { name: /Cancel|Move/ })).toBeNull()
  })

  it('blocked time: Remove asks in the sheet, then a toast can undo it', async () => {
    const f = await signedIn()
    tab('Calendar')
    fireEvent.click(await screen.findByRole('button', { name: /Deep clean/ }))
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Remove this block' }))
    expect(posts(f, '/api/admin/classes/blocked.json')).toHaveLength(0)
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Remove' }))
    expect(await screen.findByText('Block removed.')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(posts(f, '/api/admin/classes/blocked.json')).toEqual([{ action: 'remove', id: 'blk_1' }])
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(posts(f, '/api/admin/classes/blocked.json')).toHaveLength(2))
    expect(posts(f, '/api/admin/classes/blocked.json')[1]).toMatchObject({ action: 'add', reason: 'Deep clean', confirm: true })
  })
})

describe('Inbox', () => {
  it('rows fold to a headline, a status and what to do next; the sheet has every answer, Call and Email', async () => {
    await signedIn()
    tab('Inbox')
    const row = await screen.findByRole('button', { name: /Dana Planner · Rocket Co/ })
    expect(row).toHaveTextContent('Private event · Team building · Sat Nov 21 · 2 PM · 18 guests')
    expect(row).toHaveTextContent('Next: Reply with dates and a quote')
    fireEvent.click(row)
    const sheet = dialog()
    expect(within(sheet).getByText('100 Main St')).toBeInTheDocument()
    expect(within(sheet).getByText('Please provide')).toBeInTheDocument()
    expect(within(sheet).getByText('$1,000 to $2,500')).toBeInTheDocument()
    expect(within(sheet).getByText('Text')).toBeInTheDocument()
    expect(within(sheet).getByRole('link', { name: 'pinterest.com/pin/1' })).toHaveAttribute('href', 'https://pinterest.com/pin/1')
    expect(within(sheet).getByAltText('Dana Planner, inspiration photo 1')).toHaveAttribute('src', '/api/admin/event-request-photo?id=2026-10-17-abcdef12&n=0')
    expect(within(sheet).getByRole('link', { name: 'Email' })).toHaveAttribute('href', 'mailto:dana@example.com')
    expect(within(sheet).getByText('dana@example.com', { selector: '.adm-addr' })).toBeInTheDocument()
    expect(within(sheet).getByRole('link', { name: 'Call' })).toHaveAttribute('href', 'tel:2565550142')
    expect(within(sheet).getByText('(256) 555-0142', { selector: '.adm-addr' })).toBeInTheDocument()
    expect(sheet).toHaveAccessibleName('Dana Planner')
    expect(within(sheet).getByText(/Rocket Co · Private event request/)).toBeInTheDocument()
    expect(within(sheet).getByRole('heading', { name: 'The event', level: 3 })).toBeInTheDocument()
    const group = within(sheet).getByRole('group', { name: 'Status for Dana Planner' })
    expect(group).toHaveClass('is-wrap')
    // The status sits near the top, before the answers.
    expect(group.compareDocumentPosition(within(sheet).getByText('100 Main St')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['New', 'Quoted', 'Booked', 'Not this time'])
  })

  it('a status change shows at once with Undo; Undo puts it back', async () => {
    const f = await signedIn()
    tab('Inbox')
    fireEvent.click(await screen.findByRole('button', { name: /Dana Planner/ }))
    const group = within(dialog()).getByRole('group', { name: /Status for Dana/ })
    fireEvent.click(within(group).getByRole('button', { name: 'Quoted' }))
    expect(within(group).getByRole('button', { name: 'Quoted' })).toHaveAttribute('aria-pressed', 'true')
    expect(await screen.findByText('Marked Quoted.')).toBeInTheDocument()
    expect(posts(f, '/api/admin/event-requests.json')).toEqual([{ id: '2026-10-17-abcdef12', status: 'quoted' }])
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(within(group).getByRole('button', { name: 'New' })).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(posts(f, '/api/admin/event-requests.json')).toEqual([
      { id: '2026-10-17-abcdef12', status: 'quoted' }, { id: '2026-10-17-abcdef12', status: 'new' },
    ]))
  })

  it('a status that does not save goes back and says so', async () => {
    await signedIn(server({ postFails: ['/api/admin/messages.json'] }))
    tab('Inbox')
    fireEvent.click(await screen.findByRole('button', { name: /^Messages/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Sam Asker/ }))
    const group = within(dialog()).getByRole('group', { name: 'Status for Sam Asker' })
    fireEvent.click(within(group).getByRole('button', { name: 'Replied' }))
    expect(await screen.findByText("Didn't save. Try again.")).toBeInTheDocument()
    expect(within(group).getByRole('button', { name: 'New' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('messages and teachers: each shows what they sent; teachers show photos and links', async () => {
    const f = await signedIn()
    tab('Inbox')
    fireEvent.click(await screen.findByRole('button', { name: /^Messages/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Sam Asker/ }))
    expect(within(dialog()).getByText('Are you open on Thanksgiving weekend?')).toBeInTheDocument()
    expect(within(dialog()).getByText(/about Craft Café/)).toBeInTheDocument()
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: /^Teachers/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Lou Maker · Lou Makes/ }))
    expect(within(dialog()).getByText('Linocut printing')).toBeInTheDocument()
    expect(within(dialog()).getByRole('link', { name: 'Instagram' })).toHaveAttribute('href', 'https://instagram.com/loumakes')
    expect(within(dialog()).getAllByAltText(/Lou Maker, photo/)).toHaveLength(2)
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Talking' }))
    await waitFor(() => expect(posts(f, '/api/admin/applications.json')).toEqual([{ id: '2026-10-15-abcdef12', status: 'talking' }]))
  })

  it('under New only, a row that changes stays until you leave the list', async () => {
    await signedIn(server({ apps: [app(), app({ id: '2026-10-14-00000000', about: { ...app().about, name: 'Bea' }, status: 'booked' })] }))
    tab('Inbox')
    fireEvent.click(await screen.findByRole('button', { name: /^Teachers/ }))
    expect(await screen.findByRole('button', { name: /Bea/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'New only' }))
    expect(screen.queryByRole('button', { name: /Bea/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Lou Maker/ }))
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Booked' }))
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByRole('button', { name: /Lou Maker/ })).toHaveTextContent('Booked')
    fireEvent.click(screen.getByRole('button', { name: /^Requests/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Teachers/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'New only' }))
    expect(screen.queryByRole('button', { name: /Lou Maker/ })).toBeNull()
  })

  it('each list loads on its own: a broken one says so with Try again, the rest keep working', async () => {
    await signedIn(server({ fail: ['/api/admin/messages.json'] }))
    expect(await screen.findByRole('button', { name: 'Requests: 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Messages: not loaded' })).toHaveTextContent('!')
    tab('Inbox')
    expect(await screen.findByRole('button', { name: /Dana Planner/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Messages/ }))
    expect(await screen.findByText('That list couldn’t be loaded.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    tab('Calendar')
    expect(await screen.findByRole('button', { name: /Pottery/ })).toBeInTheDocument()
  })

  it('empty lists say where things come from; To decide says what lands there', async () => {
    await signedIn(server({ apps: [], requests: [], messages: [] }))
    tab('Inbox')
    expect(await screen.findByText(/ourhometownstudio.com\/private-events/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Teachers/ }))
    expect(screen.getByText(/ourhometownstudio.com\/teach/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^To decide/ }))
    expect(await screen.findByText('Nothing to decide. Things that happen in Square without you land here.')).toBeInTheDocument()
  })
})

describe('Classes tab', () => {
  it('a class opens its bookings in a sheet; Edit replaces it with the form, details filled in', async () => {
    await signedIn()
    tab('Classes')
    fireEvent.click(await screen.findByRole('button', { name: /Pottery/ }))
    expect(await within(dialog()).findByRole('heading', { name: 'Pottery' })).toBeInTheDocument()
    fireEvent.click(await within(dialog()).findByRole('button', { name: 'Edit class' }))
    await waitFor(() => expect(within(dialog()).getByLabelText('Name')).toHaveValue('Pottery'))
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(window.location.hash).toBe('#edit-cls_a')
  })

  it('the library and Block time open', async () => {
    await signedIn()
    tab('Classes')
    fireEvent.click(await screen.findByRole('button', { name: 'Library' }))
    expect(await screen.findByText(/Nothing in the library yet/)).toBeInTheDocument()
    tab('Home')
    fireEvent.click(await screen.findByRole('button', { name: 'Block time' }))
    expect(await within(dialog()).findByText('No blocked time coming up.')).toBeInTheDocument()
  })
})

describe('More', () => {
  it('lists the setup pages; Staff and Promotions are marked as coming', async () => {
    await signedIn()
    tab('More')
    const setup = await screen.findByRole('list', { name: 'Setup' })
    expect(within(setup).getAllByRole('button').map((b) => b.querySelector('b')?.textContent)).toEqual(['Parties setup', 'Hours & Craft Café', 'Closed days', 'Staff', 'Promotions', 'Reports'])
    expect(within(setup).getByRole('button', { name: /Staff/ })).toHaveTextContent('Coming in stage 3')
    expect(within(setup).getByRole('button', { name: /Promotions/ })).toHaveTextContent('Coming in stage 4')
    fireEvent.click(within(setup).getByRole('button', { name: /Parties setup/ }))
    expect(within(dialog()).getByText('Editing party times comes with party booking.')).toBeInTheDocument()
    expect(within(dialog()).getByText('Sundays')).toBeInTheDocument()
    expect(within(dialog()).getByText('1 PM, 3:30 PM')).toBeInTheDocument()
    expect(await within(dialog()).findByText('$18 a guest')).toBeInTheDocument()
  })

  it('Reports says what this month covers', async () => {
    await signedIn()
    tab('More')
    fireEvent.click(await screen.findByRole('button', { name: /Reports/ }))
    expect(await within(dialog()).findByText('74')).toBeInTheDocument()
    expect(within(dialog()).getByText('$1,968')).toBeInTheDocument()
    expect(within(dialog()).getByText('refunds (1)')).toBeInTheDocument()
    expect(within(dialog()).getByText(/Craft Café, party crafts and anything else rung up in Square/)).toBeInTheDocument()
  })

  it('Set up sandbox is not offered on the live site', async () => {
    const f = await signedIn(server({ sandbox: false }))
    tab('More')
    await screen.findByRole('list', { name: 'You' })
    await waitFor(() => expect(f.mock.calls.some((c) => c[0] === '/api/admin/classes/seed-sandbox.json')).toBe(true))
    expect(screen.queryByRole('button', { name: /Set up sandbox/ })).toBeNull()
  })

  it('on the sandbox, Set up sandbox shows the ids and the two commands', async () => {
    await signedIn(server({ sandbox: true }))
    tab('More')
    fireEvent.click(await screen.findByRole('button', { name: /Set up sandbox/ }))
    fireEvent.click((await within(dialog()).findAllByRole('button', { name: 'Set up sandbox' })).pop()!)
    expect(await within(dialog()).findByText(/CAT1/, { selector: 'p' })).toBeInTheDocument()
    expect(within(dialog()).getByText('npx netlify env:set A CAT1')).toBeInTheDocument()
    expect(within(dialog()).getByText('npx netlify env:set B TAX1')).toBeInTheDocument()
  })

  it('who is using this can change, and later requests say the new name; Sign out goes back to sign-in', async () => {
    const f = await signedIn()
    tab('More')
    fireEvent.click(await screen.findByRole('button', { name: /Using as Catherine/ }))
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Kaden' }))
    expect(await screen.findByText('Now using as Kaden.')).toBeInTheDocument()
    expect(localStorage.getItem('admin-who')).toBe('Kaden')
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Close' }))
    fireEvent.click(await screen.findByRole('button', { name: /Reports/ }))
    await within(dialog()).findByText('74')
    const rep = f.mock.calls.find((c) => c[0] === '/api/admin/reports.json')!
    expect(rep[1].headers).toMatchObject({ 'X-Admin-Who': 'Kaden' })
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: /Sign out/ }))
    expect(await screen.findByLabelText('Passcode')).toBeInTheDocument()
  })
})

describe('fix round 1', () => {
  const legacy = { kind: 'legacy-class', id: 'clssch_9', label: 'Needlepoint 101', startIso: at('2026-10-25', '18:00'), endIso: at('2026-10-25', '20:00') }

  it('a bad record is skipped on its own row; the rest of the list and /admin keep working', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await signedIn(server({ requests: [{ id: 'bad-1', status: 'new', about: { name: 'Broken' } }, request()] }))
    tab('Inbox')
    expect(await screen.findByText('One item couldn’t be shown.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Dana Planner/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Inbox' })).toBeInTheDocument()
    tab('More')
    expect(await screen.findByRole('heading', { name: 'More' })).toBeInTheDocument()
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })

  it('a sheet that fails to draw keeps its × and says so', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    window.history.replaceState(null, '', '/admin#request-bad-1')
    await signedIn(server({ requests: [{ id: 'bad-1', status: 'new', about: { name: 'Broken' } }] }))
    const sheet = await screen.findByRole('dialog', { name: 'Something went wrong' })
    expect(within(sheet).getByText('Something went wrong showing this.')).toBeInTheDocument()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    // Closing went back in history; let that land before the next test starts.
    await waitFor(() => expect(window.location.hash).toBe('#inbox'))
    err.mockRestore()
  })

  it('a bottom sheet locks the page behind it and puts the scroll back on close', async () => {
    await signedIn()
    fireEvent.click(await screen.findByRole('button', { name: 'Block time' }))
    expect(document.body.style.position).toBe('fixed')
    expect(document.body.style.overflow).toBe('hidden')
    const scrollTo = vi.fn()
    vi.stubGlobal('scrollTo', scrollTo)
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.body.style.position).toBe('')
    expect(document.body.style.overflow).toBe('')
    // Instant, never smooth: the site sets scroll-behavior: smooth on html.
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'instant' })
    tab('More')
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'instant' })
    for (const c of scrollTo.mock.calls) expect(c[0]).toMatchObject({ behavior: 'instant' })
  })

  it('Home on a closed day: "The studio is closed today." and what is next', async () => {
    await signedIn(server({ items: calendar.filter((i) => i.id !== 'cls_d') }))
    expect(await screen.findByText('The studio is closed today.')).toBeInTheDocument()
    expect(screen.getByText('Next up: Thu Oct 22 · Pottery')).toBeInTheDocument()
  })

  it('an open day with nothing on offers to add to it', async () => {
    vi.setSystemTime(new Date('2026-10-23T15:00:00Z'))
    await signedIn(server({ items: [] }))
    fireEvent.click(await screen.findByRole('button', { name: /Nothing on today/ }))
    expect(dialog()).toHaveAccessibleName('Fri Oct 23')
    // Let the Day sheet's own calendar load land inside the test.
    expect(await within(dialog()).findByText('Nothing on this day yet.')).toBeInTheDocument()
  })

  it('the Day sheet on a closed weekday says so, and every add button reads the same', async () => {
    await signedIn()
    tab('Calendar')
    // Monday has a class today, so only Tuesday and Wednesday fold.
    fireEvent.click(await screen.findByRole("button", { name: /Show Tue–Wed/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Add on Tue Oct 20' }))
    expect(await within(dialog()).findByText(/usually closed on Tuesdays/)).toBeInTheDocument()
    // Parties can't be booked on a closed weekday, so the sheet says so instead of offering it.
    expect(within(dialog()).queryByRole('button', { name: '+ Book a party on this day' })).toBeNull()
    expect(within(dialog()).getByText('Parties can’t be booked on Tuesdays.')).toBeInTheDocument()
    expect(within(dialog()).getByRole('button', { name: '+ New class on this day' })).toBeInTheDocument()
  })

  it('Classes › Upcoming lists the classes still run from Square, read only', async () => {
    await signedIn(server({ items: [...calendar, legacy] }))
    tab('Classes')
    const row = await screen.findByRole('button', { name: /Needlepoint 101/ })
    expect(row).toHaveTextContent('In Square')
    expect(row.querySelector('.adm-rt')!.textContent).toBe('6–8\u00a0PM')
    fireEvent.click(row)
    expect(await within(dialog()).findByText('This class lives in Square. Change it there.')).toBeInTheDocument()
    expect(window.location.hash).toBe('#legacy-2026-10-25-clssch_9')
  })

  it('Classes › Library has one way to add a class: + New class', async () => {
    await signedIn()
    tab('Classes')
    fireEvent.click(await screen.findByRole('button', { name: 'Library' }))
    await screen.findByText(/Nothing in the library yet/)
    expect(screen.queryByRole('button', { name: 'Add a class to the library' })).toBeNull()
    expect(screen.getByRole('button', { name: '+ New class' })).toBeInTheDocument()
  })

  it('the class form and Block time keep their buttons in the sheet’s pinned footer, not mid-form', async () => {
    await signedIn()
    fireEvent.click(await screen.findByRole('button', { name: '+ New class' }))
    const add = await within(dialog()).findByRole('button', { name: 'Add class' })
    expect(add.closest('.adm-sheet-foot')).not.toBeNull()
    fireEvent.click(add)
    expect(within(dialog()).getByText('Give the class a name.')).toBeInTheDocument()
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Block time' }))
    const block = await within(dialog()).findByRole('button', { name: 'Block this time' })
    expect(block.closest('.adm-sheet-foot')).not.toBeNull()
    expect(within(dialog()).getAllByRole('heading', { name: 'Block time' })).toHaveLength(1)
  })

  it('Set up sandbox opened by address on the live site has nothing to press', async () => {
    window.history.replaceState(null, '', '/admin#more-sandbox')
    await signedIn(server({ sandbox: false }))
    expect(await within(await screen.findByRole('dialog')).findByText(/Only on the test site/)).toBeInTheDocument()
    expect(within(dialog()).queryByRole('button', { name: 'Set up sandbox' })).toBeNull()
  })

  it('reloading on a sheet does not add another history entry', async () => {
    window.history.replaceState({ admTab: 'more', admSheet: 'more-hours' }, '', '/admin#more-hours')
    const before = window.history.length
    await signedIn()
    await screen.findByRole('dialog', { name: 'Hours & Craft Café' })
    expect(window.history.length).toBe(before)
  })

  it('two quick status taps: Undo goes back to the one before, not the original', async () => {
    const f = await signedIn()
    tab('Inbox')
    fireEvent.click(await screen.findByRole('button', { name: /Dana Planner/ }))
    const group = within(dialog()).getByRole('group', { name: /Status for Dana/ })
    fireEvent.click(within(group).getByRole('button', { name: 'Quoted' }))
    fireEvent.click(within(group).getByRole('button', { name: 'Booked' }))
    await screen.findByText('Marked Booked.')
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(within(group).getByRole('button', { name: 'Quoted' })).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(posts(f, '/api/admin/event-requests.json').map((p: any) => p.status)).toEqual(['quoted', 'booked', 'quoted']))
  })

  it('the Inbox header says nothing about waiting until the lists have answered', async () => {
    let release!: () => void
    const base = server()
    await signedIn(vi.fn(async (url: string, init?: any) => {
      if (url === '/api/admin/messages.json' && !init?.method) await new Promise<void>((r) => { release = r })
      return base(url, init)
    }))
    tab('Inbox')
    await screen.findByRole('heading', { name: 'Inbox' })
    const note = () => screen.getByRole('main').querySelector('.adm-top .adm-small')!
    expect(note().textContent).toBe('')
    await act(async () => release())
    await waitFor(() => expect(note().textContent).toBe('3 waiting'))
  })

  it('round 2: "Next up" on a closed day skips blocked time', async () => {
    const items = [
      { kind: 'blocked', id: 'blk_7', label: 'Deep clean', startIso: at('2026-10-22', '09:00'), endIso: at('2026-10-22', '12:00') },
      { kind: 'party', id: 'bk_9', label: 'the Justice party', startIso: at('2026-10-24', '13:30'), endIso: at('2026-10-24', '15:00'), guests: 14 },
    ]
    await signedIn(server({ items }))
    expect(await screen.findByText('Next up: Sat Oct 24 · The Justice party')).toBeInTheDocument()
  })

  it('round 2: Square classes are grouped under one heading per day, with one label', async () => {
    const two = [legacy, { ...legacy, id: 'clssch_10', label: 'Kinusaiga', startIso: at('2026-10-25', '14:00'), endIso: at('2026-10-25', '16:00') }]
    await signedIn(server({ items: [...calendar, ...two] }))
    tab('Classes')
    const sun = await within(await screen.findByRole('region', { name: 'Still run from Square' })).findByRole('region', { name: 'Sun Oct 25' })
    expect(within(sun).getAllByRole('button')).toHaveLength(2)
    expect(screen.getAllByText('Sun Oct 25', { selector: '.adm-dayname' })).toHaveLength(1)
    const row = within(sun).getByRole('button', { name: /Kinusaiga/ })
    expect(row).toHaveTextContent('In Square')
    expect(row).not.toHaveTextContent('Square class')
  })

  it('round 2: the old class form keeps its messages in the body; the footer holds only full-width buttons', async () => {
    await signedIn()
    fireEvent.click(await screen.findByRole('button', { name: '+ New class' }))
    const foot = await waitFor(() => { const f = dialog().querySelector('.adm-sheet-foot'); if (!f) throw new Error('no footer'); return f })
    expect(foot.querySelectorAll('p, ul')).toHaveLength(0)
    expect(within(foot as HTMLElement).getAllByRole('button').map((b) => b.textContent)).toEqual(['Add class', 'Add and keep in the library'])
    expect(foot.querySelector('.adm-savebtns')).not.toBeNull()
  })

  it('round 2: the inbox Status label is a section label with room under the Next note', async () => {
    await signedIn()
    tab('Inbox')
    fireEvent.click(await screen.findByRole('button', { name: /Dana Planner/ }))
    const label = within(dialog()).getByRole('heading', { name: 'Status', level: 3 })
    expect(label).toHaveClass('adm-lbl')
    expect(label).not.toHaveAttribute('style')
    expect(label.previousElementSibling).toHaveClass('adm-note')
  })
})
