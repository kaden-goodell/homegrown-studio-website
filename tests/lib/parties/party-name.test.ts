import { describe, it, expect } from 'vitest'
import { partyDisplayName, partyPhrase } from '@lib/parties/party-name'
import { partyName } from '@lib/conflicts'
import { partyLabel } from '@lib/parties/refunds'

describe('the one party name (UI review, 3 Nov 2026)', () => {
  it('"<First>’s party · <Craft>" on every owner and crew screen', () => {
    expect(partyDisplayName({ hostName: 'Paige Testparent', craftName: 'Decoupage Succulent Pots' })).toBe('Paige’s party · Decoupage Succulent Pots')
    expect(partyDisplayName({ hostName: 'Paige Testparent' })).toBe('Paige’s party')
    expect(partyDisplayName({ craftName: 'Slime' })).toBe('Party · Slime')
    expect(partyDisplayName({ hostName: '  ', craftName: '' })).toBe('Party')
  })
  it('in a sentence the same words: "Paige’s party" (warnings, clashes, To decide, refunds)', () => {
    expect(partyPhrase('Paige Testparent')).toBe('Paige’s party')
    expect(partyName({ id: 'x', startIso: '', endIso: '', hostName: 'Paige Testparent' })).toBe('Paige’s party')
    expect(partyLabel({ hostName: 'Paige Testparent' })).toBe('Paige’s party')
    expect(partyLabel({ hostName: '' })).toBe('the party')
  })
})
