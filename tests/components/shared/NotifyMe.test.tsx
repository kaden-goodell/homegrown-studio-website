import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import NotifyMe from '@components/shared/NotifyMe'

function ok() {
  return { ok: true, status: 200, json: async () => ({ data: { ok: true } }) } as Response
}
function fail(status = 500) {
  return { ok: false, status, json: async () => ({ error: 'Signup failed' }) } as Response
}

describe('NotifyMe', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })
  afterEach(() => {
    delete (window as any).posthog
  })

  it('has one labelled email field that phones can autofill', () => {
    render(<NotifyMe interest="booking-opens" />)
    const input = screen.getByLabelText('Email address') as HTMLInputElement
    expect(input.type).toBe('email')
    expect(input.getAttribute('autocomplete')).toBe('email')
    expect(input.getAttribute('inputmode')).toBe('email')
    expect(input.name).toBe('email')
  })

  it('says how many emails the visitor will get', () => {
    render(<NotifyMe interest="booking-opens" />)
    expect(screen.getByText('One email. No mailing list unless you ask for it.')).toBeInTheDocument()
  })

  it('never disables the button while it waits for input', () => {
    render(<NotifyMe interest="booking-opens" />)
    expect(screen.getByRole('button', { name: 'Tell me when it opens' })).not.toBeDisabled()
  })

  it('explains a bad email beside the field and sends nothing', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    render(<NotifyMe interest="booking-opens" />)
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'ada@' } })
    fireEvent.click(screen.getByRole('button', { name: 'Tell me when it opens' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('That email doesn’t look right. Check for typos.')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Email address')).toHaveAttribute('aria-invalid', 'true')
  })

  it('asks for an email when the field is empty', async () => {
    render(<NotifyMe interest="booking-opens" />)
    fireEvent.click(screen.getByRole('button', { name: 'Tell me when it opens' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Add your email so we can reach you.')
  })

  it('sends the email and what they were looking at, then confirms', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok())
    render(<NotifyMe interest="workshop:Kinusaiga 2026-10-16" successText="Got it. We’ll email you the day seats go on sale." />)
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: ' ada@example.com ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Tell me when it opens' }))

    expect(await screen.findByText('Got it. We’ll email you the day seats go on sale.')).toBeInTheDocument()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('/api/party/notify-me.json')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      email: 'ada@example.com',
      interest: 'workshop:Kinusaiga 2026-10-16',
    })
    expect(screen.queryByLabelText('Email address')).not.toBeInTheDocument()
  })

  it('records the sign-up in analytics', async () => {
    const capture = vi.fn()
    ;(window as any).posthog = { capture }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok())
    render(<NotifyMe interest="kits" />)
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'ada@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Tell me when it opens' }))
    await waitFor(() => expect(capture).toHaveBeenCalledWith('notify_me_signup', { interest: 'kits' }))
  })

  it('keeps what was typed and offers the phone number when saving fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(fail())
    render(<NotifyMe interest="booking-opens" />)
    const input = screen.getByLabelText('Email address') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'ada@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Tell me when it opens' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('We couldn’t save that.')
    expect(alert).toHaveTextContent('(256) 464-1710')
    expect(input.value).toBe('ada@example.com')
  })

  it('says so when the connection drops', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
    render(<NotifyMe interest="booking-opens" />)
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'ada@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Tell me when it opens' }))
    const alert = await screen.findByRole('alert')
    expect(alert).not.toHaveTextContent('Failed to fetch')
    expect(alert).toHaveTextContent('We couldn’t save that.')
  })

  it('explains a rate limit without blaming the visitor', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(fail(429))
    render(<NotifyMe interest="booking-opens" />)
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'ada@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Tell me when it opens' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Please try again in a few minutes.')
  })

  it('takes its own button label and note', () => {
    render(<NotifyMe interest="kits" buttonLabel="Tell me when kits launch" note="One email when kits are ready." />)
    expect(screen.getByRole('button', { name: 'Tell me when kits launch' })).toBeInTheDocument()
    expect(screen.getByText('One email when kits are ready.')).toBeInTheDocument()
  })
})
