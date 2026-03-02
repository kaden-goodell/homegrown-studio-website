import { describe, it, expect } from 'vitest'
import { MockCapacityProvider, NullCapacityProvider } from '@providers/mock/capacity'

describe('MockCapacityProvider', () => {
  const provider = new MockCapacityProvider()

  it('returns capacity for known slot IDs', async () => {
    const result = await provider.getAvailableCapacity(['slot-1', 'slot-2'])
    expect(result.size).toBe(2)
    const cap1 = result.get('slot-1')
    expect(cap1).not.toBeNull()
    expect(cap1!.availableCapacity).toBeGreaterThanOrEqual(0)
    expect(cap1!.totalCapacity).toBeGreaterThan(0)
  })
})

describe('NullCapacityProvider', () => {
  const provider = new NullCapacityProvider()

  it('returns null for all slot IDs', async () => {
    const result = await provider.getAvailableCapacity(['slot-1', 'slot-2'])
    expect(result.get('slot-1')).toBeNull()
    expect(result.get('slot-2')).toBeNull()
  })
})
