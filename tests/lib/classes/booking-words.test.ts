import { describe, it, expect } from 'vitest'
import { overCapacityNote, paidWay, printLine, takenCents, unpaidCounter } from '@lib/classes/booking-words'

describe('booking words (door and paper)', () => {
  it('a pay-at-the-counter seat never rung up is "Not paid yet"; once rung up, paid at the counter', () => {
    expect(paidWay({ source: 'door-counter', paidHere: false, overCapacity: false })).toBe('Not paid yet')
    expect(paidWay({ source: 'door-counter', paidHere: true, overCapacity: false })).toBe('Paid at the counter')
  })
  it('a door seat an owner marked paid at the counter (To decide) reads paid, and its price counts as taken', () => {
    expect(paidWay({ source: 'door-counter', paidHere: false, paidAtCounter: true, overCapacity: false })).toBe('Paid at the counter')
    expect(unpaidCounter({ source: 'door-counter', paidHere: false, paidAtCounter: true })).toBe(false)
    expect(takenCents({ source: 'door-counter', paidHere: false, paidAtCounter: true, paidCents: 3270, refundedCents: 0 })).toBe(3270)
  })
  it('over capacity: the crew’s own choice reads as on purpose; a sale that landed over is for an owner', () => {
    expect(overCapacityNote({ source: 'comp', paidHere: false, overCapacity: true })).toBe('Added over capacity on purpose.')
    expect(overCapacityNote({ source: 'door-card', paidHere: true, overCapacity: true })).toBe('Added over capacity on purpose.')
    expect(overCapacityNote({ source: 'online', paidHere: true, overCapacity: true })).toBe('Over capacity. An owner decides on /admin.')
    expect(overCapacityNote({ source: 'comp', paidHere: false, overCapacity: false })).toBeNull()
  })
  it('the printed line marks unpaid and over-capacity seats', () => {
    expect(printLine({ name: 'Dora Door', seatsToday: 1, source: 'door-counter', paidHere: false, overCapacity: true })).toBe('Dora Door · 1 seat · Not paid yet · Over capacity')
  })
})
