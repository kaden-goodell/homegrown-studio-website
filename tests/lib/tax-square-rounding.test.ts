/**
 * Square's own tax rounding, measured with Square's side-effect-free
 * CalculateOrder (POST /v2/orders/calculate) in the SANDBOX on 2 Nov 2026,
 * 9% ADDITIVE tax, ad hoc lines (ORDER and LINE_ITEM scope gave identical
 * answers). The sandbox E2E (scenario 49) saw 30% off $15 + 9% charged
 * $11.44 where our quote said $11.45. These fixtures are Square's answers.
 */
import { describe, expect, it } from 'vitest'
import { orderLineTaxes, orderTaxCents, taxCents } from '@lib/tax'

// [line nets in cents] → [Square's order tax, Square's per-line taxes]
const SQUARE: [number[], number, number[]][] = [
  [[150], 14, [14]], [[250], 22, [22]], [[350], 32, [32]], [[450], 40, [40]],
  [[550], 50, [50]], [[950], 86, [86]], [[1050], 94, [94]], [[1150], 104, [104]],
  [[1500 - 450], 94, [94]], // $15 with a $4.50 (30%) line discount: the E2E case
  [[1050, 1050], 189, [94, 95]],
  [[1050, 950], 180, [94, 86]],
  [[150, 250, 350], 68, [14, 22, 32]],
  [[2100], 189, [189]], // qty 2 × $10.50 on one line
  [[450], 40, [40]], // qty 3 × $1.50 on one line
  [[1050, 1000], 184, [94, 90]],
  [[150, 150, 150], 40, [13, 14, 13]],
  [[250, 250], 45, [22, 23]],
  [[350, 350, 350], 94, [31, 32, 31]],
  [[1050, 1050, 1050], 284, [95, 94, 95]],
  [[1000, 1050], 184, [90, 94]],
  [[950, 950], 171, [86, 85]],
  [[6000, 6000, 4000], 1440, [540, 540, 360]],
  [[1050, 150], 108, [94, 14]],
  [[150, 1050], 108, [14, 94]],
  [[133, 133, 133], 36, [12, 12, 12]],
]

describe('tax rounding matches Square (CalculateOrder fixtures)', () => {
  it('one amount: a half cent goes to the even cent', () => {
    expect(taxCents(1050, 9)).toBe(94)
    expect(taxCents(950, 9)).toBe(86)
    expect(taxCents(150, 9)).toBe(14)
    expect(taxCents(250, 9)).toBe(22)
    expect(taxCents(1000, 9.5)).toBe(95)
    expect(taxCents(0, 9)).toBe(0)
    expect(taxCents(1000, 0)).toBe(0)
  })

  it.each(SQUARE)('order %j: the order tax is exactly Square’s', (nets, total) => {
    expect(orderTaxCents(nets, 9)).toBe(total)
  })

  it.each(SQUARE)('order %j: the per-line taxes add up to Square’s and each is within a cent of Square’s line', (nets, total, square) => {
    const ours = orderLineTaxes(nets, 9)
    expect(ours.reduce((s, c) => s + c, 0)).toBe(total)
    ours.forEach((c, i) => expect(Math.abs(c - square[i])).toBeLessThanOrEqual(1))
  })
})
