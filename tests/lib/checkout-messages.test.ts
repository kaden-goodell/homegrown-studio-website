import { describe, it, expect } from 'vitest'
import { partyMessages, workshopMessages } from '@lib/checkout-messages'

describe('gift_card_short', () => {
  it('has a plain sentence in both maps', () => {
    expect(partyMessages.gift_card_short).toMatch(/gift card/i)
    expect(workshopMessages.gift_card_short).toMatch(/gift card/i)
  })
})
