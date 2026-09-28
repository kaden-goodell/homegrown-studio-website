import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import BookingPanel from '@components/shared/BookingPanel'

function stubMatchMedia(matching: string[] = []) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: matching.some((m) => query.includes(m)),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  )
}

function Flow({ onRequestClose = vi.fn(), withPrompt = false }: { onRequestClose?: () => void; withPrompt?: boolean }) {
  const [step, setStep] = useState(1)
  const [prompt, setPrompt] = useState(withPrompt)
  return (
    <BookingPanel
      title="Kinusaiga"
      onRequestClose={onRequestClose}
      stepKey={`step-${step}`}
      stepName={step === 1 ? 'Details' : 'Your details and payment'}
      stepNumber={step}
      stepCount={2}
      summary={<span>Fri, Oct 16 · 7–9 PM</span>}
      onBack={step > 1 ? () => setStep(1) : undefined}
      footer={
        <button type="button" className="btn btn-primary" onClick={() => setStep(2)}>
          Continue
        </button>
      }
      leavePrompt={
        prompt
          ? { title: 'Leave without booking?', body: 'Nothing has been saved.', onKeep: () => setPrompt(false), onLeave: vi.fn() }
          : null
      }
    >
      <input aria-label="A field" />
    </BookingPanel>
  )
}

describe('BookingPanel', () => {
  let page: HTMLElement
  beforeEach(() => {
    stubMatchMedia()
    // Stand-ins for the site behind the panel.
    page = document.createElement('div')
    page.innerHTML = '<header><a href="/book" id="site-link">Book a Party</a></header><button id="opener">Open</button>'
    document.body.appendChild(page)
  })
  afterEach(() => {
    cleanup()
    page.remove()
    vi.unstubAllGlobals()
  })

  it('is a dialog named by its title', () => {
    render(<Flow />)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleName('Kinusaiga')
  })

  it('sits at the end of the page body, above the site header', () => {
    render(<Flow />)
    const host = document.body.lastElementChild!
    expect(host).toHaveAttribute('data-booking-panel')
    expect(host).toContainElement(screen.getByRole('dialog'))
  })

  it('makes everything behind it unreachable while open, and gives it back on close', () => {
    const { unmount } = render(<Flow />)
    expect(page).toHaveAttribute('inert')
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(page).not.toHaveAttribute('inert')
    expect(document.body.style.overflow).toBe('')
  })

  it('leaves alone anything that was already inert', () => {
    page.setAttribute('inert', '')
    const { unmount } = render(<Flow />)
    unmount()
    expect(page).toHaveAttribute('inert')
  })

  it('returns focus to whatever opened it', () => {
    const opener = document.getElementById('opener')!
    opener.focus()
    const { unmount } = render(<Flow />)
    expect(screen.getByRole('dialog')).toHaveFocus()
    unmount()
    expect(opener).toHaveFocus()
  })

  it('shows the step, its number and what has been chosen', () => {
    render(<Flow />)
    expect(screen.getByText('Details')).toBeInTheDocument()
    expect(screen.getByText('Step 1 of 2')).toBeInTheDocument()
    expect(screen.getByText('Fri, Oct 16 · 7–9 PM')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1')
  })

  it('has no Back button on the first step', () => {
    render(<Flow />)
    expect(screen.queryByRole('button', { name: /Back/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByRole('button', { name: /Back/ })).toBeInTheDocument()
  })

  it('starts a new step at the top, with focus on the step heading', () => {
    render(<Flow />)
    const scroller = document.querySelector('.booking-panel-scroll') as HTMLElement
    scroller.scrollTop = 400
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(scroller.scrollTop).toBe(0)
    expect(screen.getByText('Your details and payment')).toHaveFocus()
  })

  it('gives Close and Back a 44px hit area', () => {
    render(<Flow />)
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    for (const name of ['Close', /Back/]) {
      expect(screen.getByRole('button', { name })).toHaveStyle({ minHeight: '2.75rem', minWidth: '2.75rem' })
    }
  })

  it('asks to close on Escape, on ×, and on a tap outside', () => {
    const onRequestClose = vi.fn()
    render(<Flow onRequestClose={onRequestClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.mouseDown(document.querySelector('.booking-panel-overlay')!)
    expect(onRequestClose).toHaveBeenCalledTimes(3)
  })

  it('does not close on a tap inside the panel', () => {
    const onRequestClose = vi.fn()
    render(<Flow onRequestClose={onRequestClose} />)
    fireEvent.mouseDown(screen.getByLabelText('A field'))
    expect(onRequestClose).not.toHaveBeenCalled()
  })

  it('keeps the keyboard inside the panel', () => {
    render(<Flow />)
    const close = screen.getByRole('button', { name: 'Close' })
    const last = screen.getByRole('button', { name: 'Continue' })
    // jsdom lays nothing out, so every element reports no offsetParent; give the controls one.
    for (const el of [close, screen.getByLabelText('A field'), last]) {
      Object.defineProperty(el, 'offsetParent', { configurable: true, get: () => document.body })
    }
    last.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(close).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(last).toHaveFocus()
  })

  describe('the leave prompt', () => {
    it('is an alert dialog with focus on the safe choice', () => {
      render(<Flow withPrompt />)
      expect(screen.getByRole('alertdialog')).toHaveAccessibleName('Leave without booking?')
      expect(screen.getByRole('button', { name: 'Keep booking' })).toHaveFocus()
    })

    it('Escape dismisses the prompt and keeps the booking', () => {
      const onRequestClose = vi.fn()
      render(<Flow withPrompt onRequestClose={onRequestClose} />)
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(screen.queryByRole('alertdialog')).toBeNull()
      expect(onRequestClose).not.toHaveBeenCalled()
    })
  })

  it('becomes a bottom sheet on a phone, no taller than the visible window', () => {
    stubMatchMedia(['max-width: 639px'])
    render(<Flow />)
    expect(screen.getByRole('dialog')).toHaveStyle({ maxHeight: '94dvh' })
  })

  it('does not animate when the visitor asked for less motion', () => {
    stubMatchMedia(['prefers-reduced-motion'])
    render(<Flow />)
    expect(screen.getByRole('progressbar')).toHaveStyle({ transition: 'none' })
  })
})
