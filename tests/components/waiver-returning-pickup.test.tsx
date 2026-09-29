/**
 * Returning-RSVP screen's compact "Who may pick up?" block (HOM-212 fix
 * round 1 addendum): an absent `pickupUpdate` must mean "no change" — never
 * sent when the block wasn't shown (hasPickup already true), and never sent
 * just because the block WAS shown but the guest left it blank.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import WaiverFlow from '@components/waiver/WaiverFlow'

// lookup.json returns the whole household directly — no code step.
function mockLookupThenSign(hasPickup: boolean) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
    const href = String(url)
    if (href.includes('/api/waiver/lookup.json')) {
      return {
        ok: true,
        json: async () => ({
          data: {
            found: true,
            recordId: 'wvr_1',
            reuseToken: 'tok-abc',
            firstName: 'Sarah',
            kids: ['Bo'],
            validUntil: '2099-01-01T00:00:00.000Z',
            signedAt: '2026-01-01T00:00:00.000Z',
            hasPickup,
          },
        }),
      } as Response
    }
    // sign.json — the RSVP submission
    return {
      ok: true,
      json: async () => ({ data: { covered: ['Sarah Rivera'], validUntil: '2027-01-01T00:00:00.000Z' } }),
    } as Response
  })
}

/** Type a contact and continue straight through to the returning screen. */
async function reachReturningScreen(container: HTMLElement) {
  const input = container.querySelector('input[placeholder="Email or phone"]') as HTMLInputElement
  fireEvent.change(input, { target: { value: 'sarah@example.com' } })
  await act(async () => {
    fireEvent.click(screen.getByText('Continue'))
  })
  await screen.findByText(/Welcome back, Sarah/)
}

function rsvpBody(fetchSpy: ReturnType<typeof vi.spyOn>): any {
  const signCall = fetchSpy.mock.calls.find(([url]: any[]) => String(url).includes('/api/waiver/sign.json'))
  return signCall ? JSON.parse(signCall[1]?.body as string) : null
}

describe('WaiverFlow — returning screen pickup block (HOM-212 fix round 1)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not render the block, and sends no pickupUpdate, when hasPickup is already true', async () => {
    const fetchSpy = mockLookupThenSign(true)
    const { container } = render(<WaiverFlow partyId="party-1" dropOff />)
    await reachReturningScreen(container)

    expect(screen.queryByText('Who may pick up?')).not.toBeInTheDocument()
    expect(screen.getByText('Pickup people are on file — tell the front desk if that changes.')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByText('✓ RSVP us'))
    })
    const body = rsvpBody(fetchSpy)
    expect(body).not.toBeNull()
    expect(body.pickupUpdate).toBeUndefined()
  })

  it('renders the block when hasPickup is false, but sends no pickupUpdate if left entirely blank', async () => {
    const fetchSpy = mockLookupThenSign(false)
    const { container } = render(<WaiverFlow partyId="party-1" dropOff />)
    await reachReturningScreen(container)

    expect(screen.getByText('Who may pick up?')).toBeInTheDocument()
    // F4: one empty row is rendered by default so the question has somewhere
    // to be answered — leaving it blank still sends no pickupUpdate.
    expect(screen.getByLabelText('Pickup person 1 name')).toHaveValue('')

    await act(async () => {
      fireEvent.click(screen.getByText('✓ RSVP us'))
    })
    const body = rsvpBody(fetchSpy)
    expect(body).not.toBeNull()
    expect(body.pickupUpdate).toBeUndefined()
  })

  it('sends pickupUpdate with what was typed when the block is filled in', async () => {
    const fetchSpy = mockLookupThenSign(false)
    const { container } = render(<WaiverFlow partyId="party-1" dropOff />)
    await reachReturningScreen(container)

    // The block opens with one empty row already (F4) — just fill it in.
    const nameInput = screen.getByLabelText('Pickup person 1 name')
    fireEvent.change(nameInput, { target: { value: 'Grandma Rivera' } })

    await act(async () => {
      fireEvent.click(screen.getByText('✓ RSVP us'))
    })
    const body = rsvpBody(fetchSpy)
    expect(body).not.toBeNull()
    expect(body.pickupUpdate).toEqual({
      authorizedPickup: [{ name: 'Grandma Rivera', phone: '' }],
      notAuthorized: '',
    })
  })

  it('sends pickupUpdate when only notAuthorized was filled in (no pickup rows)', async () => {
    const fetchSpy = mockLookupThenSign(false)
    const { container } = render(<WaiverFlow partyId="party-1" dropOff />)
    await reachReturningScreen(container)

    const notAuthorizedInput = container.querySelector('#wv-not-authorized') as HTMLInputElement
    fireEvent.change(notAuthorizedInput, { target: { value: 'Bio dad' } })

    await act(async () => {
      fireEvent.click(screen.getByText('✓ RSVP us'))
    })
    const body = rsvpBody(fetchSpy)
    expect(body).not.toBeNull()
    expect(body.pickupUpdate).toEqual({ authorizedPickup: [], notAuthorized: 'Bio dad' })
  })

  it('drop-off RSVP done screen shows the pickup-code, photo-ID and late-fee lines; a non-drop-off one does not', async () => {
    mockLookupThenSign(true)
    const { container, unmount } = render(<WaiverFlow partyId="party-1" dropOff />)
    await reachReturningScreen(container)
    await act(async () => {
      fireEvent.click(screen.getByText('✓ RSVP us'))
    })
    expect(await screen.findByText(/text a pickup code/)).toBeInTheDocument()
    expect(screen.getByText(/photo ID if we don’t know them/)).toBeInTheDocument()
    expect(screen.getByText('Late pickup: $1 per minute after a 15-minute grace.')).toBeInTheDocument()
    unmount()

    vi.restoreAllMocks()
    mockLookupThenSign(true)
    const second = render(<WaiverFlow partyId="party-1" />)
    await reachReturningScreen(second.container)
    await act(async () => {
      fireEvent.click(screen.getByText('✓ RSVP us'))
    })
    await screen.findByText(/You’re all set/)
    expect(screen.queryByText(/Late pickup/)).not.toBeInTheDocument()
  })

  it('the on-file line only shows for a drop-off event, and only when pickup is on file', async () => {
    mockLookupThenSign(false)
    const { container } = render(<WaiverFlow partyId="party-1" dropOff />)
    await reachReturningScreen(container)
    expect(screen.queryByText(/Pickup people are on file/)).not.toBeInTheDocument()
    expect(screen.getByText('Who may pick up?')).toBeInTheDocument()
  })

  it('an adult-only RSVP to a drop-off event does not show the pickup/ID/late-fee lines', async () => {
    mockLookupThenSign(true)
    const { container } = render(<WaiverFlow partyId="party-1" dropOff />)
    await reachReturningScreen(container)
    fireEvent.click(screen.getByLabelText(/Bo/)) // untick the child; the adult still comes
    await act(async () => { fireEvent.click(screen.getByText('✓ RSVP us')) })
    await screen.findByText(/You’re all set/)
    expect(screen.queryByText(/text a pickup code/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Late pickup/)).not.toBeInTheDocument()
  })
})
