import { describe, it, expect, vi, beforeEach } from 'vitest'

// A cold function instance during a Blobs outage: every read of the switch throws.
const state = vi.hoisted(() => ({ fail: true, value: null as string | null }))
vi.mock('@lib/blob-store', () => ({
  makeKvStore: () => ({
    get: async () => {
      if (state.fail) throw new Error('Blobs down')
      return state.value
    },
    set: async (_k: string, v: string) => { state.value = v },
    getWithMeta: async () => {
      if (state.fail) throw new Error('Blobs down')
      return { value: state.value, etag: state.value ? 'e1' : null }
    },
    setIfMatch: async (_k: string, v: string) => { state.value = v; return true },
  }),
}))

import { bookingsOpenNow, kindOpenNow, bookingsClosedResponse } from '@lib/bookings-gate'
import { getSwitchState, getSwitchStateStrict, hiccupPauseNote, resetSwitchCache } from '@lib/booking-switch'

beforeEach(() => {
  resetSwitchCache()
  state.fail = true
  state.value = null
  process.env.BOOKINGS_OPEN = 'true'
})

describe('the switch on a fresh server that can’t reach the store', () => {
  it('treats every switched kind as paused, with the hiccup note (never BOOKINGS_OPEN=true)', async () => {
    for (const k of ['parties', 'workshops', 'kits'] as const) expect(await bookingsOpenNow(undefined, k)).toBe(false)
    expect(await kindOpenNow()).toBe(false)
    const res = await bookingsClosedResponse()
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe(hiccupPauseNote())
    expect((await getSwitchState()).source).toBe('unreadable')
  })

  it('a warm server keeps its last answer through the outage', async () => {
    state.fail = false
    state.value = JSON.stringify({ v: 1, open: { parties: true, workshops: false, kits: false }, pauseNote: '', previewToken: 't', updatedAt: '2026-11-02T15:00:00.000Z', history: [] })
    expect(await kindOpenNow('parties')).toBe(true)
    state.fail = true
    expect(await getSwitchState({ fresh: true }).then((s) => s.open.parties)).toBe(true)
    expect(await getSwitchState({ fresh: true }).then((s) => s.open.workshops)).toBe(false)
  })

  it('/admin is told it couldn’t be read (no guessing)', async () => {
    await expect(getSwitchStateStrict()).rejects.toThrow(/Blobs down/)
  })

  it('once the store answers again, bookings follow it', async () => {
    expect(await kindOpenNow('parties')).toBe(false)
    state.fail = false
    resetSwitchCache()
    expect(await kindOpenNow('parties')).toBe(true) // never saved: BOOKINGS_OPEN applies again
  })
})
