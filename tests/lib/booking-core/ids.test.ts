import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { CREATE_KEY_RE, idFor } from '@lib/booking-core/ids'
import { bookingIdFor } from '@lib/classes/checkout'

describe('idFor', () => {
  it('matches bookingIdFor for 20 random ids', () => {
    for (let i = 0; i < 20; i++) {
      const a = randomUUID()
      expect(idFor('bkg', a)).toBe(bookingIdFor(a))
    }
  })

  it('is the prefix and 16 hex characters, the same for the same key', () => {
    expect(idFor('pty', 'abc')).toMatch(/^pty_[0-9a-f]{16}$/)
    expect(idFor('chg', 'abc')).toMatch(/^chg_[0-9a-f]{16}$/)
    expect(idFor('pty', 'abc')).toBe(idFor('pty', 'abc'))
    expect(idFor('pty', 'abc').slice(4)).toBe(idFor('bkg', 'abc').slice(4))
    expect(idFor('pty', 'abd')).not.toBe(idFor('pty', 'abc'))
  })
})

describe('CREATE_KEY_RE', () => {
  it('takes 8–80 letters, digits, dash and underscore', () => {
    expect(CREATE_KEY_RE.test('abcd_123')).toBe(true)
    expect(CREATE_KEY_RE.test('a'.repeat(80))).toBe(true)
    expect(CREATE_KEY_RE.test('abc')).toBe(false)
    expect(CREATE_KEY_RE.test('a'.repeat(81))).toBe(false)
    expect(CREATE_KEY_RE.test('abcd 1234')).toBe(false)
    expect(CREATE_KEY_RE.test('abcd/1234')).toBe(false)
  })
})
