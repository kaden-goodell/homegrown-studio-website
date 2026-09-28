/**
 * Returning-RSVP screen's compact "Who may pick up?" block (HOM-212 fix
 * round 1 addendum): an absent `pickupUpdate` must mean "no change" — never
 * sent when the block wasn't shown (hasPickup already true), and never sent
 * just because the block WAS shown but the guest left it blank.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import WaiverFlow from '@components/waiver/WaiverFlow'

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
            kids: [],
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

/** Type a contact and click through the lookup step to the returning screen. */
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

    // No rows exist yet — add one first, then fill it in.
    fireEvent.click(screen.getByText('+ Add another'))
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
})
