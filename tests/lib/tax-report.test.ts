import { describe, it, expect } from 'vitest'
import { summarizeTax, monthRange, previousMonth, bucketFor, loadCatalogIndex, renderTaxReport, type CatalogIndex } from '@lib/tax-report'

const index: CatalogIndex = new Map([
  ['V_CLASS', { productType: 'CLASS_TICKET', categoryNames: ['Workshop'] }],
  ['V_CRAFT', { productType: 'REGULAR', categoryNames: ['Crafts'] }],
  ['V_KIT', { productType: 'REGULAR', categoryNames: ['Take-Home Kits'] }],
  ['V_PARTY', { productType: 'APPOINTMENTS_SERVICE', categoryNames: ['Party'] }],
])
const line = (id: string | undefined, total: number, tax: number) => ({ catalog_object_id: id, total_money: { amount: total }, total_tax_money: { amount: tax } })

describe('summarizeTax', () => {
  it('sorts each line by what was sold, with sales before tax', () => {
    const s = summarizeTax([
      { line_items: [line('V_CLASS', 2725, 225)] },
      { line_items: [line('V_CLASS', 3270, 270), line('V_CRAFT', 109, 9)] },
      { line_items: [line('V_KIT', 5450, 450), line(undefined, 1000, 0)] },
    ], index)
    expect(s.classes).toEqual({ salesCents: 5500, taxCents: 495, lines: 2 })
    expect(s.cafe).toEqual({ salesCents: 100, taxCents: 9, lines: 1 })
    expect(s.kits).toEqual({ salesCents: 5000, taxCents: 450, lines: 1 })
    expect(s.other).toEqual({ salesCents: 1000, taxCents: 0, lines: 1 })
  })

  it('takes refunds off', () => {
    const s = summarizeTax([
      { line_items: [line('V_CRAFT', 109, 9)] },
      { returns: [{ return_line_items: [line('V_CRAFT', 109, 9)] }] },
    ], index)
    expect(s.cafe.taxCents).toBe(0)
    expect(s.cafe.salesCents).toBe(0)
  })

  it('kits win over the craft they are built from', () => {
    expect(bucketFor({ productType: 'REGULAR', categoryNames: ['Crafts', 'Take-Home Kits'] })).toBe('kits')
  })
})

describe('month boundaries in studio time', () => {
  it('October (CDT) and December (CST)', () => {
    expect(monthRange('2026-10')).toEqual({ start: '2026-10-01T05:00:00.000Z', end: '2026-11-01T05:00:00.000Z' })
    expect(monthRange('2026-12')).toEqual({ start: '2026-12-01T06:00:00.000Z', end: '2027-01-01T06:00:00.000Z' })
  })
  it('previous month, across a year', () => {
    expect(previousMonth(new Date('2026-11-01T14:00:00Z'))).toBe('2026-10')
    expect(previousMonth(new Date('2027-01-01T15:00:00Z'))).toBe('2026-12')
  })
})

describe('renderTaxReport', () => {
  it('leads with the two numbers to report', () => {
    const s = summarizeTax([{ line_items: [line('V_CLASS', 2725, 225), line('V_KIT', 5450, 450)] }], index)
    const { subject, text } = renderTaxReport('2026-10', s)
    expect(subject).toBe('Tax collected, October 2026')
    expect(text).toContain('Use tax (classes, Craft Café, parties): $2.25')
    expect(text).toContain('Sales tax (take-home kits): $4.50')
  })
})

describe('refunds', () => {
  it('a plain refund (custom amount) takes the same share off the original sale', () => {
    const sale = { id: 'O1', total_money: { amount: 109 }, line_items: [line('V_CRAFT', 109, 9)] }
    const refund = { id: 'R1', returns: [{ source_order_id: 'O1', return_line_items: [{ item_type: 'CUSTOM_AMOUNT', total_money: { amount: 109 }, total_tax_money: { amount: 0 } }] }] }
    const s = summarizeTax([sale, refund], index)
    expect(s.cafe).toEqual({ salesCents: 0, taxCents: 0, lines: 1 })
    expect(s.other.salesCents).toBe(0)
  })

  it('a refund of an earlier month’s sale uses that sale', () => {
    const sale = { id: 'O1', total_money: { amount: 2725 }, line_items: [line('V_CLASS', 2725, 225)] }
    const refund = { id: 'R1', returns: [{ source_order_id: 'O1', return_line_items: [{ total_money: { amount: 2725 }, total_tax_money: { amount: 0 } }] }] }
    const s = summarizeTax([refund], index, new Map([['O1', sale]]))
    expect(s.classes.taxCents).toBe(-225)
  })
})

describe('our own classes and party fees', () => {
  const idx: CatalogIndex = new Map([
    ['V_OURS', { productType: 'REGULAR', categoryNames: ['Classes'], inClasses: true }],
    ['V_CAFE', { productType: 'REGULAR', categoryNames: ['Crafts'] }],
  ])
  const named = (name: string, total: number, tax: number, id?: string) => ({ ...line(id, total, tax), name })

  it('a regular item in the Classes category is a class', () => {
    const s = summarizeTax([{ line_items: [line('V_OURS', 2725, 225)] }], idx)
    expect(s.classes).toEqual({ salesCents: 2500, taxCents: 225, lines: 1 })
  })
  it('the party studio fee line is a party; a café item stays café', () => {
    const s = summarizeTax([{ line_items: [named('Whole Studio Party — studio fee', 30000, 2700), line('V_CAFE', 109, 9), named('Custom', 100, 0)] }], idx)
    expect(s.parties).toEqual({ salesCents: 27300, taxCents: 2700, lines: 1 })
    expect(s.cafe.lines).toBe(1)
    expect(s.other.lines).toBe(1)
  })
  it('use tax total is unchanged by the new buckets', () => {
    const s = summarizeTax([{ line_items: [line('V_OURS', 2725, 225), named('Whole Studio Party — studio fee', 30000, 2700)] }], idx)
    expect(s.classes.taxCents + s.parties.taxCents).toBe(2925)
  })
  it('loader: category set tags items; unset falls back without throwing', async () => {
    const page = { objects: [
      { type: 'CATEGORY', id: 'CAT', category_data: { name: 'Classes' } },
      { type: 'ITEM', id: 'I', item_data: { categories: [{ id: 'CAT' }], variations: [{ id: 'V1' }] } },
    ] }
    const orig = globalThis.fetch
    globalThis.fetch = (async () => ({ ok: true, json: async () => page })) as any
    try {
      const cfg = { accessToken: 't', environment: 'sandbox', locationId: 'L', applicationId: 'A' } as any
      expect(bucketFor((await loadCatalogIndex({ ...cfg, classesCategoryId: 'CAT' })).get('V1'))).toBe('classes')
      expect(bucketFor((await loadCatalogIndex(cfg)).get('V1'))).toBe('cafe')
    } finally { globalThis.fetch = orig }
  })
  it('the report says classes may be under Craft Café when the category is missing', () => {
    const s = summarizeTax([], idx)
    expect(renderTaxReport('2026-10', s, { classesCategoryMissing: true }).text).toContain('may be under Craft Café')
    expect(renderTaxReport('2026-10', s).text).not.toContain('may be under')
  })
})
