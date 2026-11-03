import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react'
import StaffConsole, { IDLE_MS } from '@components/staff/StaffConsole'
import { KIOSK_OUT_KEY } from '@lib/kiosk-handback'

const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ data }) }) as Response

function mockApi(opts: { meOk?: () => boolean } = {}) {
  let current = { id: 's', name: 'Sam Lee', role: 'crew' }
  const calls: string[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, init?: any) => {
    const href = String(url)
    calls.push(`${init?.method ?? 'GET'} ${href}`)
    if (href.includes('/api/staff/me.json')) {
      if (opts.meOk && !opts.meOk()) return { ok: false, status: 401, json: async () => ({ error: 'Unauthorized' }) } as Response
      return ok({ staff: current })
    }
    if (href.includes('/api/staff/switch.json') && init?.method === 'POST') { current = { id: 'j', name: 'Jo', role: 'crew' }; return ok({ staff: current }) }
    if (href.includes('/api/staff/switch.json')) return ok({ staff: [{ id: 's', name: 'Sam Lee', role: 'crew' }, { id: 'j', name: 'Jo', role: 'crew' }] })
    if (href.includes('/api/staff/week.json')) return ok({ events: [{ kind: 'party', id: 'p1', title: 'Rivera party', startIso: new Date().toISOString(), days: [new Date().toISOString().slice(0, 10)], dropOff: false }] })
    return ok({ events: [], sources: {}, count: 0, parties: [], incidents: [], items: [], warnings: [] })
  })
  return calls
}

beforeEach(() => { sessionStorage.clear(); history.replaceState(null, '', '/staff') })
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); sessionStorage.clear(); history.replaceState(null, '', '/') })

describe('StaffConsole: handing the iPad to a family and back (crew review C1)', () => {
  it('reached again while a family has the iPad (Back from the waiver): covers everything until a crew tap', async () => {
    sessionStorage.setItem(KIOSK_OUT_KEY, '1')
    mockApi()
    render(<StaffConsole />)
    expect(await screen.findByRole('heading', { name: 'Hand the iPad back to the crew' })).toBeInTheDocument()
    // nothing of the console behind it
    expect(screen.queryByRole('navigation', { name: 'Staff sections' })).toBeNull()
    expect(screen.queryByText('Rivera party')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'I’m Sam, continue' }))
    expect(await screen.findByRole('navigation', { name: 'Staff sections' })).toBeInTheDocument()
    expect(sessionStorage.getItem(KIOSK_OUT_KEY)).toBeNull()
  })

  it('a page restored from Safari’s cache (pageshow) covers itself too', async () => {
    mockApi()
    render(<StaffConsole />)
    expect(await screen.findByRole('navigation', { name: 'Staff sections' })).toBeInTheDocument()
    sessionStorage.setItem(KIOSK_OUT_KEY, '1')
    act(() => { window.dispatchEvent(new Event('pageshow')) })
    expect(await screen.findByTestId('handback-cover')).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Staff sections' })).toBeNull()
  })

  it('the continue tap re-checks the sign-in: lapsed goes to the passcode screen', async () => {
    sessionStorage.setItem(KIOSK_OUT_KEY, '1')
    let signedIn = true
    mockApi({ meOk: () => signedIn })
    render(<StaffConsole />)
    await screen.findByTestId('handback-cover')
    signedIn = false
    fireEvent.click(screen.getByRole('button', { name: 'I’m Sam, continue' }))
    expect(await screen.findByLabelText('Staff passcode')).toBeInTheDocument()
    expect(screen.queryByTestId('handback-cover')).toBeNull()
  })

  it('“Not Sam? Switch person” opens the team over the cover and lands on the new person', async () => {
    sessionStorage.setItem(KIOSK_OUT_KEY, '1')
    sessionStorage.setItem('hg_lastDoorQuery', 'rivera')
    mockApi()
    render(<StaffConsole />)
    fireEvent.click(await screen.findByRole('button', { name: 'Not Sam? Switch person' }))
    const sheet = await screen.findByRole('dialog', { name: 'Switch person' })
    fireEvent.click(await within(sheet).findByRole('button', { name: 'Jo' }))
    expect(await screen.findByRole('button', { name: /Jo/, expanded: false })).toBeInTheDocument()
    expect(screen.queryByTestId('handback-cover')).toBeNull()
    // the last person's door search doesn't follow the new one
    expect(sessionStorage.getItem('hg_lastDoorQuery')).toBeNull()
  })
})

describe('StaffConsole: "Still Sam?" on a quiet shared iPad (M8)', () => {
  it('after the idle time, asks who is here before anything else', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockApi()
    render(<StaffConsole />)
    expect(await screen.findByRole('navigation', { name: 'Staff sections' })).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(IDLE_MS + 31_000) })
    expect(await screen.findByRole('heading', { name: 'Still Sam?' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Staff sections' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Yes, I’m Sam' }))
    await waitFor(() => expect(screen.queryByTestId('handback-cover')).toBeNull())
  })
})

describe('StaffConsole: passcode field (M6)', () => {
  it('has a label, a password autocomplete hint, and one sign-in per tap', async () => {
    let logins = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, init?: any) => {
      const href = String(url)
      if (href.includes('/api/staff/me.json')) return { ok: false, status: 401, json: async () => ({}) } as Response
      if (href.includes('/api/staff/login.json') && init?.method === 'POST') {
        logins++
        await new Promise((r) => setTimeout(r, 20))
        return ok({ staff: [{ id: 's', name: 'Sam', role: 'crew' }] })
      }
      return ok({})
    })
    render(<StaffConsole />)
    const field = await screen.findByLabelText('Staff passcode')
    expect(field).toHaveAttribute('autocomplete', 'current-password')
    fireEvent.change(field, { target: { value: '1234' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: /Checking…|Enter/ }))
    await screen.findByText('Sam')
    expect(logins).toBe(1)
  })
})
