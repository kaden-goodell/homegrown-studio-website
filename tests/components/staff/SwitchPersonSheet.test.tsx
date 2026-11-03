import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import SwitchPersonSheet from '@components/staff/SwitchPersonSheet'

const TEAM = [{ id: 'a', name: 'Kaden', role: 'owner' }, { id: 'c', name: 'Ava', role: 'crew' }]
const ME = { id: 'a', name: 'Kaden', role: 'owner' } as const
afterEach(() => vi.unstubAllGlobals())

describe('SwitchPersonSheet', () => {
  it('lists the team, marks who is on now, and switches with one tap', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { staff: TEAM } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { staff: TEAM[1] } }) })
    vi.stubGlobal('fetch', fetchMock)
    const onSwitched = vi.fn()
    render(<SwitchPersonSheet current={ME} onClose={() => {}} onSwitched={onSwitched} onSignedOut={() => {}} />)
    expect(await screen.findByRole('button', { name: 'Kaden · you' })).toHaveAttribute('aria-current', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Ava' }))
    await waitFor(() => expect(onSwitched).toHaveBeenCalledWith(TEAM[1]))
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ staffId: 'c' })
  })
  it('tapping yourself just closes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { staff: TEAM } }) }))
    const onClose = vi.fn()
    render(<SwitchPersonSheet current={ME} onClose={onClose} onSwitched={() => {}} onSignedOut={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Kaden · you' }))
    expect(onClose).toHaveBeenCalled()
  })
  it('signed out meanwhile: goes to the passcode screen', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) }))
    const onSignedOut = vi.fn()
    render(<SwitchPersonSheet current={ME} onClose={() => {}} onSwitched={() => {}} onSignedOut={onSignedOut} />)
    await waitFor(() => expect(onSignedOut).toHaveBeenCalled())
  })
  it('Cancel closes without switching', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { staff: TEAM } }) }))
    const onClose = vi.fn()
    render(<SwitchPersonSheet current={ME} onClose={onClose} onSwitched={() => {}} onSignedOut={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
  })
  it('DV19: an owner is switched to only with the admin passcode, asked for right here', async () => {
    const team = [{ id: 'b', name: 'Catherine', role: 'owner' }, { id: 'c', name: 'Ava', role: 'crew' }]
    const ava = { id: 'c', name: 'Ava', role: 'crew' } as const
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { staff: team } }) })
      .mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ error: 'Incorrect passcode.', needsAdminPasscode: true }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { staff: team[0] } }) })
    vi.stubGlobal('fetch', fetchMock)
    const onSwitched = vi.fn()
    const onSignedOut = vi.fn()
    render(<SwitchPersonSheet current={ava} onClose={() => {}} onSwitched={onSwitched} onSignedOut={onSignedOut} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Catherine' }))
    // Nothing sent yet: the passcode is asked first.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const field = screen.getByLabelText('To switch to Catherine, enter the admin passcode.')
    fireEvent.change(field, { target: { value: 'wrong1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Switch to Catherine' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect passcode.')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ staffId: 'b', adminPasscode: 'wrong1' })
    expect(onSignedOut).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('To switch to Catherine, enter the admin passcode.'), { target: { value: 'right1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Switch to Catherine' }))
    await waitFor(() => expect(onSwitched).toHaveBeenCalledWith(team[0]))
  })
})
