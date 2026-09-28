import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import WaiverFlow from '@components/waiver/WaiverFlow'
import { waiverContent } from '@config/waiver-content'

function mockSignSuccess() {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({ data: { covered: ['Sarah Rivera'], validUntil: '2027-08-03T00:00:00.000Z' } }),
  } as Response)
}

/** Fills every field the full form requires to submit, using ids (several
 *  labels — "Phone", "Name" — are ambiguous between the adult and emergency
 *  sections, so ids are the reliable selector here). */
function fillMinimalForm(container: HTMLElement) {
  const set = (id: string, value: string) => {
    const el = container.querySelector(`#${id}`) as HTMLInputElement
    fireEvent.change(el, { target: { value } })
  }
  set('wv-first', 'Sarah')
  set('wv-last', 'Rivera')
  set('wv-email', 'sarah@example.com')
  set('wv-phone', '2565550142')
  set('wv-dob', '1990-01-01')
  set('wv-em-name', 'Bob Rivera')
  set('wv-em-phone', '2565559999')
  fireEvent.click(screen.getByText(waiverContent.form.photoNo))
  fireEvent.click(container.querySelector('input[type="checkbox"]')!)
  set('wv-signature', 'Sarah Rivera')
}

describe('WaiverFlow — kiosk mode (HOM-209)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('starts directly on the full form, skipping the returning-customer lookup', () => {
    render(<WaiverFlow kiosk returnTo="/staff" />)
    expect(screen.queryByText('Been here before?')).not.toBeInTheDocument()
    expect(screen.getByText(waiverContent.form.agreementHeading)).toBeInTheDocument()
  })

  it('shows the kiosk disclosure bar and autocomplete="off" on the form', () => {
    const { container } = render(<WaiverFlow kiosk returnTo="/staff" />)
    expect(screen.getByText(/your details are only saved to your agreement/i)).toBeInTheDocument()
    expect(container.querySelector('form')?.getAttribute('autocomplete')).toBe('off')
  })

  it('non-kiosk mode is unchanged — starts on the returning-customer lookup', () => {
    render(<WaiverFlow />)
    expect(screen.getByText('Been here before?')).toBeInTheDocument()
  })

  it('done screen shows "Done — hand the iPad back", the signer\'s first name, and no kid/RSVP details', async () => {
    mockSignSuccess()
    const { container } = render(<WaiverFlow kiosk returnTo="/staff" />)
    fillMinimalForm(container)

    await act(async () => {
      fireEvent.click(screen.getByText(waiverContent.form.submitLabel))
    })

    expect(await screen.findByText('Done — hand the iPad back')).toBeInTheDocument()
    expect(screen.getByText(/Thanks, Sarah/)).toBeInTheDocument()
    expect(screen.queryByText(waiverContent.confirmation.coversLabel)).not.toBeInTheDocument()
    expect(screen.queryByText('Sarah Rivera')).not.toBeInTheDocument() // no household/kid list
  })

  it('auto-returns after 20s via history.replaceState + location.replace', async () => {
    mockSignSuccess()
    const replaceSpy = vi.fn()
    const replaceStateSpy = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {})
    Object.defineProperty(window, 'location', {
      value: { ...window.location, replace: replaceSpy },
      writable: true,
    })

    const { container } = render(<WaiverFlow kiosk returnTo="/staff" />)
    fillMinimalForm(container)

    await act(async () => {
      fireEvent.click(screen.getByText(waiverContent.form.submitLabel))
    })
    await screen.findByText('Done — hand the iPad back')

    expect(replaceSpy).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000) })

    expect(replaceStateSpy).toHaveBeenCalledWith(null, '', '/staff')
    expect(replaceSpy).toHaveBeenCalledWith('/staff')
  })

  it('tapping Done returns immediately without waiting for the timer', async () => {
    mockSignSuccess()
    const replaceSpy = vi.fn()
    vi.spyOn(window.history, 'replaceState').mockImplementation(() => {})
    Object.defineProperty(window, 'location', {
      value: { ...window.location, replace: replaceSpy },
      writable: true,
    })

    const { container } = render(<WaiverFlow kiosk returnTo="/staff" />)
    fillMinimalForm(container)

    await act(async () => {
      fireEvent.click(screen.getByText(waiverContent.form.submitLabel))
    })
    await screen.findByText('Done — hand the iPad back')

    fireEvent.click(screen.getByText('Done'))
    expect(replaceSpy).toHaveBeenCalledWith('/staff')
  })
})
