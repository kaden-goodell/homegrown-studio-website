import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderSheet, ok, refuse, posts } from './harness'
import { AdminAccessSheet } from '@components/admin/sheets/OwnerSheets'

const ACCESS = '/api/admin/admin-access.json'

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
