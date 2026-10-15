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
})
