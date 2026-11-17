import { describe, it, expect, vi } from 'vitest'
import { raiseIncident, _setIncidentDeps } from '@lib/booking-alarms'
import { memoryKv } from '../helpers-memory-kv'

describe('alarm texts during test runs', () => {
  it('the real sender never reaches Quo from a test run', async () => {
    const ask = vi.fn()
    vi.stubGlobal('fetch', ask)
    _setIncidentDeps({ store: memoryKv() }) // real sender
    expect(await raiseIncident({ key: 'k', text: 'x' })).toBe(false)
    expect(ask).not.toHaveBeenCalled()
    _setIncidentDeps(null)
    vi.unstubAllGlobals()
  })
})
