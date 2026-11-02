import { describe, it, expect } from 'vitest'

describe('retired booking endpoints', () => {
  // No page used them, and cancel took any Square booking id with no sign-in.
  it('create.json and cancel.json are gone', async () => {
    const pages = import.meta.glob('/src/pages/api/booking/*.ts')
    expect(Object.keys(pages).some((p) => /\/(create|cancel)\.json\.ts$/.test(p))).toBe(false)
  })

  // Stage 2 Task 14 (S2-R19): asked Square's Bookings availability for anyone, used by no page.
  // Party times come from our own party book (/api/party/availability.json, available-dates.json).
  it('availability.json is gone; only fix-email stays', async () => {
    const pages = Object.keys(import.meta.glob('/src/pages/api/booking/*.ts'))
    expect(pages.map((p) => p.split('/').pop())).toEqual(['fix-email.json.ts'])
  })

  it('no page or component calls the old endpoints', async () => {
    const files = import.meta.glob(['/src/**/*.{ts,tsx,astro}', '!/src/pages/api/booking/**'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    const callers = Object.entries(files).filter(([, text]) => /api\/booking\/(availability|create|cancel)\.json/.test(text)).map(([f]) => f)
    expect(callers).toEqual([])
  })
})
