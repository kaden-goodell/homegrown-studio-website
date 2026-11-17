import { describe, expect, it } from 'vitest'
import { isWalletCancel } from '@components/checkout/PaymentForm'

// Kaden, 17 Nov 2026: closing the Apple Pay sheet sent a "wallet failed" alert.
// Square's tokenize answers "Cancel", not "CANCEL".
describe('isWalletCancel', () => {
  it('treats Square\'s "Cancel" as the customer closing the sheet', () => {
    expect(isWalletCancel('Cancel')).toBe(true)
    expect(isWalletCancel('CANCEL')).toBe(true)
    expect(isWalletCancel('cancel')).toBe(true)
  })
  it('still treats real failures as failures', () => {
    expect(isWalletCancel('Error')).toBe(false)
    expect(isWalletCancel('Invalid')).toBe(false)
    expect(isWalletCancel(undefined)).toBe(false)
  })
})
