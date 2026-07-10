import { describe, it, expect } from 'vitest'
import { formatTime, formatSlotLabel, formatWhen, studioDayUtcRange } from '@lib/studio-time'
import { localToUtcISO } from '@lib/party-slots'

/**
 * All expected values are expressed as *absolute* UTC instants; the
 * formatted strings are deterministic regardless of the host machine's TZ.
 *
 * Reference instant: 2026-08-08T17:00:00.000Z = 12:00 PM CDT (America/Chicago, UTC-5)
 */
const NOON_CDT_UTC = '2026-08-08T17:00:00.000Z'

describe('formatTime', () => {
  it('renders 12:00 PM for noon CDT instant', () => {
    expect(formatTime(NOON_CDT_UTC)).toBe('12:00 PM')
  })
})

describe('formatSlotLabel', () => {
  it('renders "Sat, Aug 8 · 12:00 PM CT" for noon CDT instant', () => {
    expect(formatSlotLabel(NOON_CDT_UTC)).toBe('Sat, Aug 8 · 12:00 PM CT')
  })
})

describe('formatWhen', () => {
  it('renders studio-local weekday/month/day/hour/minute for noon CDT instant', () => {
    const result = formatWhen(NOON_CDT_UTC)
    // Should contain the Saturday date parts and time
    expect(result).toContain('Sat')
    expect(result).toContain('Aug')
    expect(result).toContain('8')
    expect(result).toContain('12:00 PM')
  })
})

describe('studioDayUtcRange', () => {
  it('returns correct UTC range for a CDT day (2026-08-08, UTC-5)', () => {
    const { startIso, endIso } = studioDayUtcRange('2026-08-08')
    // CDT = UTC-5; local midnight 2026-08-08 = 05:00Z, next local midnight = 2026-08-09T05:00Z
    expect(startIso).toBe('2026-08-08T05:00:00.000Z')
    // end = next local midnight minus 1ms
    expect(endIso).toBe('2026-08-09T04:59:59.999Z')
  })

  it('returns correct UTC range for a CST day (2026-12-19, UTC-6)', () => {
    const { startIso, endIso } = studioDayUtcRange('2026-12-19')
    expect(startIso).toBe('2026-12-19T06:00:00.000Z')
    expect(endIso).toBe('2026-12-20T05:59:59.999Z')
  })

  it('startIso matches localToUtcISO(ymd, "00:00") for CDT date', () => {
    const ymd = '2026-08-08'
    const { startIso } = studioDayUtcRange(ymd)
    expect(startIso).toBe(localToUtcISO(ymd, '00:00'))
  })

  it('startIso matches localToUtcISO(ymd, "00:00") for CST date', () => {
    const ymd = '2026-12-19'
    const { startIso } = studioDayUtcRange(ymd)
    expect(startIso).toBe(localToUtcISO(ymd, '00:00'))
  })

  it('DST spring-forward day (2026-03-08) is 23 hours long', () => {
    // Clocks spring forward at 2:00 AM CST → 3:00 AM CDT
    // Local midnight 2026-03-08 = UTC 06:00 (CST)
    // Local midnight 2026-03-09 = UTC 05:00 (CDT)
    // So the day spans 23 hours, not 24
    const { startIso, endIso } = studioDayUtcRange('2026-03-08')
    expect(startIso).toBe('2026-03-08T06:00:00.000Z')
    const durationMs = new Date(endIso).getTime() - new Date(startIso).getTime() + 1
    expect(durationMs).toBe(23 * 3600_000) // exactly 23 hours
    expect(endIso).toBe('2026-03-09T04:59:59.999Z')
  })
})
