import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { renderSheet, ok, refuse, posts } from './harness'
import { AdminAccessSheet, ConnectionsSheet, NotifySheet } from '@components/admin/sheets/OwnerSheets'
import { HomeHealthAlert } from '@components/admin/HomeHealth'

const ACCESS = '/api/admin/admin-access.json'
const NOTIFY = '/api/admin/notify.json'

const view = (over: Record<string, unknown> = {}) => ({
  setInAdmin: false, updatedAt: null, by: null, damaged: false, settingTookOver: false, readOnly: false, min: 8,
  owners: [
    { id: 'TM4', name: 'Catherine', hasEmail: true, hasPhone: true },
    { id: 'TM1', name: 'Kaden', hasEmail: true, hasPhone: false },
  ],
  ownerSource: 'staff-list', ...over,
})

let fetchMock: ReturnType<typeof vi.fn>
let current: any
beforeEach(() => {
  current = view()
  fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = String(url).split('?')[0]
    if (path === ACCESS && (init.method ?? 'GET') === 'GET') return ok({ data: current })
    if (path === ACCESS) return ok({ data: { updatedAt: '2026-11-02T15:00:00.000Z' } })
    throw new Error(`unexpected ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('More › Admin access', () => {
  it('lists the owners from the staff list, with what is on file, and opens Staff › People to change them', async () => {
    const { sheet } = renderSheet(<AdminAccessSheet />)
    expect(await screen.findByText('Catherine')).toBeInTheDocument()
    expect(screen.getByText('email on file · no mobile yet')).toBeInTheDocument()
    expect(screen.getByText(/The owners are the people marked Owner in Staff › People/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Change who’s an owner' }))
    expect(sheet.open).toHaveBeenCalledWith({ kind: 'more', page: 'staff' }, { part: 'people' })
  })

  it('before a staff list exists, says the owners are Catherine and Kaden', async () => {
    current = view({ ownerSource: 'bootstrap', owners: [{ id: null, name: 'Catherine', hasEmail: false, hasPhone: false }, { id: null, name: 'Kaden', hasEmail: false, hasPhone: false }] })
    renderSheet(<AdminAccessSheet />)
    expect(await screen.findByText('The staff list isn’t started yet, so the owners are Catherine and Kaden.')).toBeInTheDocument()
  })

  it('change the passcode: the current one, the new one twice; says what happens to other devices; never sends it anywhere else', async () => {
    const { dirty } = renderSheet(<AdminAccessSheet />)
    fireEvent.click(await screen.findByRole('button', { name: 'Change the admin passcode' }))
    expect(screen.getByText(/Every other phone or iPad signed in to \/admin is signed out/, { selector: 'span' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Passcode you use now'), { target: { value: 'owner-secret' } })
    expect(dirty()).toBe(true)
    fireEvent.change(screen.getByLabelText('New passcode'), { target: { value: 'studio-door-7' } })
    fireEvent.change(screen.getByLabelText('New passcode again'), { target: { value: 'studio-door-7' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save new admin passcode' }))
    expect(await screen.findByText(/The admin passcode is changed/)).toBeInTheDocument()
    expect(posts(fetchMock, ACCESS)).toEqual([expect.objectContaining({ body: { current: 'owner-secret', passcode: 'studio-door-7', again: 'studio-door-7', expectedUpdatedAt: null } })])
    await waitFor(() => expect(screen.queryByLabelText('New passcode')).toBeNull())
  })

  it('a refusal shows in plain words and keeps what was typed', async () => {
    fetchMock.mockImplementation(async (url: string, init: RequestInit = {}) => {
      if ((init.method ?? 'GET') === 'GET') return ok({ data: current })
      return refuse(403, { error: 'The current passcode isn’t right.' })
    })
    renderSheet(<AdminAccessSheet />)
    fireEvent.click(await screen.findByRole('button', { name: 'Change the admin passcode' }))
    fireEvent.change(screen.getByLabelText('Passcode you use now'), { target: { value: 'nope' } })
    fireEvent.change(screen.getByLabelText('New passcode'), { target: { value: 'studio-door-7' } })
    fireEvent.change(screen.getByLabelText('New passcode again'), { target: { value: 'studio-door-7' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save new admin passcode' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The current passcode isn’t right.')
    expect(screen.getByLabelText('New passcode')).toHaveValue('studio-door-7')
  })

  it('a test site shows it read only; a new setting that took over says so', async () => {
    current = view({ readOnly: true, setInAdmin: true, updatedAt: '2026-11-01T15:00:00Z', by: 'Kaden', settingTookOver: true })
    renderSheet(<AdminAccessSheet />)
    expect(await screen.findByText('This test site can’t change the live admin passcode.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Change the admin passcode' })).toBeDisabled()
    expect(screen.getByText(/The passcode from the site setup is in use/)).toBeInTheDocument()
  })
})

const row = (r: string, label: string, channels: string[], over: Record<string, unknown> = {}) => ({
  row: r, label, channels, picked: ['TM4', 'TM1'],
  goesTo: { ...(channels.includes('email') ? { email: ['kaden@ourhometownstudio.com', 'catherine@ourhometownstudio.com'] } : {}), ...(channels.includes('text') ? { text: ['…2907'] } : {}) },
  from: { ...(channels.includes('email') ? { email: 'setup' } : {}), ...(channels.includes('text') ? { text: 'setup' } : {}) }, ...over,
})
const notifyView = (over: Record<string, unknown> = {}) => ({
  saved: false, updatedAt: null, by: null, noList: false, readOnly: false,
  owners: [{ id: 'TM4', name: 'Catherine', email: 'cat@example.com', phone: '+12565550104' }, { id: 'TM1', name: 'Kaden', email: null, phone: '+14025550101' }],
  rows: [
    row('owner-texts', 'Texts when something needs you', ['text']),
    row('booking-alerts', 'Someone just booked', ['text', 'email']),
    row('warnings-email', 'Morning warnings and heads-up emails', ['email']),
    row('tax-report', 'Monthly tax split', ['email']),
    row('archive', 'Weekly records archive', ['email']),
  ],
  ...over,
})

describe('More › Notifications', () => {
  let nv: any
  beforeEach(() => {
    nv = notifyView()
    fetchMock.mockImplementation(async (url: string, init: RequestInit = {}) => {
      if ((init.method ?? 'GET') === 'GET') return ok({ data: nv })
      return ok({ data: { updatedAt: '2026-11-02T15:00:00.000Z', changed: ['Monthly tax split'] } })
    })
  })

  it('each row says what it is, who is ticked, and where it goes now (from the site setup until saved)', async () => {
    renderSheet(<NotifySheet />)
    const tax = await screen.findByRole('group', { name: 'Monthly tax split' })
    expect(tax).toHaveTextContent('On the 1st, last month’s tax split')
    expect(tax).toHaveTextContent('Emails go to kaden@ourhometownstudio.com, catherine@ourhometownstudio.com (from the site setup).')
    expect(tax).toHaveTextContent('Kaden · no email in Staff › People')
    const texts = screen.getByRole('group', { name: 'Texts when something needs you' })
    expect(texts).toHaveTextContent('Texts go to the phone ending 2907 (from the site setup).')
    expect(screen.getByText(/Nothing is set here yet/)).toBeInTheDocument()
  })

  it('M1: the archive row says when a new owner or new email starts getting it', async () => {
    nv.rows[4] = { ...nv.rows[4], held: [{ name: 'Dana', until: '2026-11-03T21:10:00.000Z' }] }
    renderSheet(<NotifySheet />)
    const archive = await screen.findByRole('group', { name: 'Weekly records archive' })
    expect(archive).toHaveTextContent(/Dana starts getting this .*\. A new owner or a new email waits a day, so nobody can quietly send the records somewhere new\./)
  })

  it('untick, save: sends every row’s picks with the version it loaded, and says what changed', async () => {
    const { dirty } = renderSheet(<NotifySheet />)
    const tax = await screen.findByRole('group', { name: 'Monthly tax split' })
    expect(screen.getByRole('button', { name: 'Save notifications' })).toBeDisabled()
    fireEvent.click(within(tax).getByRole('checkbox', { name: /Kaden/ }))
    expect(dirty()).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Save notifications' }))
    expect(await screen.findByText('Saved. Changed: Monthly tax split. Everything else stays as it was.')).toBeInTheDocument()
    const sent = posts(fetchMock, NOTIFY)[0].body
    expect(sent.expectedUpdatedAt).toBeNull()
    expect(sent.rows['tax-report']).toEqual(['TM4'])
    expect(sent.rows.archive).toEqual(['TM4', 'TM1'])
  })

  it('a refusal shows in plain words', async () => {
    fetchMock.mockImplementation(async (url: string, init: RequestInit = {}) => ((init.method ?? 'GET') === 'GET'
      ? ok({ data: nv })
      : refuse(400, { error: 'Pick at least one owner for “Weekly records archive”.' })))
    renderSheet(<NotifySheet />)
    const archive = await screen.findByRole('group', { name: 'Weekly records archive' })
    fireEvent.click(within(archive).getByRole('checkbox', { name: /Kaden/ }))
    fireEvent.click(within(archive).getByRole('checkbox', { name: /Catherine/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save notifications' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Pick at least one owner for “Weekly records archive”.')
  })

  it('no staff list yet: nothing to tick, says where things go and how to start', async () => {
    nv = notifyView({ noList: true, owners: [] })
    renderSheet(<NotifySheet />)
    expect(await screen.findByText(/Start the staff list in Staff › People first/)).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save notifications' })).toBeNull()
  })
})

const HEALTH = '/api/admin/health.json'
const okH = { state: 'ok', since: null, kind: null, count: 0, lastOkAt: null }
const failing = { state: 'failing', since: '2026-11-03T15:10:00Z', kind: 'auth', count: 3, lastOkAt: null }

describe('emails, texts and Square (G2)', () => {
  let hv: any
  let answer: any
  beforeEach(() => {
    hv = { email: failing, text: okH, square: okH, testSite: false }
    answer = { ok: true, message: 'Sent to cat@example.com. Check your inbox (and spam) in a minute.' }
    fetchMock.mockImplementation(async (url: string, init: RequestInit = {}) => {
      if (String(url) !== HEALTH) throw new Error(`unexpected ${url}`)
      if ((init.method ?? 'GET') === 'GET') return ok({ data: hv })
      return ok({ data: answer })
    })
  })

  it('Home: a warning while emails are failing, with Send me a test email and What to do; the result shows under the button', async () => {
    const onOpen = vi.fn()
    render(<HomeHealthAlert onOpen={onOpen} />)
    const panel = await screen.findByRole('group', { name: 'Emails problem' })
    expect(panel).toHaveTextContent(/Emails aren’t going out since .*Customers aren’t getting confirmations, payment links or refund emails\./)
    fireEvent.click(within(panel).getByRole('button', { name: 'Send me a test email' }))
    expect(await within(panel).findByRole('status')).toHaveTextContent('Sent to cat@example.com.')
    expect(posts(fetchMock, HEALTH)[0].body).toEqual({ action: 'test-email' })
    fireEvent.click(within(panel).getByRole('button', { name: 'What to do' }))
    expect(onOpen).toHaveBeenCalledWith({ kind: 'more', page: 'connections' }, { focus: 'email' })
    expect(screen.queryByRole('group', { name: 'Texts problem' })).toBeNull()
  })

  it('Home says nothing while all is well', async () => {
    hv = { email: okH, text: okH, square: okH }
    const { container } = render(<HomeHealthAlert onOpen={vi.fn()} />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })

  it('More › Email, texts and Square: each one’s state, its test, and the steps to fix it (open on the broken one)', async () => {
    hv = { email: okH, text: okH, square: failing, testSite: true }
    answer = { ok: false, message: 'Square refused the website’s key. See What to do.' }
    renderSheet(<ConnectionsSheet />, { data: { focus: 'square' } })
    const sq = await screen.findByRole('region', { name: 'Square' })
    expect(within(sq).getByRole('alert')).toHaveTextContent('Square is refusing the website since')
    expect(within(sq).getByText('What to do if it stops').closest('details')).toHaveAttribute('open')
    expect(sq).toHaveTextContent('developer.squareup.com')
    expect(sq).toHaveTextContent('SQUARE_ACCESS_TOKEN')
    fireEvent.click(within(sq).getByRole('button', { name: 'Check Square' }))
    expect(await within(sq).findByRole('status')).toHaveTextContent('Square refused the website’s key.')
    const email = screen.getByRole('region', { name: 'Emails' })
    expect(email).toHaveTextContent('Working: nothing has failed lately.')
    expect(within(email).getByText('What to do if it stops').closest('details')).not.toHaveAttribute('open')
    expect(email).toHaveTextContent('App passwords')
    expect(screen.getByText(/This is a test site, so they go to the test inbox and phone instead/)).toBeInTheDocument()
  })
})
