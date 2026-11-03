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

import { addCafeWaiting, dayTotals, getCafeWaiting, removeCafeWaiting, undoOpenStudio, waitingMatches, entryCounts, markCafeWaitingSent, setCafeWaitingSigned, CafeWaitingFullError, WAITING_CAP } from '@lib/open-studio-store'

const freshDay = () => `${2100 + Math.floor(Math.random() * 800)}-0${1 + Math.floor(Math.random() * 9)}-1${Math.floor(Math.random() * 9)}`

describe('Craft Café: names, Undo and totals', () => {
  it('keeps the family’s name and who came; Undo takes them off and says what it removed', async () => {
    const date = freshDay()
    await checkInOpenStudio(date, 'wvr_n', ['adult', 'child:0'], BY, { name: 'Jane Doe', people: ['Jane Doe', 'Mia'] })
    expect((await getOpenStudioDay(date)).wvr_n).toMatchObject({ name: 'Jane Doe', people: ['Jane Doe', 'Mia'] })
    expect(await undoOpenStudio(date, 'wvr_n')).toMatchObject({ name: 'Jane Doe' })
    expect(await getOpenStudioDay(date)).toEqual({})
    expect(await undoOpenStudio(date, 'wvr_n')).toBeNull()
  })

  it('counts adults (the signer) and kids (child:N) per family and per day', () => {
    expect(entryCounts({ personIds: ['adult', 'child:0', 'child:2'] })).toEqual({ people: 3, adults: 1, kids: 2 })
    expect(dayTotals({
      a: { personIds: ['adult', 'child:0'], at: '', by: BY },
      b: { personIds: ['child:0'], at: '', by: BY },
    })).toEqual({ households: 2, people: 3, adults: 1, kids: 2 })
  })
})

describe('Craft Café: Waiting on a waiver', () => {
  it('adds, never doubles a texted family (same phone), and removes', async () => {
    const date = freshDay()
    const a = await addCafeWaiting(date, { name: 'Kim', how: 'text', by: BY, phone: '2565550199' })
    const again = await addCafeWaiting(date, { name: 'Kim Lee', how: 'text', by: BY, phone: '2565550199' })
    expect(again).toEqual({ entry: a.entry, existing: true })
    const b = await addCafeWaiting(date, { name: 'New family', how: 'ipad', by: BY })
    expect((await getCafeWaiting(date)).map((w) => w.id)).toEqual([a.entry.id, b.entry.id])
    expect((await removeCafeWaiting(date, [a.entry.id])).map((w) => w.name)).toEqual(['Kim'])
    expect((await getCafeWaiting(date)).map((w) => w.id)).toEqual([b.entry.id])
    expect(await removeCafeWaiting(date, ['cw_gone'])).toEqual([])
  })

  it('a signed waiver matches by phone, or by the name typed, and only when signed after they were started', () => {
    const at = '2026-11-07T15:00:00.000Z'
    const signed = { firstName: 'Kim', lastName: 'Lee', phone: '(256) 555-0199', signedAt: '2026-11-07T15:05:00.000Z' }
    expect(waitingMatches({ name: 'K', phone: '2565550199', at }, signed)).toBe(true)
    expect(waitingMatches({ name: 'kim  lee', at }, signed)).toBe(true)
    expect(waitingMatches({ name: 'Lee', at }, signed)).toBe(true)
    expect(waitingMatches({ name: 'Kim', at }, signed)).toBe(false) // a first name alone is too loose
    expect(waitingMatches({ name: 'New family', at }, signed)).toBe(false)
    expect(waitingMatches({ name: 'Kim Lee', at }, { ...signed, signedAt: '2026-10-01T00:00:00.000Z' })).toBe(false) // an old waiver
    // Clearing the list on a check-in: a last name alone could be another family.
    expect(waitingMatches({ name: 'Lee', at }, signed, { lastNameOnly: false })).toBe(false)
    expect(waitingMatches({ name: 'Kim Lee', at }, signed, { lastNameOnly: false })).toBe(true)
  })

  it('at the cap, a new family is refused, never trimmed; a texted family already there still comes back', async () => {
    const date = freshDay()
    const first = await addCafeWaiting(date, { name: 'Kim', how: 'text', by: BY, phone: '2565550199' })
    for (let i = 1; i < WAITING_CAP; i++) await addCafeWaiting(date, { name: `Fam ${i}`, how: 'qr', by: BY })
    await expect(addCafeWaiting(date, { name: 'One more', how: 'qr', by: BY })).rejects.toBeInstanceOf(CafeWaitingFullError)
    expect((await addCafeWaiting(date, { name: 'Kim', how: 'text', by: BY, phone: '2565550199' })).entry.id).toBe(first.entry.id)
    const list = await getCafeWaiting(date)
    expect(list).toHaveLength(WAITING_CAP)
    expect(list[0].id).toBe(first.entry.id)
  })

  it('“existing” answers from the same read: an entry removed in between never crashes it', async () => {
    const date = freshDay()
    const a = await addCafeWaiting(date, { name: 'Kim', how: 'text', by: BY, phone: '2565550199' })
    const [again] = await Promise.all([
      addCafeWaiting(date, { name: 'Kim', how: 'text', by: BY, phone: '2565550199' }),
      removeCafeWaiting(date, [a.entry.id]),
    ])
    // Either it saw Kim (existing) or Kim was already gone (added afresh): never a throw.
    expect(again.entry.phone).toBe('2565550199')
  })

  it('remembers whether a text went, and an iPad family’s waiver and name', async () => {
    const date = freshDay()
    const t = await addCafeWaiting(date, { name: 'Kim', how: 'text', by: BY, phone: '2565550199' })
    await markCafeWaitingSent(date, t.entry.id, false)
    expect((await addCafeWaiting(date, { name: 'Kim', how: 'text', by: BY, phone: '2565550199' })).entry.sent).toBe(false)
    const i = await addCafeWaiting(date, { name: 'New family', how: 'ipad', by: BY })
    expect(await setCafeWaitingSigned(date, i.entry.id, { recordId: 'w1', name: 'Jo Park' })).toBe(true)
    expect((await getCafeWaiting(date)).find((w) => w.id === i.entry.id)).toMatchObject({ name: 'Jo Park', recordId: 'w1' })
    expect(await setCafeWaitingSigned(date, 'cw_gone', { recordId: 'w1', name: 'Jo Park' })).toBe(false)
  })
})
