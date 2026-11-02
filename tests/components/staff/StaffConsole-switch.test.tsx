import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import StaffConsole from '@components/staff/StaffConsole'

afterEach(() => { vi.restoreAllMocks(); history.replaceState(null, '', '/') })

describe('StaffConsole — Switch person', () => {
  it('opens a flyout of the team (no passcode screen) and switches who is signed in', async () => {
    history.replaceState(null, '', '/staff')
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, init?: any) => {
      const href = String(url)
      const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ data }) }) as Response
      if (href.includes('/api/staff/me.json')) return ok({ staff: { id: 'a', name: 'Kaden', role: 'owner' } })
      if (href.includes('/api/staff/switch.json') && init?.method === 'POST') return ok({ staff: { id: 'c', name: 'Ava', role: 'crew' } })
      if (href.includes('/api/staff/switch.json')) return ok({ staff: [{ id: 'a', name: 'Kaden', role: 'owner' }, { id: 'c', name: 'Ava', role: 'crew' }] })
      return ok({ events: [], sources: {}, count: 0, parties: [], incidents: [] })
    })
    render(<StaffConsole />)
    fireEvent.click(await screen.findByRole('button', { name: /Kaden/, expanded: false }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Switch person' }))
    const sheet = await screen.findByRole('dialog', { name: 'Switch person' })
    expect(screen.queryByLabelText(/passcode/i)).toBeNull()
    fireEvent.click(await within(sheet).findByRole('button', { name: 'Ava' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Switch person' })).toBeNull())
    expect(await screen.findByRole('button', { name: /Ava/, expanded: false })).toBeInTheDocument()
  })
})

describe('StaffConsole — My shifts', () => {
  it('a My shifts tab after Calendar shows whose shifts these are, and switching person reloads them for the new person', async () => {
    history.replaceState(null, '', '/staff')
    const shiftsFor = (id: string, name: string) => ({
      me: { id, name }, mine: [], open: [], feed: { has: false },
      availability: { staffId: id, name, weekly: {}, dates: {}, updatedAt: null, history: [] },
    })
    let current = { id: 'a', name: 'Kaden', role: 'owner' }
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, init?: any) => {
      const href = String(url)
      const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ data }) }) as Response
      if (href.includes('/api/staff/me.json')) return ok({ staff: current })
      if (href.includes('/api/staff/shifts.json')) return ok(shiftsFor(current.id, current.name))
      if (href.includes('/api/staff/switch.json') && init?.method === 'POST') { current = { id: 'c', name: 'Ava', role: 'crew' }; return ok({ staff: current }) }
      if (href.includes('/api/staff/switch.json')) return ok({ staff: [{ id: 'a', name: 'Kaden', role: 'owner' }, { id: 'c', name: 'Ava', role: 'crew' }] })
      return ok({ events: [], sources: {}, count: 0, parties: [], incidents: [], items: [] })
    })
    render(<StaffConsole />)
    const tabs = await screen.findByRole('navigation', { name: 'Staff sections' })
    const labels = within(tabs).getAllByRole('button').map((b) => b.textContent)
    expect(labels.indexOf('My shifts')).toBe(labels.indexOf('Calendar') + 1)
    fireEvent.click(within(tabs).getByRole('button', { name: 'My shifts' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Kaden’s shifts' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Not Kaden? Switch' }))
    const sheet = await screen.findByRole('dialog', { name: 'Switch person' })
    fireEvent.click(await within(sheet).findByRole('button', { name: 'Ava' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Ava’s shifts' })).toBeInTheDocument()
  })
})


