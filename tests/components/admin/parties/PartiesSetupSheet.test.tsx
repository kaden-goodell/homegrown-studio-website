import { describe, it, expect, afterEach, vi } from 'vitest'
import { screen, fireEvent, waitFor, within } from '@testing-library/react'
import { PartiesSetupSheet } from '@components/admin/parties/PartiesSetupSheet'
import { renderSheet, posts, at } from '../sheets/harness'
import { CRAFTS, partyServer, settings } from './fixtures'

afterEach(() => vi.unstubAllGlobals())
const URL_ = '/api/admin/parties/settings.json'

function server(post: any, legacy: any = { count: 0, lastIso: null }) {
  return partyServer({
    [URL_]: (body) => (body ? post(body) : { body: { data: { settings: settings(), legacyRemaining: legacy } } }),
    '/api/party/service-info.json': { body: { data: { crafts: CRAFTS } } },
  })
}

describe('Parties setup', () => {
  it('shows the days and times, the package, the extras and the crafts', async () => {
    server(() => ({ body: {} }))
    renderSheet(<PartiesSetupSheet />)
    const fri = await screen.findByRole('group', { name: 'Fridays' })
    expect(within(fri).getByRole('button', { name: /Remove 4:30\sPM on Fridays/ })).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: 'Mondays' })).getByText('No parties')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Whole studio')).toBeInTheDocument()
    expect(screen.getByDisplayValue('300')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Extra half hour')).toBeInTheDocument()
    expect(await screen.findByText('$18 a guest')).toBeInTheDocument()
  })

  it('adds a start time, saves it with the loaded time, says so, and lists parties that stay booked', async () => {
    const saved = settings({ updatedAt: '2031-01-02T00:00:00Z' })
    saved.times.weekly['5'] = ['16:30', '19:00']
    const f = server(() => ({ body: { data: { settings: saved, changed: ['Party times on Fridays'], booked: [{ partyId: 'pty_1', hostName: 'Ann Host', startIso: at('2031-03-14', '16:30'), label: 'Fri, Mar 14 at 4:30 PM' }], note: 'Anything already booked stays booked.' } } }))
    const { dirty } = renderSheet(<PartiesSetupSheet />)
    const fri = await screen.findByRole('group', { name: 'Fridays' })
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    fireEvent.click(within(fri).getByRole('button', { name: 'Add a party time on Fridays' }))
    fireEvent.change(within(fri).getByLabelText('Start time'), { target: { value: '19:00' } })
    fireEvent.click(within(fri).getByRole('button', { name: 'Add' }))
    expect(within(fri).getByRole('button', { name: /Remove 7\sPM on Fridays/ })).toBeInTheDocument()
    expect(dirty()).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Anything already booked stays booked.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Ann Host/ })).toBeInTheDocument()
    expect(screen.getByText(/^Saved\. New bookings use these\./)).toBeInTheDocument()
    const body = posts(f, URL_)[0].body
    expect(body.times.weekly['5']).toEqual(['16:30', '19:00'])
    expect(body.expectedUpdatedAt).toBe('2031-01-01T00:00:00Z')
    expect(body.packages[0]).not.toHaveProperty('_k')
    await waitFor(() => expect(dirty()).toBe(false))
  })

  it('someone else saved first: says so, keeps the page, and Reload shows theirs', async () => {
    const theirs = settings({ updatedAt: '2031-01-05T00:00:00Z' })
    theirs.times.weekly['4'] = ['17:00']
    server(() => ({ status: 409, body: { error: 'stale', stale: true, current: theirs } }))
    renderSheet(<PartiesSetupSheet />)
    const fri = await screen.findByRole('group', { name: 'Fridays' })
    fireEvent.click(within(fri).getByRole('button', { name: /Remove 4:30\sPM on Fridays/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Someone else saved Parties setup. Reload to see their changes.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(within(screen.getByRole('group', { name: 'Thursdays' })).getByRole('button', { name: /Remove 5\sPM on Thursdays/ })).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: 'Fridays' })).getByRole('button', { name: /Remove 4:30\sPM on Fridays/ })).toBeInTheDocument()
  })

  it('a refusal shows under the part it is about', async () => {
    server(() => ({ status: 400, body: { error: 'Party times on Fridays must start by 7 PM, so the party and its cleanup end by closing at 9 PM.', field: 'times.weekly.5' } }))
    renderSheet(<PartiesSetupSheet />)
    const fri = await screen.findByRole('group', { name: 'Fridays' })
    fireEvent.click(within(fri).getByRole('button', { name: 'Add a party time on Fridays' }))
    fireEvent.change(within(fri).getByLabelText('Start time'), { target: { value: '20:00' } })
    fireEvent.click(within(fri).getByRole('button', { name: 'Add' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await within(fri).findByText(/must start by 7 PM/)).toBeInTheDocument()
  })

  it('the Square switch can’t be turned off while parties booked in Square are still to come', async () => {
    server(() => ({ body: {} }), { count: 2, lastIso: at('2026-12-12', '13:00') })
    renderSheet(<PartiesSetupSheet />)
    const box = await screen.findByRole('checkbox', { name: 'Keep their times blocked on the calendar' })
    expect(box).toBeDisabled()
    expect(screen.getByText(/2 parties booked in Square are still to come, the last on Sat Dec 12/)).toBeInTheDocument()
  })

  it('with none left the switch can be turned off', async () => {
    server(() => ({ body: {} }))
    renderSheet(<PartiesSetupSheet />)
    const box = await screen.findByRole('checkbox', { name: 'Keep their times blocked on the calendar' })
    expect(box).toBeEnabled()
    fireEvent.click(box)
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it('a new package starts as only from here, and who can book is said in words', async () => {
    server(() => ({ body: {} }))
    renderSheet(<PartiesSetupSheet />)
    fireEvent.click(await screen.findByRole('button', { name: '+ Add a package' }))
    const box = screen.getByRole('group', { name: 'New package' })
    expect(within(box).getByRole('button', { name: 'Only from here' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(box).getByText(/Only you can book it, from here\./)).toBeInTheDocument()
  })
})
