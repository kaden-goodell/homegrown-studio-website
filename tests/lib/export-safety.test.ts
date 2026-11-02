// The two rules every file the site hands out follows: no keys to anything, no spreadsheet formulas.
import { describe, it, expect } from 'vitest'
import { csvCell, csvRows, redactSecrets } from '@lib/export-safety'
import { custodyCsv, exportAll } from '@lib/archive-export'
import { taxReportCsv } from '@lib/tax-report'

describe('redactSecrets', () => {
  it('drops tokens, hashes, secrets and passcodes at any depth; keeps inputHash and everything else', () => {
    const out = redactSecrets({ hostToken: 'h', payToken: 'p', name: 'Ann', charges: [{ paymentToken: 't', cents: 5 }], pickupCodeHash: 'x', ask: { inputHash: 'k', secret: 's' }, passcode: 'z' })
    expect(out).toEqual({ name: 'Ann', charges: [{ cents: 5 }], ask: { inputHash: 'k' } })
  })
})

describe('csvCell', () => {
  it('neutralises = + - @ tab and CR at the start; leaves plain numbers', () => {
    expect(csvCell('=HYPERLINK("http://x","click")')).toBe(`"'=HYPERLINK(""http://x"",""click"")"`)
    expect(csvCell('+1+1')).toBe("'+1+1")
    expect(csvCell('-1+cmd')).toBe("'-1+cmd")
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(csvCell('\t=1')).toBe("'\t=1")
    expect(csvCell('\r=1')).toBe(`"'\r=1"`)
    expect(csvCell('-12.50')).toBe('-12.50')
    expect(csvCell('Ann, Lee')).toBe('"Ann, Lee"')
    expect(csvRows([['a', 1], [null, undefined]])).toBe('a,1\n,\n')
  })
})

describe('the weekly archive uses the same rules', () => {
  const store = (data: Record<string, unknown>) => ({ list: async () => Object.keys(data), get: async (k: string) => JSON.stringify(data[k]) })
  it('exportAll leaves out host and payment-link tokens and pickup-code hashes', async () => {
    const out = await exportAll([
      { name: 'parties', store: store({ p1: { id: 'p1', hostToken: 'H', payToken: 'P', hostName: 'Ann' } }) },
      { name: 'checkins', store: store({ 'p1__w1': { pickupCodeHash: 'abc', events: [] } }) },
    ])
    const text = JSON.stringify(out.files)
    expect(text).not.toMatch(/hostToken|payToken|pickupCodeHash/)
    expect(text).toContain('Ann')
  })
  it('custody.csv never carries a formula', () => {
    const csv = custodyCsv({ 'p1__w1': { events: [{ at: '2026-10-24T20:00:00Z', action: 'pickup', collectedBy: '=HYPERLINK("http://x","y")' }] } })
    expect(csv).toContain(`"'=HYPERLINK(`)
  })
  it('the tax spreadsheet keeps negative amounts as numbers', () => {
    const z = { salesCents: 0, taxCents: 0, lines: 0 }
    const csv = taxReportCsv([{ month: '2026-10', summary: { classes: { salesCents: -1250, taxCents: -113, lines: 1 }, cafe: z, parties: z, kits: z, other: z } as any }])
    expect(csv).toContain('-12.50,-1.13')
  })
})
