// tests/lib/seat-options.test.ts
import { describe, it, expect } from 'vitest'
import {
  validateOptions,
  optionsChangeRefusal,
  validateCutoffHours,
  effectiveCutoffHours,
  signupClosesAt,
  isSignupClosed,
  cutoffClosedMessage,
  optionIdFrom,
  PICKS_FINAL_LINE,
} from '@lib/seat-options'

const PAILS = { id: 'pumpkin-color', label: 'Pumpkin color', choices: ['Light Pink', 'Light Blue', 'Black', 'Lavender'] }

describe('validateOptions', () => {
  it('accepts the Pumpkin Pails question, trimmed', () => {
    expect(validateOptions([{ label: ' Pumpkin color ', choices: [' Light Pink', 'Light Blue', 'Black', 'Lavender '] }])).toEqual({ ok: true, value: [PAILS] })
  })

  it('keeps an id it is given and makes one from the label otherwise', () => {
    expect(optionIdFrom('Pumpkin color')).toBe('pumpkin-color')
    expect(optionIdFrom('!!!')).toBe('option')
    const r = validateOptions([{ id: 'color', label: 'Pumpkin color', choices: ['A', 'B'] }])
    expect(r.ok && r.value[0].id).toBe('color')
  })

  it.each([
    ['not a list', { label: 'x' }, 'Questions must be a list.'],
    ['four questions', [1, 2, 3, 4].map((n) => ({ label: `Q${n}`, choices: ['A', 'B'] })), 'A class can ask up to 3 questions.'],
    ['an empty label', [{ label: '  ', choices: ['A', 'B'] }], 'Each question needs a name of 1 to 40 characters.'],
    ['a 41-character label', [{ label: 'x'.repeat(41), choices: ['A', 'B'] }], 'Each question needs a name of 1 to 40 characters.'],
    ['one choice', [{ label: 'Color', choices: ['A'] }], '“Color” needs 2 to 12 choices.'],
    ['thirteen choices', [{ label: 'Color', choices: Array.from({ length: 13 }, (_, i) => `C${i}`) }], '“Color” needs 2 to 12 choices.'],
    ['a 31-character choice', [{ label: 'Color', choices: ['A', 'x'.repeat(31)] }], 'Each choice needs 1 to 30 characters.'],
    ['a repeated choice, any case', [{ label: 'Color', choices: ['Black', 'black'] }], '“black” is listed twice under “Color”.'],
    ['two questions with one name', [{ label: 'Color', choices: ['A', 'B'] }, { label: 'color', choices: ['C', 'D'] }], 'Two questions are both called “color”.'],
  ])('refuses %s', (_name, raw, error) => {
    expect(validateOptions(raw)).toEqual({ ok: false, error })
  })
})

describe('optionsChangeRefusal', () => {
  it('allows anything before anyone has picked', () => {
    expect(optionsChangeRefusal([PAILS], [], false)).toBeNull()
  })

  it('after picks: adding a choice and renaming the question are fine', () => {
    expect(optionsChangeRefusal([PAILS], [{ ...PAILS, label: 'Pail color', choices: [...PAILS.choices, 'Orange'] }], true)).toBeNull()
  })

  it('after picks: removing or renaming a choice is refused', () => {
    const msg = 'People have already picked for this class, so existing choices can’t be removed or renamed. You can add new ones.'
    expect(optionsChangeRefusal([PAILS], [{ ...PAILS, choices: ['Light Pink', 'Light Blue', 'Black'] }], true)).toBe(msg)
    expect(optionsChangeRefusal([PAILS], [{ ...PAILS, choices: ['Light Pink', 'Light Blue', 'Black', 'Purple'] }], true)).toBe(msg)
  })

  it('after picks: adding or removing a question is refused', () => {
    const msg = 'People have already picked for this class, so questions can’t be added or removed.'
    expect(optionsChangeRefusal([PAILS], [], true)).toBe(msg)
    expect(optionsChangeRefusal([PAILS], [PAILS, { id: 'ribbon', label: 'Ribbon', choices: ['Red', 'Gold'] }], true)).toBe(msg)
  })
})

describe('cutoff', () => {
  it('accepts whole hours 0–336 and null (the default)', () => {
    expect(validateCutoffHours(null)).toEqual({ ok: true, value: null })
    expect(validateCutoffHours(0)).toEqual({ ok: true, value: 0 })
    expect(validateCutoffHours(336)).toEqual({ ok: true, value: 336 })
    for (const bad of [-1, 337, 2.5, '24', undefined]) {
      expect(validateCutoffHours(bad)).toEqual({ ok: false, error: 'Sign-ups close 0 to 336 hours before the class, in whole hours.' })
    }
  })

  it('defaults to 0 h for a plain class and 24 h once it asks questions; a set value wins', () => {
    expect(effectiveCutoffHours({ options: [], signupCutoffHours: null })).toBe(0)
    expect(effectiveCutoffHours({ options: [PAILS], signupCutoffHours: null })).toBe(24)
    expect(effectiveCutoffHours({ options: [PAILS], signupCutoffHours: 48 })).toBe(48)
    expect(effectiveCutoffHours({ options: [], signupCutoffHours: 6 })).toBe(6)
  })

  it('Pails (Sun 18 Oct, 1 PM) closes at 1 PM Saturday', () => {
    const start = '2026-10-18T18:00:00.000Z'
    expect(signupClosesAt(start, { options: [PAILS], signupCutoffHours: null })).toBe('2026-10-17T18:00:00.000Z')
    expect(isSignupClosed(start, { options: [PAILS], signupCutoffHours: null }, new Date('2026-10-17T17:59:59.000Z'))).toBe(false)
    expect(isSignupClosed(start, { options: [PAILS], signupCutoffHours: null }, new Date('2026-10-17T18:00:00.000Z'))).toBe(true)
  })

  it('a plain class stays open until it starts', () => {
    const start = '2026-10-17T00:00:00.000Z'
    expect(isSignupClosed(start, { options: [], signupCutoffHours: null }, new Date('2026-10-16T23:30:00.000Z'))).toBe(false)
    expect(isSignupClosed(start, { options: [], signupCutoffHours: null }, new Date(start))).toBe(true)
  })

  it('counts real hours across the clock change (24 h before 7 PM CST Sun 1 Nov is 8 PM CDT Sat 31 Oct)', () => {
    const start = '2026-11-02T01:00:00.000Z' // Sun 1 Nov, 7 PM CST
    expect(signupClosesAt(start, { options: [PAILS], signupCutoffHours: null })).toBe('2026-11-01T01:00:00.000Z')
  })

  it('says when sign-ups closed in plain words', () => {
    expect(cutoffClosedMessage(0)).toBe('Sign-ups for this class have closed.')
    expect(cutoffClosedMessage(1)).toBe('Sign-ups for this class closed 1 hour before it starts.')
    expect(cutoffClosedMessage(24)).toBe('Sign-ups for this class closed 24 hours before it starts.')
  })

  it('keeps the one modal line exactly', () => {
    expect(PICKS_FINAL_LINE).toBe('Picks are made ahead for you, so they can’t be changed after you book.')
  })
})
