import { describe, it, expect } from 'vitest'
import {
  attemptKey,
  chargeOutcomeOf,
  classifyClassBookingError,
  isAttemptId,
  newAttemptId,
  squareErrorCodes,
} from '@lib/checkout-attempt'
import {
  UNKNOWN_OUTCOME_MESSAGE,
  messageForFailure,
  outcomeUnknown,
  partyMessages,
  workshopMessages,
} from '@lib/checkout-messages'

describe('attempt IDs', () => {
  it('makes a new ID each time, in the shape the server accepts', () => {
    const a = newAttemptId()
    const b = newAttemptId()
    expect(a).not.toBe(b)
    expect(isAttemptId(a)).toBe(true)
    expect(isAttemptId(b)).toBe(true)
  })

  it('refuses anything that is not an attempt ID', () => {
    for (const bad of [undefined, null, '', 'abc', 42, '../../etc', 'x'.repeat(36), '12345678-1234-1234-1234-1234567890ab:pay']) {
      expect(isAttemptId(bad)).toBe(false)
    }
  })

  it('gives each step its own key, the same every time, within Square’s 45 characters', () => {
    const id = '3f2b8a0e-5c1d-4e7a-9b3c-0a1b2c3d4e5f'
    expect(attemptKey(id, 'pay')).toBe(`${id}:pay`)
    expect(attemptKey(id, 'pay')).toBe(attemptKey(id, 'pay'))
    expect(new Set([attemptKey(id, 'book'), attemptKey(id, 'order'), attemptKey(id, 'pay')]).size).toBe(3)
    for (const step of ['book', 'order', 'pay'] as const) {
      expect(attemptKey(id, step).length).toBeLessThanOrEqual(45)
    }
  })
})

describe('chargeOutcomeOf', () => {
  it('knows the card was not charged when Square refused the request', () => {
    expect(chargeOutcomeOf({ statusCode: 400, errors: [{ code: 'CARD_DECLINED' }] })).toBe('not_charged')
    expect(chargeOutcomeOf({ statusCode: 402 })).toBe('not_charged')
    expect(chargeOutcomeOf({ statusCode: 429 })).toBe('not_charged')
  })

  it('does not know when there was no answer', () => {
    expect(chargeOutcomeOf(new TypeError('fetch failed'))).toBe('unknown')
    expect(chargeOutcomeOf(new Error('The operation was aborted'))).toBe('unknown')
    expect(chargeOutcomeOf(undefined)).toBe('unknown')
  })

  it('does not know when the key was used before: that says nothing about the earlier charge', () => {
    expect(chargeOutcomeOf({ statusCode: 400, errors: [{ code: 'IDEMPOTENCY_KEY_REUSED' }] })).toBe('unknown')
  })

  it('does not know when Square itself failed or timed out', () => {
    expect(chargeOutcomeOf({ statusCode: 500 })).toBe('unknown')
    expect(chargeOutcomeOf({ statusCode: 503 })).toBe('unknown')
    expect(chargeOutcomeOf({ statusCode: 408 })).toBe('unknown')
  })
})

describe('squareErrorCodes', () => {
  it('lists the codes Square gave', () => {
    expect(squareErrorCodes({ errors: [{ code: 'CARD_DECLINED' }, { code: 'CVV_FAILURE' }] })).toEqual(['CARD_DECLINED', 'CVV_FAILURE'])
  })
  it('is empty when there are none', () => {
    expect(squareErrorCodes(new Error('boom'))).toEqual([])
    expect(squareErrorCodes(null)).toEqual([])
  })
})

describe('classifyClassBookingError', () => {
  it('recognises a declined card at the payment step', () => {
    expect(classifyClassBookingError('{"errors":[{"detail":"Could not charge given payment source"}]}', 'complete')).toBe('card_declined')
    expect(classifyClassBookingError('Card declined', 'complete')).toBe('card_declined')
  })

  it('recognises a full class', () => {
    expect(classifyClassBookingError('Class is full', 'create')).toBe('sold_out')
    expect(classifyClassBookingError('Not enough seats available', 'create')).toBe('sold_out')
    expect(classifyClassBookingError('{"message":"No capacity remaining"}', 'create')).toBe('sold_out')
  })

  it('recognises someone who already has a seat', () => {
    expect(classifyClassBookingError('Customer has already booked this class', 'create')).toBe('already_booked')
    expect(classifyClassBookingError('duplicate booking', 'create')).toBe('already_booked')
  })

  it('never blames the card before the payment step', () => {
    expect(classifyClassBookingError('card', 'create')).toBe('unavailable')
  })

  it('falls back to a plain "our end" for anything it cannot read', () => {
    expect(classifyClassBookingError('<html>502 Bad Gateway</html>', 'create')).toBe('unavailable')
    expect(classifyClassBookingError('', 'complete')).toBe('unavailable')
  })
})

