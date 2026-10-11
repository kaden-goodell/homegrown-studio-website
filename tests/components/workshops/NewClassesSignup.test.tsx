import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import NewClassesSignup from '@components/workshops/NewClassesSignup'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('NewClassesSignup', () => {
  it('is one quiet line until tapped', () => {
    render(<NewClassesSignup />)
    expect(screen.getByText(/Not this one\?/)).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Get an email when new classes go up.' }))
    expect(screen.getByRole('textbox')).toBeTruthy()
    expect(screen.getByText('A short email when new classes are posted. Nothing else.')).toBeTruthy()
  })

  it('saves the email to the list and says so', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    render(<NewClassesSignup />)
    fireEvent.click(screen.getByRole('button', { name: /new classes/ }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'mom@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign me up' }))
    await waitFor(() => expect(screen.getByText('You’re on the list.')).toBeTruthy())
    expect(fetchMock).toHaveBeenCalledWith('/api/customer/subscribe.json', expect.objectContaining({ method: 'POST' }))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).email).toBe('mom@example.com')
  })

  it('catches a typo without sending', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(<NewClassesSignup />)
    fireEvent.click(screen.getByRole('button', { name: /new classes/ }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'mom@example' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign me up' }))
    expect(screen.getByRole('alert').textContent).toMatch(/doesn’t look right/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
