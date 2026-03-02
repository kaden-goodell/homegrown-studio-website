export interface CapacityInfo {
  slotId: string
  totalCapacity: number
  availableCapacity: number
}

export interface CapacityProvider {
  getAvailableCapacity(slotIds: string[]): Promise<Map<string, CapacityInfo | null>>
}