describe('customer messages', () => {
  const technical = /[{}<>]|https?:|\b(null|undefined|exception|error code|status \d{3}|json|fetch)\b/i

  it('contain nothing technical', () => {
    for (const set of [workshopMessages, partyMessages]) {
      for (const message of Object.values(set)) expect(message).not.toMatch(technical)
    }
  })

  it('never claim "not charged" when the outcome is unknown', () => {
    expect(UNKNOWN_OUTCOME_MESSAGE).not.toMatch(/not charged|nothing was charged|wasn’t charged/i)
    expect(UNKNOWN_OUTCOME_MESSAGE).toMatch(/not sure/i)
    expect(UNKNOWN_OUTCOME_MESSAGE).toContain('(256) 464-1710')
    expect(workshopMessages.unknown_outcome).toBe(UNKNOWN_OUTCOME_MESSAGE)
    expect(partyMessages.unknown_outcome).toBe(UNKNOWN_OUTCOME_MESSAGE)
  })

  it('never claim "not charged" to someone who already has a booking', () => {
    expect(workshopMessages.already_booked).not.toMatch(/not charged|nothing was charged/i)
    expect(partyMessages.already_booked).not.toMatch(/not charged|nothing was charged/i)
  })
})

describe('outcomeUnknown', () => {
  it('is unknown when nothing readable came back', () => {
    expect(outcomeUnknown(null)).toBe(true)
    expect(outcomeUnknown({ status: 502, body: null })).toBe(true)
  })

  it('is unknown when the server says it is', () => {
    expect(outcomeUnknown({ status: 502, body: { code: 'unknown_outcome' } })).toBe(true)
  })

  it('is unknown for a server failure that came without a code', () => {
    expect(outcomeUnknown({ status: 500, body: { detail: 'boom' } })).toBe(true)
  })

  it('is known once the server has said plainly what happened', () => {
    for (const code of ['card_declined', 'slot_taken', 'sold_out', 'already_booked', 'unavailable', 'invalid']) {
      expect(outcomeUnknown({ status: 409, body: { code } })).toBe(false)
    }
    expect(outcomeUnknown({ status: 400, body: { detail: 'Full name and email are required' } })).toBe(false)
  })
})

describe('messageForFailure', () => {
  it('treats no answer at all as unknown', () => {
    expect(messageForFailure(null, partyMessages)).toBe(UNKNOWN_OUTCOME_MESSAGE)
  })

  it('treats an answer it cannot read as unknown', () => {
    expect(messageForFailure({ status: 502, body: null }, workshopMessages)).toBe(UNKNOWN_OUTCOME_MESSAGE)
  })

  it('uses the sentence the server chose', () => {
    expect(
      messageForFailure({ status: 402, body: { code: 'card_declined', detail: 'Your card was declined. Nothing was charged. Try another card.' } }, workshopMessages),
    ).toBe('Your card was declined. Nothing was charged. Try another card.')
  })

  it('falls back to its own sentence for a known code with no detail', () => {
    expect(messageForFailure({ status: 409, body: { code: 'sold_out' } }, workshopMessages)).toBe(workshopMessages.sold_out)
  })

  it('does not vouch for a server failure that came without a code', () => {
    expect(messageForFailure({ status: 500, body: { detail: 'Your card was not charged.' } }, partyMessages)).toBe(UNKNOWN_OUTCOME_MESSAGE)
  })

  it('shows a plain validation sentence that came without a code', () => {
    expect(messageForFailure({ status: 400, body: { detail: 'Full name and email are required' } }, partyMessages)).toBe('Full name and email are required')
  })
})
