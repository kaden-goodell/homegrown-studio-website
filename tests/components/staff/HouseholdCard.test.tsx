/**
 * Only drop-off events have real check-out. Every other event's card is
 * attendance-only: tick boxes + ONE `✓ Here (n)` button; after that each person
 * shows `● here 4:12 PM` with a small Undo. No pickup panel, no "collected by",
 * no code, no "All picked up", no Reset.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import HouseholdCard, { type Household } from '@components/staff/HouseholdCard'

function household(presence: Household['checkin']['presence'] = {}, over: Partial<Household> = {}): Household {
  return {
    recordId: 'wvr_1',
    signer: 'Jamie Rivera',
    phone: '2565550199',
    email: 'jamie@x.com',
    children: [
      { name: 'Kiddo Rivera', allergies: 'peanuts', medications: '' },
      { name: 'Second Rivera', allergies: '', medications: '' },
    ],
    childCount: 2,
    adultAllergies: '',
    emergency: { name: 'Bob', phone: '2565559999', relationship: 'Spouse' },
    authorizedPickup: [{ name: 'Grandma Rivera', phone: '' }],
    notAuthorized: 'Rick Smith',
    responsibleAdult: '',
    photoConsent: false,
    signedAt: '2026-08-01T00:00:00.000Z',
    agreementVersion: 'v1',
    validUntil: '2027-08-01T00:00:00.000Z',
    checkin: {
      expected: null,
      presence,
      pickedUpBy: null,
      confirmedPickup: [{ name: 'Grandma Rivera', phone: '' }],
      notAuthorized: 'Rick Smith',
      hasPickupCode: false,
      codeAttempts: 0,
      locked: false,
      releasedTo: {},
    },
    ...over,
  }
}

const here = { inAt: '2026-09-05T21:12:00.000Z', outAt: null }

function renderCard(h: Household, dropOff: boolean, post = vi.fn(async () => ({}))) {
  render(<HouseholdCard h={h} dropOff={dropOff} kind="party" id="p1" day="2026-09-05" post={post as any} />)
  return post
}

const CHECKOUT_TEXT = [/Check out/i, /Collected by/i, /Pickup code/i, /All picked up/i, /Override/i, /Re-send code/i, /Issue pickup code/i, /^Reset$/, /photo ID/i, /May NOT collect/i, /Someone else/i]

describe('HouseholdCard — non-drop-off (attendance-only)', () => {
  it('before anyone arrives: tick boxes and one ✓ Here (n) button, pill says Not here yet', () => {
    renderCard(household(), false)
    expect(screen.getByText(/Not here yet/)).toBeInTheDocument()
    expect(screen.getAllByRole('checkbox')).toHaveLength(3)
    expect(screen.getByRole('button', { name: '✓ Here (3)' })).toBeInTheDocument()
    for (const t of CHECKOUT_TEXT) expect(screen.queryByText(t)).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/code|Someone else/i)).not.toBeInTheDocument()
  })

  it('the button counts only ticked people and posts a plain checkin for them', async () => {
    const post = renderCard(household(), false)
    fireEvent.click(screen.getAllByRole('checkbox')[0]) // untick the adult
    fireEvent.click(screen.getByRole('button', { name: '✓ Here (2)' }))
    await waitFor(() => expect(post).toHaveBeenCalledWith('wvr_1', { day: '2026-09-05', action: 'checkin', personIds: ['child:0', 'child:1'] }))
  })

  it('after tapping: each person shows "● here <time>" with Undo — and still no check-out controls', () => {
    renderCard(household({ adult: here, 'child:0': here }), false)
    expect(screen.getByText(/2 of 3 here/)).toBeInTheDocument()
    expect(screen.getAllByText(/● here/)).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Undo' })).toHaveLength(2)
    // the one not-yet-here person can still be added
    expect(screen.getByRole('button', { name: '✓ Here (1)' })).toBeInTheDocument()
    for (const t of CHECKOUT_TEXT) expect(screen.queryByText(t)).not.toBeInTheDocument()
  })

  it('Undo clears just that person via undo-checkin (no confirm dialog)', async () => {
    const confirm = vi.spyOn(window, 'confirm')
    const post = renderCard(household({ adult: here }), false)
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(post).toHaveBeenCalledWith('wvr_1', { day: '2026-09-05', action: 'undo-checkin', personIds: ['adult'] }))
    expect(confirm).not.toHaveBeenCalled()
  })

  it('tapping a here-person\'s NAME does not press Undo (the row is not a <label> around a button)', () => {
    const post = renderCard(household({ adult: here }), false)
    fireEvent.click(screen.getAllByText('Jamie Rivera').at(-1)!) // header name first, person row last
    expect(post).not.toHaveBeenCalled()
  })

  it('an old checked-out row (from before this rule) reads as here, not "left"', () => {
    renderCard(household({ adult: { inAt: here.inAt, outAt: '2026-09-05T22:00:00.000Z' } }), false)
    expect(screen.getByText(/● here/)).toBeInTheDocument()
    expect(screen.queryByText(/left/)).not.toBeInTheDocument()
  })

  it('keeps allergy + no-photo badges, Agreement and History; emergency and signed date live in Agreement', () => {
    renderCard(household(), false)
    expect(screen.getAllByText(/peanuts/).length).toBeGreaterThan(0)
    expect(screen.getByText(/No photos/)).toBeInTheDocument()
    expect(screen.queryByText(/Emergency:/)).not.toBeInTheDocument()
    expect(screen.queryByText(/EXPIRED/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Agreement/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /History/ })).toBeInTheDocument()
  })

  it('says so plainly when the agreement has expired', () => {
    renderCard(household({}, { validUntil: '2020-01-01T00:00:00.000Z' }), false)
    expect(screen.getByText(/Agreement EXPIRED/)).toBeInTheDocument()
  })
})

describe('HouseholdCard — allergy "None"', () => {
  it('a child whose allergies are the literal "None" shows no warning badge and no family flag', () => {
    const h = household({}, { children: [{ name: 'Kiddo Rivera', allergies: 'None', medications: '' }], childCount: 1 })
    renderCard(h, false)
    expect(screen.queryByText(/⚠/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Allergies in this family/)).not.toBeInTheDocument()
  })

  it('a real allergy still does, on the person', () => {
    renderCard(household(), false)
    expect(screen.getByText(/⚠ peanuts/)).toBeInTheDocument()
  })
})

describe('HouseholdCard — drop-off (unchanged)', () => {
  it('shows the pickup machinery once someone is here', () => {
    renderCard(household({ 'child:0': here }), true)
    expect(screen.getByText(/1 of 3 here/)).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Pickup code')).toBeInTheDocument()
    expect(screen.getByText(/May NOT collect: Rick Smith/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument()
    expect(screen.getByText(/Override/)).toBeInTheDocument()
  })

  it('still says Check in (n) / Not arrived before arrival', () => {
    renderCard(household(), true)
    expect(screen.getByText(/Not arrived/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Check in (3)' })).toBeInTheDocument()
  })

  it('a checked-out person still reads "left" with who collected them', () => {
    const h = household({ 'child:0': { inAt: here.inAt, outAt: '2026-09-05T22:00:00.000Z' } })
    h.checkin.releasedTo = { 'child:0': { name: 'Grandma Rivera', at: '2026-09-05T22:00:00.000Z', day: '2026-09-05' } }
    renderCard(h, true)
    expect(screen.getByText(/✓ left .*Grandma Rivera/)).toBeInTheDocument()
  })
})

describe('HouseholdCard — seat picks', () => {
  it('shows the family’s picks under the phone', () => {
    render(
      <HouseholdCard
        h={household()} dropOff={false} kind="workshop" id="clssch_pails" day="2026-10-18" post={vi.fn(async () => ({})) as any}
        picks={[{ seat: 1, optionId: 'pumpkin-color', choice: 'Lavender' }, { seat: 2, optionId: 'pumpkin-color', choice: 'Lavender' }]}
      />,
    )
    expect(screen.getByText('Picks: Lavender ×2')).toBeInTheDocument()
  })

  it('shows no picks line without picks', () => {
    renderCard(household(), false)
    expect(screen.queryByText(/^Picks:/)).toBeNull()
  })

  it('a blank emergency contact (optional since Oct 2026) reads "none given — call the signer"', () => {
    renderCard(household({}, { emergency: { name: '', phone: '', relationship: '' } }), true)
    expect(screen.getByText(/none given — call the signer/)).toBeInTheDocument()
  })
})

describe('seats vs crafting', () => {
  const post = vi.fn(async () => ({}))
  const card = (h: Household, seats?: { seats: number; comped: number; atRegister?: number }) =>
    render(<HouseholdCard h={h} dropOff={false} kind="workshop" id="clssch_x" day="2026-10-17" post={post} seats={seats} />)
  const withExpected = (expected: string[]) => household({}, { checkin: { ...household().checkin, expected } })

  it('shows comped seats and who checked as crafting, quiet when they match', () => {
    card(withExpected(['adult', 'child:0', 'child:1']), { seats: 3, comped: 3 })
    expect(screen.getByTestId('seats-line').textContent).toBe('3 seats (comped) · 3 crafting')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('flags more crafting than seats', () => {
    const h = household({}, {
      children: [1, 2, 3, 4].map((n) => ({ name: `Kid ${n}`, allergies: '', medications: '' })), childCount: 4,
    })
    card(h, { seats: 3, comped: 3 }) // no checklist: everyone on the agreement counts
    expect(screen.getByTestId('seats-line').textContent).toBe('3 seats (comped) · 5 crafting')
    expect(screen.getByRole('alert').textContent).toBe('2 more crafting than seats. Use Sell a seat or Comp a seat for the extra 2.')
  })

  it('notes unused seats, and mixes paid with comped', () => {
    card(withExpected(['adult', 'child:0']), { seats: 3, comped: 1 })
    expect(screen.getByTestId('seats-line').textContent).toBe('3 seats (2 paid, 1 comped) · 2 crafting')
    expect(screen.getByText('1 seat not used yet.')).toBeTruthy()
  })

  it('labels seats to be paid at the register', () => {
    card(withExpected(['adult', 'child:0']), { seats: 2, comped: 0, atRegister: 2 })
    expect(screen.getByTestId('seats-line').textContent).toBe('2 seats (pay at register) · 2 crafting')
  })

  it('warns when a family on a class has no seat on record', () => {
    card(household(), { seats: 0, comped: 0, atRegister: 0 })
    expect(screen.getByRole('alert').textContent).toMatch(/No seat on record/)
  })

  it('shows nothing when seats are unknown (not a class, or the read failed)', () => {
    card(household())
    expect(screen.queryByTestId('seats-line')).toBeNull()
  })
})

describe('Agreement button', () => {
  it('opens the signed agreement from the card', () => {
    render(<HouseholdCard h={household()} dropOff={false} kind="workshop" id="clssch_x" day="2026-10-17" post={vi.fn(async () => ({}))} />)
    fireEvent.click(screen.getByRole('button', { name: '📄 Agreement' }))
    expect(screen.getByRole('dialog', { name: 'Jamie Rivera\'s agreement' })).toBeTruthy()
  })
})
