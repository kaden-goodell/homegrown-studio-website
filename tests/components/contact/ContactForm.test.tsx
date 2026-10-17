import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ContactForm from '@components/contact/ContactForm'

afterEach(() => vi.unstubAllGlobals())
const fill = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })

describe('ContactForm (/contact)', () => {
  it('sends the message, then says thanks with no timeline', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { ok: true } }) })
    vi.stubGlobal('fetch', fetchMock)
    render(<ContactForm />)
    fill(/^Your name/, 'Dana Planner')
    fill(/^Email/, 'dana@example.com')
    fill(/^Phone/, '(256) 555-0142')
    fireEvent.click(screen.getByRole('button', { name: 'A party' }))
    fill(/^Your message/, 'Can we bring our own cake?')
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByText('Thanks, we got it.')).toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/contact/send.json')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ name: 'Dana Planner', email: 'dana@example.com', phone: '(256) 555-0142', topic: 'party', message: 'Can we bring our own cake?', company: '' })
  })

  it('shows the server’s message under the field it names', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Write your message.', field: 'message' }) }))
    render(<ContactForm />)
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByText('Write your message.')).toBeInTheDocument()
    expect(screen.getByLabelText(/^Your message/)).toHaveAttribute('aria-invalid', 'true')
  })
})
