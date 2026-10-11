import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import EmailCheck from '@components/shared/EmailCheck'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const ok = (data: Record<string, unknown>) => vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data }) })

describe('EmailCheck', () => {
  it('fixes a typo: the same confirmation goes to the right address', async () => {
    const fetchMock = ok({ email: 'meredithblackphotography@gmail.com', resent: true, token: 't2' })
    vi.stubGlobal('fetch', fetchMock)
    const onEmailChanged = vi.fn()
    render(<EmailCheck check={{ token: 't1', sentTo: 'meredithblackphptography@gmail.com', onFile: null }} onEmailChanged={onEmailChanged} />)
    expect(screen.getByText('meredithblackphptography@gmail.com')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Wrong email? Fix it' }))
    fireEvent.change(screen.getByLabelText('The right email'), { target: { value: 'meredithblackphotography@gmail.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send it there' }))
    await waitFor(() => expect(screen.getByText('Sent to meredithblackphotography@gmail.com.')).toBeTruthy())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ token: 't1', email: 'meredithblackphotography@gmail.com' })
    expect(onEmailChanged).toHaveBeenCalledWith('meredithblackphotography@gmail.com')
  })

  it('asks which email is right when Square has a near-identical one', async () => {
    const fetchMock = ok({ email: 'meredithblackphotography@gmail.com', resent: false, token: 't2' })
    vi.stubGlobal('fetch', fetchMock)
    render(<EmailCheck check={{ token: 't1', sentTo: 'meredithblackphptography@gmail.com', onFile: 'meredithblackphotography@gmail.com' }} />)
    expect(screen.getByText(/Which one is right\?/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Wrong email? Fix it' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'meredithblackphotography@gmail.com' }))
    await waitFor(() => expect(screen.getByText('Got it. We’ll use meredithblackphotography@gmail.com from now on.')).toBeTruthy())
  })

  it('says what went wrong and keeps the form', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'This link has expired.' }) }))
    render(<EmailCheck check={{ token: 't1', sentTo: 'a@b.com', onFile: null }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Wrong email? Fix it' }))
    fireEvent.change(screen.getByLabelText('The right email'), { target: { value: 'right@b.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send it there' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('This link has expired.'))
    expect(screen.getByLabelText('The right email')).toBeTruthy()
  })
})
