/**
 * SMS code step's "Send again" resend cap (HOM-218 fix round 1): the server
 * (@lib/otp-store) only allows 2 resends after the initial code — issueOtp
 * sets sends:1, and resendOtp's cap is `sends >= MAX_SENDS` (3). The client
 * must hide the button at the same point, or it shows an enabled "Send
 * again" for a 3rd click that always 429s.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import WaiverFlow from '@components/waiver/WaiverFlow'

function mockLookupNeedsCode() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    return {
      ok: true,
      json: async () => ({
        data: { found: true, firstName: 'Sarah', kidCount: 0, validUntil: '2099-01-01T00:00:00.000Z', needsCode: true, phoneHint: '••42' },
      }),
    } as Response
  })
}

async function reachCodeStep(container: HTMLElement) {
  const input = container.querySelector('input[placeholder="Email or phone"]') as HTMLInputElement
  fireEvent.change(input, { target: { value: 'sarah@example.com' } })
  await act(async () => {
    fireEvent.click(screen.getByText('Continue'))
  })
  await screen.findByText(/We texted a code/)
}

/** Clicking "Send again" only works once its 60s cooldown has elapsed. */
async function clickResendAfterCooldown() {
  await act(async () => {
    vi.advanceTimersByTime(60_000)
  })
  await act(async () => {
    fireEvent.click(screen.getByText('Didn’t get it? Send again'))
  })
}

describe('WaiverFlow — code step resend cap (HOM-218 fix round 1)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('shows "Send again" disabled during the initial cooldown, then enabled', async () => {
    mockLookupNeedsCode()
    const { container } = render(<WaiverFlow partyId="party-1" />)
    await reachCodeStep(container)

    const resendButton = screen.getByText(/Send again/)
    expect(resendButton).toBeDisabled()

    await act(async () => {
      vi.advanceTimersByTime(60_000)
    })
    expect(screen.getByText('Didn’t get it? Send again')).not.toBeDisabled()
  })

  it('hides the "Send again" button after the 2nd resend — never shows an enabled button for a 3rd click', async () => {
    mockLookupNeedsCode()
    const { container } = render(<WaiverFlow partyId="party-1" />)
    await reachCodeStep(container)

    await clickResendAfterCooldown() // resend #1
    expect(screen.getByText(/Send again/)).toBeInTheDocument()

    await clickResendAfterCooldown() // resend #2 — the server's last allowed resend
    expect(screen.queryByText(/Send again/)).not.toBeInTheDocument()
  })
})
