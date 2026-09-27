import { describe, it, expect } from 'vitest'
import { formatMoney } from '@lib/money'
import { seatsLeftLabel, isSoldOut } from '@lib/workshop-rules'

describe('formatMoney', () => {
  it('drops ".00" on whole dollars', () => {
    expect(formatMoney(4000)).toBe('$40')
    expect(formatMoney(30000)).toBe('$300')
  })
  it('keeps cents when there are any, and never rounds', () => {
    expect(formatMoney(3250)).toBe('$32.50')
    expect(formatMoney(3299)).toBe('$32.99')
  })
  it('puts a comma in thousands', () => {
    expect(formatMoney(120000)).toBe('$1,200')
  })
  it('shows zero as $0', () => {
    expect(formatMoney(0)).toBe('$0')
  })
})

describe('seatsLeftLabel', () => {
  it('speaks only when 8 or fewer remain', () => {
    expect(seatsLeftLabel(35)).toBe('')
    expect(seatsLeftLabel(9)).toBe('')
    expect(seatsLeftLabel(8)).toBe('8 seats left')
  })
  it('gets the singular right', () => {
    expect(seatsLeftLabel(1)).toBe('1 seat left')
  })
  it('says nothing for zero, unknown or nonsense', () => {
    for (const n of [0, -1, null, undefined]) expect(seatsLeftLabel(n)).toBe('')
  })
})

describe('isSoldOut', () => {
  it('is true only at exactly zero seats', () => {
    expect(isSoldOut(0)).toBe(true)
    expect(isSoldOut(1)).toBe(false)
    expect(isSoldOut(null)).toBe(false)
    expect(isSoldOut(undefined)).toBe(false)
  })
})
