// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const fake = vi.hoisted(() => {
  const data = new Map<string, string>()
  return {
    data,
    store: {
      async setIfMatch(key: string, value: string, _etag: string | null, exists: boolean) {
        if (!exists && data.has(key)) return false
        data.set(key, value)
        return true
      },
    },
  }
})
vi.mock('@lib/blob-store', () => ({ makeKvStore: () => fake.store }))
const texts = vi.hoisted(() => vi.fn(async (_: string) => ({ attempted: 1, sent: 1 })))
vi.mock('@lib/owner-alert', () => ({ alertOwners: texts }))

import { alertCardSetupOnce, CARD_SETUP_ALERT } from '@lib/saved-card-alerts'

beforeEach(() => { fake.data.clear(); texts.mockClear() })

describe('I3: owners hear of a saved-card setup problem once a day', () => {
  it('first hit texts; the rest of the Chicago day stays quiet; the next day texts again', async () => {
    const day1 = new Date('2026-11-05T15:00:00Z')
    expect(await alertCardSetupOnce('charge', day1)).toBe(true)
    expect(await alertCardSetupOnce('save', new Date('2026-11-05T23:00:00Z'))).toBe(false)
    expect(texts).toHaveBeenCalledTimes(1)
    expect(texts.mock.calls[0][0]).toBe(CARD_SETUP_ALERT)
    expect(CARD_SETUP_ALERT).not.toMatch(/Netlify|Kaden|dashboard|config/i)
    expect(await alertCardSetupOnce('charge', new Date('2026-11-06T15:00:00Z'))).toBe(true)
  })
})
