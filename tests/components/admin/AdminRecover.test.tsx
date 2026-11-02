// /admin/recover?t=… (audit B M3): opening only checks the link; saving uses it; the key leaves the address bar.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import AdminRecover from '@components/admin/AdminRecover'

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
const refuse = (code: number, body: unknown) => ({ ok: false, status: code, json: async () => body })
const TOKEN = 'a'.repeat(43)

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  history.replaceState(null, '', `/admin/recover?t=${TOKEN}`)
  fetchMock = vi.fn(async (_url: string, init: any) => {
    const body = JSON.parse(init.body)
    if (body.action === 'check') return ok({ data: { state: 'ok' } })
    return ok({ data: { ok: true } })
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { vi.unstubAllGlobals(); history.replaceState(null, '', '/') })

const actions = () => fetchMock.mock.calls.map((c) => JSON.parse(c[1].body))

describe('the recovery page', () => {
  it('takes the key out of the address bar, only checks the link on open, then saves a new passcode', async () => {
    render(<AdminRecover />)
    expect(window.location.search).toBe('')
    expect(window.location.pathname).toBe('/admin/recover')
    const form = await screen.findByRole('form', { name: 'Set a new admin passcode' })
    expect(actions()).toEqual([{ action: 'check', token: TOKEN }])
    fireEvent.change(screen.getByLabelText('New passcode'), { target: { value: 'fresh-start-9' } })
    fireEvent.change(screen.getByLabelText('New passcode again'), { target: { value: 'fresh-start-9' } })
    fireEvent.submit(form)
    expect(await screen.findByRole('status')).toHaveTextContent('The admin passcode is changed, and you’re signed in on this device.')
    expect(actions()[1]).toEqual({ action: 'use', token: TOKEN, passcode: 'fresh-start-9', again: 'fresh-start-9' })
    expect(screen.getByRole('link', { name: 'Go to /admin' })).toHaveAttribute('href', '/admin')
  })

  it('a used or expired link says so with the way to get a new one, and shows no form', async () => {
    fetchMock.mockImplementation(async () => ok({ data: { state: 'used', message: 'This link was already used. Go to /admin and tap “Forgot the passcode?” for a new one.' } }))
    render(<AdminRecover />)
    expect(await screen.findByRole('alert')).toHaveTextContent('This link was already used.')
    expect(screen.queryByLabelText('New passcode')).not.toBeInTheDocument()
  })

  it('a refused passcode shows the rule and keeps the form; a link that died meanwhile switches to the message', async () => {
    render(<AdminRecover />)
    const form = await screen.findByRole('form', { name: 'Set a new admin passcode' })
    fetchMock.mockImplementationOnce(async () => refuse(400, { error: 'Use at least 8 letters or numbers.' }))
    fireEvent.submit(form)
    expect(await screen.findByRole('alert')).toHaveTextContent('Use at least 8 letters or numbers.')
    expect(screen.getByLabelText('New passcode')).toBeInTheDocument()
    fetchMock.mockImplementationOnce(async () => refuse(410, { error: 'This link has run out (they work for 15 minutes).', state: 'expired' }))
    fireEvent.submit(form)
    expect(await screen.findByText(/This link has run out/)).toBeInTheDocument()
    expect(screen.queryByLabelText('New passcode')).not.toBeInTheDocument()
  })

  it('no key at all: says the link doesn’t work, without asking the server', async () => {
    history.replaceState(null, '', '/admin/recover')
    render(<AdminRecover />)
    expect(await screen.findByRole('alert')).toHaveTextContent('This link doesn’t work.')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
