import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import { renderSheet } from '../sheets/harness'
import { PeoplePanel } from '@components/admin/staffing/PeoplePanel'
import { HomeStaffing } from '@components/admin/staffing/HomeStaffing'
import { HomePasscodeAlert } from '@components/admin/staffing/HomePasscodeAlert'
import { bodies, ok, refuse } from './fixtures'

const PEOPLE = '/api/admin/staff-people.json'
const FEED = '/api/admin/feed.json'
const STAFFING = '/api/admin/staffing.json'
const PASSCODE = '/api/admin/staff-passcode.json'

const p = (id: string, givenName: string, over: Record<string, unknown> = {}) => ({
  id, name: givenName, givenName, familyName: '', role: 'crew', phone: null, email: null, active: true, leftAt: null, updatedAt: 'u1',
  feed: { has: false, createdAt: null, lastUsedAt: null }, ...over,
})
const LIST = [
  p('TM4', 'Catherine', { role: 'owner', familyName: 'Goodell' }),
  p('TM2', 'Jessica', { familyName: 'Lane', phone: '+12565550199', email: 'jess@example.com', feed: { has: true, createdAt: '2026-10-30T15:00:00Z', lastUsedAt: '2026-11-01T15:00:00Z' } }),
  p('TM8', 'Ava', { active: false, leftAt: '2026-10-01T15:00:00Z' }),
]

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = String(url).split('?')[0]
    if (path === PEOPLE && (init.method ?? 'GET') === 'GET') return ok({ data: { people: LIST, saved: true, startedFrom: 'square' } })
    if (path === PEOPLE) return ok({ data: { person: LIST[1] } })
    if (path === FEED) return ok({ data: { stopped: true } })
    if (path === PASSCODE && (init.method ?? 'GET') === 'GET') return ok({ data: { setInAdmin: false, updatedAt: null, by: null, readOnly: false } })
    if (path === PASSCODE) return ok({ data: { updatedAt: '2026-11-02T15:00:00.000Z' } })
    throw new Error(`unexpected ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

/** The next staff list read answers `res` (the passcode panel reads on its own, so a plain "once" could go to it). */
function peopleReadOnce(res: unknown) {
  const base = fetchMock.getMockImplementation() as (url: string, init?: RequestInit) => Promise<unknown>
  let used = false
  fetchMock.mockImplementation(async (url: string, init: RequestInit = {}) => {
    if (!used && String(url).split('?')[0] === PEOPLE && (init.method ?? 'GET') === 'GET') { used = true; return res }
    return base(url, init)
  })
}

describe('More › Staff › People (our own list)', () => {
  it('shows who works here with contacts and calendar link status; people who left are folded away', async () => {
    renderSheet(<PeoplePanel />)
    const working = await screen.findByRole('list', { name: 'Working here' })
    const items = within(working).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('Catherine Goodell')
    expect(items[0]).toHaveTextContent('Owner')
    expect(items[0]).toHaveTextContent('No phone saved · No email saved')
    expect(items[1]).toHaveTextContent('(256) 555-0199 · jess@example.com')
    expect(items[1]).toHaveTextContent(/Has a calendar link · a phone last checked it/)
    expect(within(items[1]).getByRole('link', { name: /Call Jessica/ })).toHaveAttribute('href', 'tel:+12565550199')
    expect(screen.getByText('No longer working here (1)')).toBeInTheDocument()
  })

  it('Add someone: the form posts, and a refusal shows its sentence on the field', async () => {
    const { dirty } = renderSheet(<PeoplePanel />)
    fireEvent.click(await screen.findByRole('button', { name: '+ Add someone' }))
    const form = screen.getByRole('group', { name: 'Add someone' })
    fireEvent.change(within(form).getByLabelText('First name'), { target: { value: 'Sam' } })
    fireEvent.change(within(form).getByLabelText('Mobile phone (for shift texts)'), { target: { value: '12' } })
    expect(dirty()).toBe(true)
    fetchMock.mockResolvedValueOnce(refuse(400, { error: 'Check the phone number: 10 digits, like 256-555-0123.', field: 'phone' }))
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }))
    expect(await within(form).findByRole('alert')).toHaveTextContent('Check the phone number')
    expect(within(form).getByLabelText('Mobile phone (for shift texts)')).toHaveAttribute('aria-invalid', 'true')
    expect(bodies(fetchMock, PEOPLE)[0].body).toEqual({ action: 'add', givenName: 'Sam', familyName: '', role: 'crew', phone: '12', email: '' })
    fireEvent.change(within(form).getByLabelText('Mobile phone (for shift texts)'), { target: { value: '256-555-0111' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Sam is on the staff list.')).toBeInTheDocument()
  })

  it('Edit sends what the screen showed (expectedUpdatedAt)', async () => {
    renderSheet(<PeoplePanel />)
    const working = await screen.findByRole('list', { name: 'Working here' })
    fireEvent.click(within(within(working).getAllByRole('listitem')[1]).getByRole('button', { name: 'Edit' }))
    const form = screen.getByRole('group', { name: 'Edit Jessica Lane' })
    expect(within(form).getByLabelText('Mobile phone (for shift texts)')).toHaveValue('(256) 555-0199')
    fireEvent.change(within(form).getByLabelText('Email (for shift emails)'), { target: { value: 'j2@example.com' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Saved.')).toBeInTheDocument()
    expect(bodies(fetchMock, PEOPLE)[0].body).toMatchObject({ action: 'edit', id: 'TM2', email: 'j2@example.com', expectedUpdatedAt: 'u1' })
  })

  it('No longer working here asks in the sheet first and says what happens; the warning about shifts is in the toast', async () => {
    renderSheet(<PeoplePanel />)
    const working = await screen.findByRole('list', { name: 'Working here' })
    const jess = within(working).getAllByRole('listitem')[1]
    fireEvent.click(within(jess).getByRole('button', { name: 'No longer working here' }))
    const ask = within(jess).getByRole('group', { name: 'Jessica no longer works here?' })
    expect(ask).toHaveTextContent('calendar link stops')
    expect(ask).toHaveTextContent('Jessica is signed out of /staff')
    expect(ask).toHaveTextContent('If Jessica knows the staff passcode, change it below too.')
    expect(bodies(fetchMock, PEOPLE)).toHaveLength(0)
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { person: { ...LIST[1], active: false } }, warning: 'Jessica is still on one class or party coming up.' }) })
    fireEvent.click(within(ask).getByRole('button', { name: 'Yes, no longer here' }))
    expect(await screen.findByText('Jessica is no longer on the staff list. Jessica is still on one class or party coming up.')).toBeInTheDocument()
    expect(bodies(fetchMock, PEOPLE)[0].body).toEqual({ action: 'leave', id: 'TM2' })
  })

  it('M2: taking an owner off asks “Change the admin passcode now?” in the same sheet; Change it now shows the form and saves it', async () => {
    const ADMIN_ACCESS = '/api/admin/admin-access.json'
    const owners = [LIST[0], p('TM1', 'Kaden', { role: 'owner', familyName: 'Goodell' }), LIST[1]]
    const base = fetchMock.getMockImplementation() as (url: string, init?: RequestInit) => Promise<unknown>
    fetchMock.mockImplementation(async (url: string, init: RequestInit = {}) => {
      const path = String(url).split('?')[0]
      if (path === PEOPLE && (init.method ?? 'GET') === 'GET') return ok({ data: { people: owners, saved: true, startedFrom: 'square' } })
      if (path === PEOPLE) return ok({ data: { person: { ...owners[1], active: false } } })
      if (path === ADMIN_ACCESS && (init.method ?? 'GET') === 'GET') return ok({ data: { setInAdmin: true, updatedAt: '2026-11-01T15:00:00.000Z', by: 'Kaden', damaged: false, settingTookOver: false, readOnly: false, min: 8, owners: [], ownerSource: 'staff-list' } })
      if (path === ADMIN_ACCESS) return ok({ data: { updatedAt: '2026-11-02T15:00:00.000Z' } })
      return base(url, init)
    })
    renderSheet(<PeoplePanel />)
    const working = await screen.findByRole('list', { name: 'Working here' })
    const kaden = within(working).getAllByRole('listitem')[1]
    fireEvent.click(within(kaden).getByRole('button', { name: 'No longer working here' }))
    fireEvent.click(within(within(kaden).getByRole('group')).getByRole('button', { name: 'Yes, no longer here' }))
    const prompt = await screen.findByRole('group', { name: 'Change the admin passcode now?' })
    expect(prompt).toHaveTextContent('Kaden’s phone may still be signed in to /admin.')
    fireEvent.click(within(prompt).getByRole('button', { name: 'Change it now' }))
    const form = await within(prompt).findByRole('group', { name: 'Change the admin passcode' })
    fireEvent.change(within(form).getByLabelText('Passcode you use now'), { target: { value: 'old-pass-1' } })
    fireEvent.change(within(form).getByLabelText('New passcode'), { target: { value: 'new-pass-22' } })
    fireEvent.change(within(form).getByLabelText('New passcode again'), { target: { value: 'new-pass-22' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save new admin passcode' }))
    expect(await screen.findByText(/The admin passcode is changed\..*Check More › Admin access and Notifications for anything you didn’t change\./)).toBeInTheDocument()
    expect(bodies(fetchMock, ADMIN_ACCESS)[0].body).toEqual({ current: 'old-pass-1', passcode: 'new-pass-22', again: 'new-pass-22', expectedUpdatedAt: '2026-11-01T15:00:00.000Z' })
    expect(screen.queryByRole('group', { name: 'Change the admin passcode now?' })).not.toBeInTheDocument()
  })

  it('M2: Not now closes the question; taking crew off never asks', async () => {
    renderSheet(<PeoplePanel />)
    const working = await screen.findByRole('list', { name: 'Working here' })
    const jess = within(working).getAllByRole('listitem')[1]
    fireEvent.click(within(jess).getByRole('button', { name: 'No longer working here' }))
    fireEvent.click(within(within(jess).getByRole('group')).getByRole('button', { name: 'Yes, no longer here' }))
    await screen.findByText('Jessica is no longer on the staff list.')
    expect(screen.queryByRole('group', { name: 'Change the admin passcode now?' })).not.toBeInTheDocument()
  })

  it('M2: editing an owner to Crew asks too, and Not now closes it', async () => {
    renderSheet(<PeoplePanel />)
    const working = await screen.findByRole('list', { name: 'Working here' })
    const cat = within(working).getAllByRole('listitem')[0]
    fireEvent.click(within(cat).getByRole('button', { name: 'Edit' }))
    fireEvent.click(within(cat).getByRole('button', { name: 'Crew' }))
    fireEvent.click(within(cat).getByRole('button', { name: /^Save/ }))
    const prompt = await screen.findByRole('group', { name: 'Change the admin passcode now?' })
    expect(prompt).toHaveTextContent('Catherine’s phone may still be signed in to /admin.')
    fireEvent.click(within(prompt).getByRole('button', { name: 'Not now' }))
    expect(screen.queryByRole('group', { name: 'Change the admin passcode now?' })).not.toBeInTheDocument()
  })

  it('Stop their calendar link asks in the sheet first, then stops only that person’s link', async () => {
    renderSheet(<PeoplePanel />)
    const working = await screen.findByRole('list', { name: 'Working here' })
    const jess = within(working).getAllByRole('listitem')[1]
    expect(within(within(working).getAllByRole('listitem')[0]).queryByRole('button', { name: 'Stop their calendar link' })).toBeNull()
    fireEvent.click(within(jess).getByRole('button', { name: 'Stop their calendar link' }))
    const ask = within(jess).getByRole('group', { name: 'Stop Jessica’s calendar link?' })
    fireEvent.click(within(ask).getByRole('button', { name: 'Keep it' }))
    expect(bodies(fetchMock, FEED, 'DELETE')).toHaveLength(0)
    fireEvent.click(within(jess).getByRole('button', { name: 'Stop their calendar link' }))
    fireEvent.click(within(jess).getByRole('button', { name: 'Yes, stop it' }))
    expect(await screen.findByText(/Jessica’s calendar link is stopped/)).toBeInTheDocument()
    expect(bodies(fetchMock, FEED, 'DELETE')[0].body).toEqual({ staffId: 'TM2' })
  })

  it('Working here again brings someone back', async () => {
    renderSheet(<PeoplePanel />)
    fireEvent.click(await screen.findByText('No longer working here (1)'))
    fireEvent.click(screen.getByRole('button', { name: 'Working here again' }))
    expect(await screen.findByText('Ava is working here again.')).toBeInTheDocument()
    expect(bodies(fetchMock, PEOPLE)[0].body).toEqual({ action: 'return', id: 'TM8' })
  })

  it('one failed set-up only offers Try again (a short blip never costs the links)', async () => {
    peopleReadOnce(refuse(503, { error: 'We couldn’t set up the staff list yet. Try again in a minute.', canStartFresh: false }))
    renderSheet(<PeoplePanel />)
    expect(await screen.findByText('We couldn’t set up the staff list yet. Try again in a minute.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start the list with just the owners' })).toBeNull()
  })

  it('after it has kept failing: Try again, and a way to start it with just the owners, with what won’t carry over', async () => {
    peopleReadOnce(refuse(503, { error: 'We couldn’t set up the staff list yet. Try again in a minute.', canStartFresh: true }))
    renderSheet(<PeoplePanel />)
    expect(await screen.findByText('We couldn’t set up the staff list yet. Try again in a minute.')).toBeInTheDocument()
    expect(screen.getByText(/won’t carry over to the new list/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Start the list with just the owners' }))
    fetchMock.mockResolvedValueOnce(ok({ data: { people: [] } }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, start it' }))
    expect(await screen.findByText('The staff list is started. Add everyone else with Add someone.')).toBeInTheDocument()
    expect(bodies(fetchMock, PEOPLE)[0].body).toEqual({ action: 'start-fresh' })
  })
})

describe('Staff passcode', () => {
  it('Change the staff passcode: typed twice, never shown back, says everyone needs the new one', async () => {
    renderSheet(<PeoplePanel />)
    const panel = await screen.findByRole('region', { name: 'Staff passcode' })
    expect(await within(panel).findByText(/everyone types to sign in to \/staff/)).toBeInTheDocument()
    fireEvent.click(within(panel).getByRole('button', { name: 'Change the staff passcode' }))
    const form = within(panel).getByRole('group', { name: 'Change the staff passcode' })
    expect(form).toHaveTextContent('Everyone on the iPad will need the new passcode.')
    fireEvent.change(within(form).getByLabelText('New passcode'), { target: { value: 'door-4821' } })
    fireEvent.change(within(form).getByLabelText('Type it again'), { target: { value: 'door-4821' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save new passcode' }))
    expect(await screen.findByText('The staff passcode is changed. Everyone on the iPad will need the new passcode.')).toBeInTheDocument()
    expect(bodies(fetchMock, PASSCODE)[0].body).toEqual({ passcode: 'door-4821', again: 'door-4821', expectedUpdatedAt: null })
    expect(screen.queryByDisplayValue('door-4821')).toBeNull()
  })

  it('a refusal shows its sentence in the form', async () => {
    renderSheet(<PeoplePanel />)
    const panel = await screen.findByRole('region', { name: 'Staff passcode' })
    fireEvent.click(await within(panel).findByRole('button', { name: 'Change the staff passcode' }))
    fetchMock.mockResolvedValueOnce(refuse(400, { error: 'The two passcodes don’t match. Type the same one twice.' }))
    fireEvent.click(within(panel).getByRole('button', { name: 'Save new passcode' }))
    expect(await within(panel).findByRole('alert')).toHaveTextContent('The two passcodes don’t match.')
  })

  it('a test site sharing the live stores cannot change it', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      const path = String(url).split('?')[0]
      if (path === PEOPLE) return ok({ data: { people: LIST, saved: true, startedFrom: 'square' } })
      if (path === PASSCODE) return ok({ data: { setInAdmin: true, updatedAt: '2026-11-01T15:00:00.000Z', by: 'Catherine', readOnly: true } })
      throw new Error(`unexpected ${url}`)
    })
    renderSheet(<PeoplePanel />)
    const panel = await screen.findByRole('region', { name: 'Staff passcode' })
    expect(await within(panel).findByText(/Changed here by Catherine/)).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'Change the staff passcode' })).toBeDisabled()
  })
})

describe('Staff passcode is always reachable (S2) and test sites are plain (m6)', () => {
  it('when the staff list can’t be read, the passcode panel is still there and still saves', async () => {
    peopleReadOnce(refuse(503, { error: 'We couldn’t set up the staff list yet. Try again in a minute.', canStartFresh: false }))
    renderSheet(<PeoplePanel />)
    expect(await screen.findByText('We couldn’t set up the staff list yet. Try again in a minute.')).toBeInTheDocument()
    const panel = screen.getByRole('region', { name: 'Staff passcode' })
    fireEvent.click(await within(panel).findByRole('button', { name: 'Change the staff passcode' }))
    const form = within(panel).getByRole('group', { name: 'Change the staff passcode' })
    expect(form).toHaveTextContent('Use at least 6 letters or numbers.')
    fireEvent.change(within(form).getByLabelText('New passcode'), { target: { value: 'door-4821' } })
    fireEvent.change(within(form).getByLabelText('Type it again'), { target: { value: 'door-4821' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save new passcode' }))
    expect(await screen.findByText('The staff passcode is changed. Everyone on the iPad will need the new passcode.')).toBeInTheDocument()
    expect(bodies(fetchMock, PASSCODE)).toHaveLength(1)
  })

  it('while the staff list is still loading, the passcode panel shows, and keeps what was typed when the list arrives', async () => {
    let release: (v: unknown) => void = () => {}
    const base = fetchMock.getMockImplementation() as (url: string, init?: RequestInit) => Promise<unknown>
    fetchMock.mockImplementation(async (url: string, init: RequestInit = {}) => {
      if (String(url).split('?')[0] === PEOPLE && (init.method ?? 'GET') === 'GET') return new Promise((r) => { release = r })
      return base(url, init)
    })
    renderSheet(<PeoplePanel />)
    const panel = await screen.findByRole('region', { name: 'Staff passcode' })
    fireEvent.click(await within(panel).findByRole('button', { name: 'Change the staff passcode' }))
    fireEvent.change(within(panel).getByLabelText('New passcode'), { target: { value: 'door-4821' } })
    release(ok({ data: { people: LIST, saved: true, startedFrom: 'square' } }))
    await screen.findByRole('list', { name: 'Working here' })
    expect(screen.getByLabelText('New passcode')).toHaveValue('door-4821')
  })

  it('a damaged saved passcode says nobody can sign in, and saving a new one sends no date (it repairs it)', async () => {
    const base = fetchMock.getMockImplementation() as (url: string, init?: RequestInit) => Promise<unknown>
    fetchMock.mockImplementation(async (url: string, init: RequestInit = {}) => {
      if (String(url).split('?')[0] === PASSCODE && (init.method ?? 'GET') === 'GET') return ok({ data: { setInAdmin: true, updatedAt: null, by: null, damaged: true, readOnly: false } })
      return base(url, init)
    })
    renderSheet(<PeoplePanel />)
    const panel = await screen.findByRole('region', { name: 'Staff passcode' })
    expect(await within(panel).findByText('The saved staff passcode can’t be read, so nobody can sign in to /staff. Set a new one below to fix it.')).toBeInTheDocument()
    fireEvent.click(within(panel).getByRole('button', { name: 'Change the staff passcode' }))
    fireEvent.change(within(panel).getByLabelText('New passcode'), { target: { value: 'door-4821' } })
    fireEvent.change(within(panel).getByLabelText('Type it again'), { target: { value: 'door-4821' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Save new passcode' }))
    await screen.findByText('The staff passcode is changed. Everyone on the iPad will need the new passcode.')
    expect(bodies(fetchMock, PASSCODE)[0].body.expectedUpdatedAt).toBeNull()
  })

  it('opened from Home: the passcode form is already open', async () => {
    renderSheet(<PeoplePanel focusPasscode />)
    const panel = await screen.findByRole('region', { name: 'Staff passcode' })
    expect(await within(panel).findByRole('group', { name: 'Change the staff passcode' })).toBeInTheDocument()
  })

  it('on a test site sharing the live stores, every change button is off and it says why', async () => {
    const base = fetchMock.getMockImplementation() as (url: string, init?: RequestInit) => Promise<unknown>
    fetchMock.mockImplementation(async (url: string, init: RequestInit = {}) => {
      if (String(url).split('?')[0] === PEOPLE && (init.method ?? 'GET') === 'GET') return ok({ data: { people: LIST, saved: true, startedFrom: 'square', readOnly: true } })
      return base(url, init)
    })
    renderSheet(<PeoplePanel />)
    expect(await screen.findByText('This is a test site, and it shares the live staff list. So nothing on the list can be changed here. Make changes on the live site.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ Add someone' })).toBeDisabled()
    for (const b of screen.getAllByRole('button', { name: 'Edit' })) expect(b).toBeDisabled()
    for (const b of screen.getAllByRole('button', { name: 'No longer working here' })) expect(b).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Stop their calendar link' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Working here again' })).toBeDisabled()
  })
})

describe('Home › staff passcode line', () => {
  const home = (data: Record<string, unknown>) => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).split('?')[0] === PASSCODE) return ok({ data: { setInAdmin: true, updatedAt: '2026-11-01T15:00:00.000Z', by: 'Catherine', readOnly: false, failedToday: 0, manyFailed: false, damaged: false, ...data } })
      throw new Error(`unexpected ${url}`)
    })
  }

  it('lots of wrong passcodes today: says so, with a button that opens More › Staff › People on the passcode', async () => {
    home({ failedToday: 31, manyFailed: true })
    const onOpen = vi.fn()
    renderSheet(<HomePasscodeAlert onOpen={onOpen} />)
    expect(await screen.findByText('Lots of wrong staff passcodes today — change it in More › Staff › People')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Change the staff passcode' }))
    expect(onOpen).toHaveBeenCalledWith({ kind: 'more', page: 'staff' }, { part: 'people', passcode: true })
  })

  it('a damaged passcode: nobody can sign in, Set a new staff passcode', async () => {
    home({ damaged: true, updatedAt: null, by: null })
    renderSheet(<HomePasscodeAlert onOpen={vi.fn()} />)
    expect(await screen.findByText('The staff passcode can’t be read, so nobody can sign in to /staff. Set a new one in More › Staff › People.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Set a new staff passcode' })).toBeInTheDocument()
  })

  it('says nothing when all is well', async () => {
    home({})
    const { container } = renderSheet(<HomePasscodeAlert onOpen={vi.fn()} />)
    await new Promise((r) => setTimeout(r, 20))
    expect(container.querySelector('[aria-label="Staff passcode"]')).toBeNull()
  })
})

describe('Home › Staffing', () => {
  const line = (over: Record<string, unknown>) => ({ eventKind: 'workshop', eventId: 'cls_a', when: '2031-03-12T15:00:00.000Z', title: 'Potholder Looms', ...over })
  it('each line has its button: Put someone on, Call / Text, Take off; nothing tells anyone for her', async () => {
    const onOpen = vi.fn()
    fetchMock.mockImplementation(async (url: string, init: RequestInit = {}) => {
      if (String(url) === `${STAFFING}?lines=1`) {
        return ok({
          data: {
            contacts: { TM2: { phone: '+12565550199', email: null } },
            lines: [
              line({ code: 'unstaffed', detail: 'Potholder Looms at 10 AM has no one on yet.', action: 'Assign someone in /admin › More › Staff.', staff: { key: 'ses:a', openHref: '#class-cls_a', people: [] } }),
              line({ code: 'assigned-cant', detail: 'Jessica is on Weaving at 1 PM but marked that time as Can\'t.', action: 'Check with Jessica.', staff: { key: 'ses:b', openHref: '#class-cls_b', people: [{ staffId: 'TM2', name: 'Jessica' }] } }),
              line({ code: 'assigned-cancelled', when: '', detail: 'Jessica is still on Clay, which was cancelled.', action: 'Tell Jessica, then take Jessica off in /admin.', staff: { key: 'ses:c', openHref: null, people: [{ staffId: 'TM2', name: 'Jessica' }] } }),
            ],
          },
        })
      }
      if (init.method === 'POST') return ok({ data: { row: null, entry: {} } })
      throw new Error(`unexpected ${url}`)
    })
    renderSheet(<HomeStaffing onOpen={onOpen} />)
    const list = await screen.findByRole('list', { name: 'Staffing' })
    const items = within(list).getAllByRole('listitem')
    // someone to tell first
    expect(items[0]).toHaveTextContent('Jessica is still on Clay, which was cancelled. Tell Jessica, then take Jessica off.')
    expect(items[0]).not.toHaveTextContent('/admin')
    expect(items[1]).toHaveTextContent('Check with Jessica.')
    expect(within(items[1]).getByRole('link', { name: /Text Jessica/ })).toHaveAttribute('href', 'sms:+12565550199')
    expect(items[2]).toHaveTextContent('Potholder Looms at 10 AM has no one on yet.')
    expect(items[2]).not.toHaveTextContent('/admin')
    fireEvent.click(within(items[2]).getByRole('button', { name: 'Put someone on' }))
    expect(onOpen).toHaveBeenCalledWith({ kind: 'class', id: 'cls_a' }, { staffKey: 'ses:a' })
    fireEvent.click(within(items[0]).getByRole('button', { name: 'Take Jessica off' }))
    expect(await screen.findByText('Jessica is off it.')).toBeInTheDocument()
    expect(bodies(fetchMock, STAFFING)[0].body).toEqual({ action: 'unassign', staffId: 'TM2', tell: false, key: 'ses:c' })
  })

  it('someone who left with no phone: says they no longer work here, never "add one in People"', async () => {
    fetchMock.mockImplementation(async () => ok({ data: {
      contacts: { TM8: { phone: null, email: null, left: true } },
      lines: [line({ code: 'assigned-cancelled', when: '', detail: 'Ava is still on Clay, which was cancelled.', action: 'Tell Ava, then take Ava off.', staff: { key: 'ses:c', openHref: null, people: [{ staffId: 'TM8', name: 'Ava' }] } })],
    } }))
    renderSheet(<HomeStaffing onOpen={() => {}} />)
    expect(await screen.findByText('Ava no longer works here, and there’s no phone number saved for Ava.')).toBeInTheDocument()
    expect(screen.queryByText(/Add one in More/)).toBeNull()
  })

  it("staffing that couldn't be checked says so with Try again", async () => {
    fetchMock.mockImplementation(async () => ok({ data: { lines: [{ code: 'staffing-unreadable', eventKind: 'workshop', eventId: '', when: '2031-03-12T15:00:00.000Z', title: 'Staffing', detail: "Couldn't check staffing.", action: 'Open /admin › More › Staff to check.' }], contacts: {} } }))
    renderSheet(<HomeStaffing onOpen={() => {}} />)
    expect(await screen.findByText('Couldn’t check staffing.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})
