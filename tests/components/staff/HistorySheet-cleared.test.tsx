import { describe, it, expect } from 'vitest'
import { clearedLine } from '@components/staff/HistorySheet'

const h: any = { signer: 'Jamie Rivera', children: [{ name: 'Mia Rivera' }] }

describe('History: cleared check-ins in plain words', () => {
  it('reads the structured field on new events', () => {
    const line = clearedLine(h, { at: '', action: 'undo-checkin', personIds: ['child:0'], clearedPresence: { 'child:0': { inAt: '2026-10-17T21:12:00.000Z', outAt: null } } })
    expect(line).toMatch(/^Had been checked in: Mia Rivera at \d{1,2}:12 PM$/)
  })
  it('turns an old raw "cleared: {…}" note into the same words, never JSON', () => {
    const note = 'cleared: ' + JSON.stringify({ adult: { inAt: '2026-10-17T21:12:00.000Z', outAt: '2026-10-17T22:30:00.000Z' } })
    const line = clearedLine(h, { at: '', action: 'undo-checkin', personIds: ['adult'], note })!
    expect(line).toMatch(/^Had been checked in: Jamie Rivera at .+ \(left .+\)$/)
    expect(line).not.toContain('{')
  })
  it('says nothing for other notes', () => {
    expect(clearedLine(h, { at: '', action: 'reissue-code', personIds: [], note: 'rotated' })).toBeNull()
  })
})
