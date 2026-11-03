import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import EmailMeThisClass from '@components/workshops/EmailMeThisClass'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const props = { classId: 'clsschi_abc', className: 'Christmas Earring Bar' }
const openForm = () => fireEvent.click(screen.getByRole('button', { name: 'Email me this class.' }))

describe('EmailMeThisClass', () => {
  it('is one quiet line until tapped', () => {
    render(<EmailMeThisClass {...props} />)
    expect(screen.getByText(/Not ready to book\?/)).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
    openForm()
    expect(screen.getByRole('textbox')).toBeTruthy()
    const box = screen.getByRole('checkbox', { name: 'Also tell me when new classes go up' }) as HTMLInputElement
    expect(box.checked).toBe(false)
  })

  it('sends this class to the email and says so', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    render(<EmailMeThisClass {...props} />)
    openForm()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'mom@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send it' }))
    await waitFor(() => expect(screen.getByText('Sent. Check your inbox.')).toBeTruthy())
    expect(fetchMock).toHaveBeenCalledWith('/api/workshops/email-me.json', expect.objectContaining({ method: 'POST' }))
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toMatchObject({ email: 'mom@example.com', classId: 'clsschi_abc', alsoNews: false })
  })

  it('passes the new-classes box when ticked', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    render(<EmailMeThisClass {...props} />)
    openForm()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'mom@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send it' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).alsoNews).toBe(true)
  })

  it('catches a typo without sending', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(<EmailMeThisClass {...props} />)
    openForm()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'mom@example' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send it' }))
    expect(screen.getByRole('alert').textContent).toMatch(/doesn’t look right/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows the server’s words when it says slow down, and keeps the form', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({ error: 'We have already sent a few of these to that address today.' }) }))
    render(<EmailMeThisClass {...props} />)
    openForm()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'mom@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send it' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/already sent a few/))
    expect(screen.getByRole('textbox')).toBeTruthy()
  })

  it('never claims it sent when it did not', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => ({}) }))
    render(<EmailMeThisClass {...props} />)
    openForm()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'mom@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send it' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/couldn’t send/))
    expect(screen.queryByText('Sent. Check your inbox.')).toBeNull()
  })
})
