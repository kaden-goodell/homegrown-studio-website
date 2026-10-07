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
  fireEvent.click(container.querySelector('#wv-age') as HTMLInputElement)
  set('wv-em-name', 'Bob Rivera')
  set('wv-em-phone', '2565559999')
  fireEvent.click(screen.getByText(waiverContent.form.photoNo))
  // The assent box is the LAST checkbox (an event form has "who's coming" boxes before it).
  fireEvent.click(Array.from(container.querySelectorAll('input[type="checkbox"]')).at(-1)!)
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

  describe('lighter form (Oct 2026): age tick, optional emergency contact, photo default', () => {
    const submit = () => screen.getByText(waiverContent.form.submitLabel) as HTMLButtonElement

    it('has no adult date-of-birth field; the "19 or older" tick is required instead', () => {
      const { container } = render(<WaiverFlow kiosk returnTo="/staff" />)
      expect(container.querySelector('#wv-dob')).toBeNull()
      expect(screen.getByText(waiverContent.form.ageConfirmLabel)).toBeInTheDocument()
      fillMinimalForm(container)
      expect(submit().disabled).toBe(false)
      fireEvent.click(container.querySelector('#wv-age') as HTMLInputElement) // untick
      expect(submit().disabled).toBe(true)
      expect(submit().title).toMatch(/19 or older/)
    })

    it('emergency contact is name + phone only, optional on a plain visit, but never half-filled', () => {
      const { container } = render(<WaiverFlow kiosk returnTo="/staff" />)
      expect(container.querySelector('#wv-em-rel')).toBeNull()
      fillMinimalForm(container)
      const set = (id: string, value: string) => fireEvent.change(container.querySelector(`#${id}`) as HTMLInputElement, { target: { value } })
      set('wv-em-name', ''); set('wv-em-phone', '')
      expect(submit().disabled).toBe(false)
      set('wv-em-name', 'Bob')
      expect(submit().disabled).toBe(true)
      expect(submit().title).toMatch(/emergency contact phone/)
    })

    it('emergency contact is required for a drop-off event', () => {
      const { container } = render(<WaiverFlow kiosk partyId="p1" dropOff returnTo="/staff?open=party:p1" />)
      expect(screen.getByText(waiverContent.form.emergencyNoteDropOff)).toBeInTheDocument()
      fillMinimalForm(container)
      const set = (id: string, value: string) => fireEvent.change(container.querySelector(`#${id}`) as HTMLInputElement, { target: { value } })
      set('wv-em-name', ''); set('wv-em-phone', '')
      expect(submit().disabled).toBe(true)
      expect(submit().title).toMatch(/emergency contact name/)
    })

    it('photo consent defaults to yes and is sent as true without a tap', async () => {
      const fetchSpy = mockSignSuccess()
      const { container } = render(<WaiverFlow kiosk returnTo="/staff" />)
      const yes = screen.getByText(waiverContent.form.photoYes).closest('label')!.querySelector('input') as HTMLInputElement
      expect(yes.checked).toBe(true)
      fillMinimalForm(container)
      fireEvent.click(screen.getByText(waiverContent.form.photoYes)) // back to the default after the helper's "no"
      await act(async () => { fireEvent.click(submit()) })
      const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string)
      expect(body.photoConsent).toBe(true)
      expect(body.adult.ageConfirmed).toBe(true)
      expect(body.adult.dob).toBeUndefined()
      expect(body.emergency).toEqual({ name: 'Bob Rivera', phone: '2565559999' })
    })
  })

  describe('with an event (the door\'s "Sign on this iPad" from a roster)', () => {
    function stubReturn() {
      const replaceSpy = vi.fn()
      const replaceStateSpy = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {})
      Object.defineProperty(window, 'location', { value: { ...window.location, replace: replaceSpy }, writable: true })
      return { replaceSpy, replaceStateSpy }
    }

    it('still skips the lookup, and asks who\'s coming (workshop, not just party)', () => {
      render(<WaiverFlow kiosk workshopId="cs-1" eventTitle="Slime Night · Fri 6:00 PM CT" returnTo="/staff?open=workshop:cs-1" />)
      expect(screen.queryByText('Been here before?')).not.toBeInTheDocument()
      expect(screen.getByText('Who’s making a craft?')).toBeInTheDocument()
      expect(screen.getByText('Slime Night · Fri 6:00 PM CT')).toBeInTheDocument()
    })

    it('drop-off event: the form has the medications + may-NOT-collect fields', () => {
      render(<WaiverFlow kiosk partyId="p1" dropOff returnTo="/staff?open=party:p1" />)
      expect(screen.getByText(/Anyone who may NOT collect your child/)).toBeInTheDocument()
      expect(screen.getByText('Who’s making a craft?')).toBeInTheDocument()
    })

    it('non-drop-off event: no pickup fields', () => {
      render(<WaiverFlow kiosk partyId="p1" dropOff={false} returnTo="/staff?open=party:p1" />)
      expect(screen.queryByText(/Anyone who may NOT collect your child/)).not.toBeInTheDocument()
    })

    it('signing sends the event with who is coming, shows the same done screen, and hands back to the roster', async () => {
      const fetchSpy = mockSignSuccess()
      const { replaceSpy, replaceStateSpy } = stubReturn()
      const { container } = render(<WaiverFlow kiosk partyId="p1" partyLabel="Rivera Party" returnTo="/staff?open=party:p1" />)
      fillMinimalForm(container)
      await act(async () => { fireEvent.click(screen.getByText(waiverContent.form.submitLabel)) })

      await screen.findByText('Done — hand the iPad back')
      const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string)
      expect(body.partyId).toBe('p1')
      expect(body.attending).toEqual(['adult'])

      fireEvent.click(screen.getByText('Done'))
      expect(replaceStateSpy).toHaveBeenCalledWith(null, '', '/staff?open=party:p1')
      expect(replaceSpy).toHaveBeenCalledWith('/staff?open=party:p1')
    })

    it('blocks Submit until at least one person is coming', async () => {
      const { container } = render(<WaiverFlow kiosk workshopId="cs-1" returnTo="/staff?open=workshop:cs-1" />)
      fillMinimalForm(container)
      fireEvent.click(screen.getByLabelText(/Sarah Rivera \(you\)/)) // untick the only person
      expect(screen.getByText(/Pick at least one person who’s coming/)).toBeInTheDocument()
    })
  })
})
