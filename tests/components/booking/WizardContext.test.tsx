import { describe, it, expect } from 'vitest'
import { wizardReducer, initialState } from '@components/booking/WizardContext'
import type { WizardAction } from '@components/booking/WizardContext'
import type { EventTypeConfig } from '@config/site.config'

const mockEventType: EventTypeConfig = {
  id: 'birthday',
  name: 'Birthday Party',
  description: 'A fun birthday party',
  flow: 'booking',
  baseCapacity: 12,
  duration: 120,
  allowAddOns: true,
  allowExtraGuests: true,
  extraGuestPrice: 1500,
}

describe('wizardReducer', () => {
  it('has initial state with step 0 and null selections', () => {
    expect(initialState.currentStep).toBe(0)
    expect(initialState.eventType).toBeNull()
    expect(initialState.selectedDates).toBeNull()
    expect(initialState.selectedSlot).toBeNull()
    expect(initialState.customerInfo).toBeNull()
    expect(initialState.selectedAddOns).toEqual([])
    expect(initialState.paymentStatus).toBe('idle')
  })

  it('SET_EVENT_TYPE sets event type and advances to step 1', () => {
    const action: WizardAction = { type: 'SET_EVENT_TYPE', payload: mockEventType }
    const next = wizardReducer(initialState, action)

    expect(next.eventType).toBe(mockEventType)
    expect(next.currentStep).toBe(1)
  })

  it('TOGGLE_ADDON adds and removes from selectedAddOns', () => {
    const add: WizardAction = { type: 'TOGGLE_ADDON', payload: 'addon-1' }
    let state = wizardReducer(initialState, add)
    expect(state.selectedAddOns).toEqual(['addon-1'])

    const addAnother: WizardAction = { type: 'TOGGLE_ADDON', payload: 'addon-2' }
    state = wizardReducer(state, addAnother)
    expect(state.selectedAddOns).toEqual(['addon-1', 'addon-2'])

    const remove: WizardAction = { type: 'TOGGLE_ADDON', payload: 'addon-1' }
    state = wizardReducer(state, remove)
    expect(state.selectedAddOns).toEqual(['addon-2'])
  })

  it('RESET returns to initial state', () => {
    let state = wizardReducer(initialState, { type: 'SET_EVENT_TYPE', payload: mockEventType })
    state = wizardReducer(state, { type: 'SET_GUEST_COUNT', payload: 15 })
    state = wizardReducer(state, { type: 'TOGGLE_ADDON', payload: 'addon-1' })

    const reset = wizardReducer(state, { type: 'RESET' })
    expect(reset).toEqual(initialState)
  })

  it('SET_DATES stores date range', () => {
    const action: WizardAction = { type: 'SET_DATES', payload: { start: '2026-03-15', end: '2026-03-15' } }
    const next = wizardReducer(initialState, action)
    expect(next.selectedDates).toEqual({ start: '2026-03-15', end: '2026-03-15' })
  })

  it('GO_TO_STEP navigates to specified step', () => {
    const action: WizardAction = { type: 'GO_TO_STEP', payload: 3 }
    const next = wizardReducer(initialState, action)
    expect(next.currentStep).toBe(3)
  })

  it('SET_PAYMENT_STATUS updates payment status', () => {
    const action: WizardAction = { type: 'SET_PAYMENT_STATUS', payload: 'processing' }
    const next = wizardReducer(initialState, action)
    expect(next.paymentStatus).toBe('processing')
  })

  it('SET_PARTY_TYPE stores the selected party type', () => {
    const partyType = {
      id: 'kids-slime',
      name: 'Slime Party',
      description: 'Gooey fun',
      category: 'kids-party',
      duration: 120,
      flow: 'booking' as const,
      variations: [{ id: 'kids-slime-base', name: 'Base Package', priceAmount: 40000, priceCurrency: 'USD' }],
      modifiers: [],
    }
    const result = wizardReducer(initialState, { type: 'SET_PARTY_TYPE', payload: partyType })
    expect(result.selectedPartyType).toEqual(partyType)
  })

  it('RESET clears selectedPartyType', () => {
    const partyType = {
      id: 'kids-slime',
      name: 'Slime Party',
      description: 'Gooey fun',
      category: 'kids-party',
      duration: 120,
      flow: 'booking' as const,
      variations: [{ id: 'kids-slime-base', name: 'Base Package', priceAmount: 40000, priceCurrency: 'USD' }],
      modifiers: [],
    }
    let state = wizardReducer(initialState, { type: 'SET_PARTY_TYPE', payload: partyType })
    const result = wizardReducer(state, { type: 'RESET' })
    expect(result.selectedPartyType).toBeNull()
  })
})
