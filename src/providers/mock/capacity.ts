import type { CapacityInfo, CapacityProvider } from '../interfaces/capacity'

function deterministicAvailable(slotId: string, total: number): number {
  let hash = 0
  for (let i = 0; i < slotId.length; i++) {
    hash = (hash * 31 + slotId.charCodeAt(i)) | 0
  }
  return Math.abs(hash) % (total + 1)
}

export class MockCapacityProvider implements CapacityProvider {
  async getAvailableCapacity(slotIds: string[]): Promise<Map<string, CapacityInfo | null>> {
    const result = new Map<string, CapacityInfo | null>()
    for (const slotId of slotIds) {
      const totalCapacity = 12
      result.set(slotId, {
        slotId,
        totalCapacity,
        availableCapacity: deterministicAvailable(slotId, totalCapacity),
      })
    }
    return result
  }
}

export class NullCapacityProvider implements CapacityProvider {
  async getAvailableCapacity(slotIds: string[]): Promise<Map<string, CapacityInfo | null>> {
    const result = new Map<string, CapacityInfo | null>()
    for (const slotId of slotIds) {
      result.set(slotId, null)
    }
    return result
  }
}
