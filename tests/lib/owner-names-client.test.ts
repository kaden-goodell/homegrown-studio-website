import { describe, it, expect, afterEach } from 'vitest'
import { setOwnerNames, ownersOr, ownersAnd, oneOwner, _resetOwnerNamesForTests } from '@lib/owner-names-client'

afterEach(() => _resetOwnerNamesForTests())

describe('owner names on crew screens (N11)', () => {
  it('start as the bootstrap owners, the same the server uses before a staff list exists', () => {
    expect(ownersOr()).toBe('Catherine or Kaden')
    expect(ownersAnd()).toBe('Catherine and Kaden')
  })
  it('follow the staff list’s owners once /staff hears them', () => {
    setOwnerNames(['Catherine', 'Dana', 'Kaden'])
    expect(ownersOr()).toBe('Catherine, Dana or Kaden')
    setOwnerNames(['Catherine'])
    expect(ownersAnd()).toBe('Catherine')
    expect(oneOwner()).toBe(true)
  })
  it('ignore an empty or broken answer', () => {
    setOwnerNames([])
    setOwnerNames(null)
    setOwnerNames(['', 3])
    expect(ownersOr()).toBe('Catherine or Kaden')
  })
})
