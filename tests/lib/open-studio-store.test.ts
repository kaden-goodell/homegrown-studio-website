/**
 * Tests for open-studio-store: day-keyed walk-in presence for headcount.
 * No pickup codes, no per-person checkout — just "this household was here
 * today" plus who stamped it.
 */
import { describe, it, expect } from 'vitest'
import { checkInOpenStudio, getOpenStudioDay, hereNowCount } from '@lib/open-studio-store'

const BY = { id: 'staff-1', name: 'Jess' }

describe('checkInOpenStudio / getOpenStudioDay', () => {
  it('writes a presence record for a household under the given date', async () => {
    const date = `2026-10-${Date.now() % 27 + 1}`
    const recordId = `wvr_os_${Date.now()}`
    await checkInOpenStudio(date, recordId, ['adult', 'child:0'], BY)

    const day = await getOpenStudioDay(date)
    expect(day[recordId].personIds).toEqual(['adult', 'child:0'])
    expect(day[recordId].by).toEqual(BY)
    expect(typeof day[recordId].at).toBe('string')
  })

  it('re-checking the same household is idempotent — one entry, updated `at`', async () => {
    const date = `2026-11-${Date.now() % 27 + 1}`
    const recordId = `wvr_os_repeat_${Date.now()}`
    await checkInOpenStudio(date, recordId, ['adult'], BY)
    const firstAt = (await getOpenStudioDay(date))[recordId].at

    await new Promise((r) => setTimeout(r, 5))
    await checkInOpenStudio(date, recordId, ['adult'], BY)

    const day = await getOpenStudioDay(date)
    expect(Object.keys(day)).toHaveLength(1)
    expect(new Date(day[recordId].at).getTime()).toBeGreaterThanOrEqual(new Date(firstAt).getTime())
  })

  it('an unknown date returns an empty day', async () => {
    const day = await getOpenStudioDay('2099-01-01')
    expect(day).toEqual({})
  })
})

describe('hereNowCount', () => {
  it('sums personIds across every household checked in that day', async () => {
    const date = `2026-12-${Date.now() % 27 + 1}`
    await checkInOpenStudio(date, 'wvr_a', ['adult', 'child:0', 'child:1'], BY)
    await checkInOpenStudio(date, 'wvr_b', ['adult'], BY)

    expect(await hereNowCount(date)).toBe(4)
  })

  it('is 0 for a day with no walk-ins', async () => {
    expect(await hereNowCount('2099-02-02')).toBe(0)
  })
})