describe('StaffConsole — shared iPad safety (fix round 3)', () => {
  const shiftsFor = (id: string, name: string, mine: any[] = []) => ({
    me: { id, name }, mine, open: [], feed: { has: false },
    availability: { staffId: id, name, weekly: { '0': null, '1': null, '2': null, '3': null, '4': null, '5': null, '6': null }, dates: {}, updatedAt: null, history: [] },
  })
  function mockApi(opts: { posts?: any[]; items?: any[]; mineFor?: (id: string) => any[] } = {}) {
    let current = { id: 'j', name: 'Jessica', role: 'crew' }
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, init?: any) => {
      const href = String(url)
      const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ data }) }) as Response
      if (init?.method === 'POST' && href.includes('/api/staff/shifts.json')) {
        opts.posts?.push(JSON.parse(init.body))
        return ok({ availability: { ...shiftsFor(current.id, current.name).availability, ...JSON.parse(init.body), updatedAt: '2026-11-02T15:00:00.000Z' } })
      }
      if (init?.method === 'POST' && href.includes('/api/staff/feed.json')) return ok({ https: 'https://x.test/feed/JESSTOKEN.ics', webcal: 'webcal://x.test/feed/JESSTOKEN.ics' })
      if (href.includes('/api/staff/me.json')) return ok({ staff: current })
      if (href.includes('/api/staff/shifts.json')) return ok(shiftsFor(current.id, current.name, opts.mineFor?.(current.id) ?? []))
      if (href.includes('/api/staff/switch.json') && init?.method === 'POST') { current = { id: 's', name: 'Sam', role: 'crew' }; return ok({ staff: current }) }
      if (href.includes('/api/staff/switch.json')) return ok({ staff: [{ id: 'j', name: 'Jessica', role: 'crew' }, { id: 's', name: 'Sam', role: 'crew' }] })
      if (href.includes('/api/staff/calendar.json')) return ok({ items: opts.items ?? [] })
      return ok({ events: [], sources: {}, count: 0, parties: [], incidents: [], items: [] })
    })
  }
  async function openMyShifts() {
    history.replaceState(null, '', '/staff')
    render(<StaffConsole />)
    const tabs = await screen.findByRole('navigation', { name: 'Staff sections' })
    fireEvent.click(within(tabs).getByRole('button', { name: 'My shifts' }))
    await screen.findByRole('heading', { level: 1, name: 'Jessica’s shifts' })
    return tabs
  }
  async function switchToSam() {
    fireEvent.click(screen.getByRole('button', { name: /Jessica ▾/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Switch person' }))
    const sheet = await screen.findByRole('dialog', { name: 'Switch person' })
    fireEvent.click(await within(sheet).findByRole('button', { name: 'Sam' }))
  }

  it('Switch person closes the calendar link sheet and forgets the link (I3)', async () => {
    mockApi()
    await openMyShifts()
    fireEvent.click(screen.getByRole('button', { name: 'Add my shifts to my phone' }))
    const dialog = screen.getByRole('dialog', { name: 'My shifts on my phone' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Get my calendar link' }))
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Show my link' }))
    expect(document.body.innerHTML).toContain('JESSTOKEN')
    await switchToSam()
    expect(await screen.findByRole('heading', { level: 1, name: 'Sam’s shifts' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: /calendar link|My shifts on my phone/ })).toBeNull()
    expect(document.body.innerHTML).not.toContain('JESSTOKEN')
  })

  it("Calendar tab: Switch person drops Jessica's ✓ You're on and loads Sam's (I1)", async () => {
    const startIso = new Date(Date.now() + 60_000).toISOString() // today, so it's in the week shown
    const items = [{ kind: 'party', id: 'bk_1', label: 'Rivera party', startIso, endIso: new Date(Date.now() + 3_600_000).toISOString() }]
    mockApi({ items, mineFor: (id) => (id === 'j' ? [{ event: { key: 'party:bk_1', status: 'on', endIso: items[0].endIso } }] : []) })
    history.replaceState(null, '', '/staff')
    render(<StaffConsole />)
    const tabs = await screen.findByRole('navigation', { name: 'Staff sections' })
    fireEvent.click(within(tabs).getByRole('button', { name: 'Calendar' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /Rivera party/ })).toHaveTextContent('You’re on'))
    await switchToSam()
    expect(await screen.findByRole('button', { name: /Sam ▾/ })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: /Rivera party/ })).not.toHaveTextContent('You’re on'))
  })

  it('unsaved times: leaving asks in the app; Stay keeps them, Leave without saving goes, Save saves then goes (I5)', async () => {
    const posts: any[] = []
    const confirmSpy = vi.spyOn(window, 'confirm')
    mockApi({ posts })
    await openMyShifts()
    const tabs = () => screen.getByRole('navigation', { name: 'Staff sections' })
    const mark = () => fireEvent.click(within(screen.getByRole('group', { name: 'Can you work Thursdays?' })).getByRole('button', { name: /^Can$/ }))
    mark()
    fireEvent.click(within(tabs()).getByRole('button', { name: 'Calendar' }))
    let ask = await screen.findByRole('dialog', { name: 'Your times aren’t saved' })
    fireEvent.click(within(ask).getByRole('button', { name: 'Stay here' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Jessica’s shifts' })).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: 'Can you work Thursdays?' })).getByRole('button', { name: /Can$/ })).toHaveAttribute('aria-pressed', 'true')
    // Switch person asks first too
    fireEvent.click(screen.getByRole('button', { name: 'Not Jessica? Switch' }))
    ask = await screen.findByRole('dialog', { name: 'Your times aren’t saved' })
    expect(screen.queryByRole('dialog', { name: 'Switch person' })).toBeNull()
    // Save my times: saved, then on to the switch sheet
    fireEvent.click(within(ask).getByRole('button', { name: 'Save my times' }))
    expect(await screen.findByRole('dialog', { name: 'Switch person' })).toBeInTheDocument()
    expect(posts).toHaveLength(1)
    expect(posts[0].weekly['4']).toMatchObject({ kind: 'can' })
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Switch person' })).getByRole('button', { name: 'Cancel' }))
    // change again (Thursdays back to Not said), then leave without saving
    fireEvent.click(within(screen.getByRole('group', { name: 'Can you work Thursdays?' })).getByRole('button', { name: 'Not said' }))
    fireEvent.click(within(tabs()).getByRole('button', { name: 'Calendar' }))
    ask = await screen.findByRole('dialog', { name: 'Your times aren’t saved' })
    fireEvent.click(within(ask).getByRole('button', { name: 'Leave without saving' }))
    expect(await screen.findByRole('button', { name: 'Next week' })).toBeInTheDocument()
    expect(posts).toHaveLength(1)
    expect(confirmSpy).not.toHaveBeenCalled()
  })
})
