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
  selectionKey,
  firstMissingPick,
  picksFromSelections,
  picksNote,
  validatePicks,
  seatPickLines,
  choiceTotals,
  totalsLine,
  picksShort,
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

describe('picks in a form', () => {
  const RIBBON = { id: 'ribbon', label: 'Ribbon', choices: ['Red', 'Gold'] }
  const sel = { [selectionKey(1, 'pumpkin-color')]: 'Lavender', [selectionKey(2, 'pumpkin-color')]: 'Black', [selectionKey(3, 'pumpkin-color')]: 'Black' }

  it('finds the first seat still to answer', () => {
    expect(firstMissingPick([PAILS], 2, sel)).toBeNull()
    expect(firstMissingPick([PAILS], 4, sel)).toEqual({ seat: 4, option: PAILS })
    expect(firstMissingPick([PAILS, RIBBON], 1, sel)).toEqual({ seat: 1, option: RIBBON })
  })

  it('sends picks for the seats booked only', () => {
    expect(picksFromSelections([PAILS], 2, sel)).toEqual([
      { seat: 1, optionId: 'pumpkin-color', choice: 'Lavender' },
      { seat: 2, optionId: 'pumpkin-color', choice: 'Black' },
    ])
  })

  it('writes the Square note in the class’s choice order', () => {
    expect(picksNote([PAILS], picksFromSelections([PAILS], 3, sel))).toBe('Pumpkin color: Black ×2, Lavender ×1')
    expect(picksNote([PAILS], [])).toBe('')
    expect(
      picksNote([PAILS, RIBBON], [
        { seat: 1, optionId: 'pumpkin-color', choice: 'Lavender' },
        { seat: 1, optionId: 'ribbon', choice: 'Gold' },
      ]),
    ).toBe('Pumpkin color: Lavender ×1 · Ribbon: Gold ×1')
  })
})

describe('validatePicks (the server’s check)', () => {
  const two = [
    { seat: 2, optionId: 'pumpkin-color', choice: 'Black' },
    { seat: 1, optionId: 'pumpkin-color', choice: 'Lavender' },
  ]

  it('accepts one listed choice per seat, in seat order', () => {
    expect(validatePicks([PAILS], 2, two)).toEqual({
      ok: true,
      value: [{ seat: 1, optionId: 'pumpkin-color', choice: 'Lavender' }, { seat: 2, optionId: 'pumpkin-color', choice: 'Black' }],
    })
  })

  it('a class with no questions takes no picks', () => {
    expect(validatePicks([], 2, undefined)).toEqual({ ok: true, value: [] })
    expect(validatePicks([], 2, [])).toEqual({ ok: true, value: [] })
    expect(validatePicks([], 2, two)).toEqual({ ok: false, error: 'This class has nothing to pick. Refresh and try again.' })
  })

  it.each([
    ['a seat with no pick', [two[1]], 'Pick a pumpkin color for seat 2.'],
    ['a seat beyond the booking', [...two, { seat: 3, optionId: 'pumpkin-color', choice: 'Black' }], 'The seat picks didn’t come through. Refresh and try again.'],
    ['an unknown question', [...two, { seat: 1, optionId: 'ribbon', choice: 'Red' }], 'This class’s questions have changed. Refresh and pick again.'],
    ['a choice not offered', [two[1], { seat: 2, optionId: 'pumpkin-color', choice: 'Orange' }], 'Seat 2: “Orange” isn’t one of the pumpkin color choices.'],
    ['two picks for one seat', [...two, { seat: 1, optionId: 'pumpkin-color', choice: 'Black' }], 'Seat 1 has two pumpkin color picks.'],
    ['something that is not a list', 'Lavender', 'The seat picks didn’t come through. Refresh and try again.'],
  ])('refuses %s', (_name, raw, error) => {
    expect(validatePicks([PAILS], 2, raw)).toEqual({ ok: false, error })
  })

  it('writes one line per seat for the email', () => {
    expect(seatPickLines([PAILS], [{ seat: 1, optionId: 'pumpkin-color', choice: 'Lavender' }, { seat: 2, optionId: 'pumpkin-color', choice: 'Black' }])).toEqual([
      'Seat 1 · Pumpkin color: Lavender',
      'Seat 2 · Pumpkin color: Black',
    ])
  })
})

describe('roster wording', () => {
  const p = (seat: number, choice: string) => ({ seat, optionId: 'pumpkin-color', choice })

  it('totals each choice', () => {
    expect(choiceTotals([PAILS], [p(1, 'Lavender'), p(2, 'Lavender'), p(1, 'Black')])).toEqual({ 'pumpkin-color': { Lavender: 2, Black: 1 } })
  })

  it('writes the strip most picked first, ties in the class’s order', () => {
    expect(totalsLine(PAILS, { Lavender: 6, Black: 4, 'Light Pink': 3, 'Light Blue': 2 })).toBe('Pumpkin color — Lavender 6 · Black 4 · Light Pink 3 · Light Blue 2')
    expect(totalsLine(PAILS, { Black: 1, 'Light Pink': 1 })).toBe('Pumpkin color — Light Pink 1 · Black 1')
    expect(totalsLine(PAILS, {})).toBe('Pumpkin color — no picks yet')
  })

  it('writes a family’s picks short', () => {
    expect(picksShort([p(1, 'Lavender'), p(2, 'Lavender'), p(3, 'Black')])).toBe('Lavender ×2, Black ×1')
  })
})
