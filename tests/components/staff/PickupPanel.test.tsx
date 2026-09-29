/**
 * HOM-214 fix round 1, Critical 2: "Edit list" must seed from the LIVE
 * door-side `checkin.confirmedPickup` (what the server gate and the chips
 * actually read), not the static waiver-level `authorizedPickup` — those
 * two can diverge on purpose (that's what editing the list is for), and
 * seeding from the wrong one meant a name removed at the door came back
 * next time the editor was opened.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import PickupPanel from '@components/staff/PickupPanel'
import type { Household } from '@components/staff/HouseholdCard'

function makeHousehold(overrides: Partial<Household> = {}): Household {
  return {
    recordId: 'wvr_1',
    signer: 'Jamie Rivera',
    phone: '2565550199',
    email: 'jamie@x.com',
    children: [{ name: 'Kiddo Rivera', allergies: '', medications: '' }],
    childCount: 1,
    adultAllergies: '',
    emergency: { name: 'Bob', phone: '2565559999', relationship: 'Spouse' },
    // Stale/original waiver-level list — should NOT be what "Edit list" seeds from.
    authorizedPickup: [{ name: 'Old Waiver Name', phone: '' }],
    notAuthorized: '',
    responsibleAdult: '',
    photoConsent: true,
    signedAt: '2026-08-01T00:00:00.000Z',
    agreementVersion: 'v2',
    validUntil: '2027-08-01T00:00:00.000Z',
    checkin: {
      expected: null,
      presence: {},
      pickedUpBy: null,
      // Live door-side list — a name removed at the door won't be here.
      confirmedPickup: [{ name: 'Grandma Rivera', phone: '2565550100' }],
      notAuthorized: '',
      hasPickupCode: true,
      codeAttempts: 0,
      locked: false,
      releasedTo: {},
    },
    ...overrides,
  }
}

function renderPanel(h: Household, extra: Partial<Parameters<typeof PickupPanel>[0]> = {}) {
  return render(
    <PickupPanel
      h={h}
      dropOff={true}
      day="2026-09-05"
      selectedOut={['child:0']}
      checkingOutChild={true}
      post={vi.fn()}
      revealCode={null}
      smsFailed={false}
      onCodeIssued={vi.fn()}
      {...extra}
    />,
  )
}

describe('PickupPanel — chips and Edit list read the live confirmedPickup', () => {
  it('renders a chip for the live checkin.confirmedPickup entry, not the stale authorizedPickup one', () => {
    renderPanel(makeHousehold())
    expect(screen.getByText('Grandma Rivera')).toBeInTheDocument()
    expect(screen.queryByText('Old Waiver Name')).not.toBeInTheDocument()
  })

  it('"Edit list" seeds its rows from checkin.confirmedPickup, not authorizedPickup', () => {
    renderPanel(makeHousehold())

    fireEvent.click(screen.getByText('Edit list'))

    const nameInput = screen.getByPlaceholderText('Name') as HTMLInputElement
    expect(nameInput.value).toBe('Grandma Rivera')
    expect(screen.queryByDisplayValue('Old Waiver Name')).not.toBeInTheDocument()
  })

  it('a name already removed from confirmedPickup does not reappear when the editor is reopened', () => {
    // Household where the door list has already been edited down to nothing —
    // the historical bug would have brought back `authorizedPickup`'s entry.
    const h = makeHousehold({ checkin: { ...makeHousehold().checkin, confirmedPickup: [] } })
    renderPanel(h)

    fireEvent.click(screen.getByText('Edit list'))

    expect(screen.queryByPlaceholderText('Name')).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue('Old Waiver Name')).not.toBeInTheDocument()
  })
})
