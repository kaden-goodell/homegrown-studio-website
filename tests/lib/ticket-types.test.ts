import { describe, it, expect } from 'vitest'
import { validateTicketTypes, seatPlan, ticketSummary, ticketPriceLine } from '@lib/ticket-types'

const TYPES = [
  { id: 'adult', label: 'Adult', priceCents: null, min: 1 },
  { id: 'kid', label: 'Kid', priceCents: 1500, min: 1 },
]

describe('validateTicketTypes', () => {
  it('takes Adult (class price) and Kid $15, minting ids from the names', () => {
    expect(validateTicketTypes([{ label: 'Adult', min: 1 }, { label: 'Kid', priceCents: 1500, min: 1 }])).toEqual({ ok: true, value: TYPES })
  })
  it('clears with null', () => {
    expect(validateTicketTypes(null)).toEqual({ ok: true, value: null })
  })
  it.each([
    [[{ label: 'Adult' }]],
    [[{ label: 'Adult', priceCents: 2000 }, { label: 'Kid', priceCents: 1500 }]],
    [[{ label: 'Adult' }, { label: 'Kid' }]],
    [[{ label: 'Adult' }, { label: 'adult', priceCents: 100 }]],
    [[{ label: '' }, { label: 'Kid', priceCents: 1500 }]],
    [[{ label: 'Adult' }, { label: 'Kid', priceCents: 15.5 }]],
  ])('refuses %j', (raw) => {
    expect(validateTicketTypes(raw).ok).toBe(false)
  })
})

describe('seatPlan', () => {
  it('lists adults first, each kid seat at the kid price', () => {
    const r = seatPlan(TYPES, { adult: 2, kid: 2 }, 2000, 10)
    expect(r).toEqual({ ok: true, value: [
      { typeId: 'adult', label: 'Adult', priceCents: 2000 },
      { typeId: 'adult', label: 'Adult', priceCents: 2000 },
      { typeId: 'kid', label: 'Kid', priceCents: 1500 },
      { typeId: 'kid', label: 'Kid', priceCents: 1500 },
    ] })
  })
  it('holds each type to its minimum', () => {
    expect(seatPlan(TYPES, { adult: 1, kid: 0 }, 2000, 10)).toEqual({ ok: false, error: 'Each booking needs at least 1 kid.' })
    expect(seatPlan(TYPES, { kid: 2 }, 2000, 10)).toEqual({ ok: false, error: 'Each booking needs at least 1 adult.' })
  })
  it('refuses unknown types, part seats and too many', () => {
    expect(seatPlan(TYPES, { adult: 1, kid: 1, teen: 1 }, 2000, 10).ok).toBe(false)
    expect(seatPlan(TYPES, { adult: 1.5, kid: 1 }, 2000, 10).ok).toBe(false)
    expect(seatPlan(TYPES, { adult: 6, kid: 5 }, 2000, 10)).toEqual({ ok: false, error: 'One booking can hold up to 10 people. For a bigger group, book a private party.' })
    expect(seatPlan(TYPES, null, 2000, 10).ok).toBe(false)
  })
})

describe('labels', () => {
  it('summarises and prices', () => {
    expect(ticketSummary([{ typeId: 'adult', label: 'Adult' }, { typeId: 'kid', label: 'Kid' }, { typeId: 'kid', label: 'Kid' }])).toBe('1 Adult, 2 Kids')
    expect(ticketPriceLine(TYPES, 2000)).toBe('$20 adult · $15 kid')
  })
})
