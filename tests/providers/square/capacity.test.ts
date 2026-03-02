import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SquareInternalCapacityProvider } from '@providers/square/capacity'

const mockNotification = { send: vi.fn().mockResolvedValue(undefined) }

const config = { unitToken: 'test-unit-token' }

function makeProvider() {
  return new SquareInternalCapacityProvider(config, mockNotification)
}

function mockFetchSuccess(instances: any[]) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ class_schedule_instances: instances }),
  })
}

describe('SquareInternalCapacityProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockNotification.send.mockClear()
  })

  it('returns correct CapacityInfo for a single slot', async () => {
    global.fetch = mockFetchSuccess([
      { capacity: 12, available_capacity: 8 },
    ])

    const provider = makeProvider()
    const result = await provider.getAvailableCapacity(['slot-abc'])

    expect(result.size).toBe(1)
    const info = result.get('slot-abc')
    expect(info).toEqual({
      slotId: 'slot-abc',
      totalCapacity: 12,
      availableCapacity: 8,
    })
  })

  it('sends correct headers (Origin, Referer, Content-Type)', async () => {
    global.fetch = mockFetchSuccess([
      { capacity: 10, available_capacity: 5 },
    ])

    const provider = makeProvider()
    await provider.getAvailableCapacity(['slot-1'])

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('unit_token=test-unit-token'),
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://book.squareup.com',
          Referer: 'https://book.squareup.com/',
        },
      }),
    )
  })

  it('returns null for failed slots and does not throw', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

    const provider = makeProvider()
    const result = await provider.getAvailableCapacity(['slot-fail'])

    expect(result.get('slot-fail')).toBeNull()
  })

  it('sends notification on failure', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'))

    const provider = makeProvider()
    await provider.getAvailableCapacity(['slot-x'])

    expect(mockNotification.send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'api-failure',
        title: 'Square Internal Capacity API Failure',
        severity: 'warning',
        details: expect.objectContaining({
          error: 'Connection refused',
          is_internal_api: true,
        }),
      }),
    )
  })

  it('handles multiple slot IDs in a single batch request', async () => {
    global.fetch = mockFetchSuccess([
      { capacity: 10, available_capacity: 7 },
      { capacity: 8, available_capacity: 3 },
    ])

    const provider = makeProvider()
    const result = await provider.getAvailableCapacity(['slot-a', 'slot-b'])

    expect(result.size).toBe(2)
    expect(result.get('slot-a')).toEqual({
      slotId: 'slot-a',
      totalCapacity: 10,
      availableCapacity: 7,
    })
    expect(result.get('slot-b')).toEqual({
      slotId: 'slot-b',
      totalCapacity: 8,
      availableCapacity: 3,
    })

    // Should only make one fetch call (batched)
    expect(global.fetch).toHaveBeenCalledTimes(1)

    // Verify the body includes all slot IDs
    const callArgs = (global.fetch as any).mock.calls[0]
    const body = JSON.parse(callArgs[1].body)
    expect(body.query.filter.class_schedule_instance_ids).toEqual(['slot-a', 'slot-b'])
  })

  it('logs with is_internal_api: true', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    global.fetch = mockFetchSuccess([
      { capacity: 6, available_capacity: 2 },
    ])

    const provider = makeProvider()
    await provider.getAvailableCapacity(['slot-log'])

    const logCalls = consoleSpy.mock.calls
    const loggedEntry = logCalls.find((call) => {
      try {
        const parsed = JSON.parse(call[0])
        return parsed.data?.is_internal_api === true
      } catch {
        return false
      }
    })

    expect(loggedEntry).toBeDefined()
    consoleSpy.mockRestore()
  })

  it('returns null when HTTP response is not ok', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    })

    const provider = makeProvider()
    const result = await provider.getAvailableCapacity(['slot-err'])

    expect(result.get('slot-err')).toBeNull()
    expect(mockNotification.send).toHaveBeenCalled()
  })

  it('returns empty map for empty slotIds array', async () => {
    global.fetch = vi.fn()

    const provider = makeProvider()
    const result = await provider.getAvailableCapacity([])

    expect(result.size).toBe(0)
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
