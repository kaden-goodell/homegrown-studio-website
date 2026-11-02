import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// The fs-backed store never loses a CAS, so wrap setIfMatch: a test can make
// the next conditional write lose once, running another writer first (a
// concurrent writer landing between the read and the write).
const hook = vi.hoisted(() => ({ beforeLose: null as null | (() => Promise<void>), loseNext: false, writes: 0, loseKey: null as string | null }))
// R41 tests play a deploy preview with no store of its own; everything else plays local dev.
const site = vi.hoisted(() => ({ context: 'dev' as string }))
vi.mock('@lib/deploy-context', () => ({ deployContext: () => site.context }))
vi.mock('@lib/blob-store', async (orig) => {
  const real = await orig<typeof import('@lib/blob-store')>()
  return {
    ...real,
    makeKvStore: (...a: Parameters<typeof real.makeKvStore>) => {
      const kv = real.makeKvStore(...a)
      return {
        ...kv,
        set: async (...b: Parameters<typeof kv.set>) => { hook.writes++; return kv.set(...b) },
        setIfMatch: async (...b: Parameters<typeof kv.setIfMatch>) => {
          hook.writes++
          if (hook.loseKey && b[0].startsWith(hook.loseKey)) {
            hook.loseKey = null
            const other = hook.beforeLose
            hook.beforeLose = null
            if (other) await other()
            return false
          }
          if (hook.loseNext) {
            hook.loseNext = false
            const other = hook.beforeLose
            hook.beforeLose = null
            if (other) await other()
            return false
          }
          return kv.setIfMatch(...b)
        },
      }
    },
  }
})

import { getAvailability, getAvailabilityMany, saveAvailability } from '@lib/staffing/availability-store'
import { getEntries, listAllEntryKeys, noteSeen, readPartyIndex, updateEntry } from '@lib/staffing/staffing-store'
import { findFeed, LINK_RACE, makeFeed, revokeFeed, touchFeed } from '@lib/staffing/feed-store'
import { StaleError, StaffingError } from '@lib/staffing/errors'
import { TestSiteStoreError } from '@lib/classes/test-site-guard'
import { withAssigned, withoutAssigned, withAsk, withoutAsk, withSeen } from '@lib/staffing/rules'
import type { Assignment, DayMark } from '@lib/staffing/types'

const kaden = { id: 'TM1', name: 'Kaden' }
const can = (from: string, to: string): DayMark => ({ kind: 'can', range: { from, to }, note: '' })
const empty = () => ({ weekly: { '0': null, '1': null, '2': null, '3': null, '4': null, '5': null, '6': null }, dates: {} })
let n = 0
const uid = (p: string) => `${p}${Date.now().toString(36)}${n++}`
const assignment = (staffId: string, name: string): Assignment => ({ staffId, name, by: kaden, at: new Date().toISOString(), notified: null })

beforeEach(() => {
  hook.loseNext = false
  hook.loseKey = null
  hook.beforeLose = null
})

describe('availability store', () => {
  it('saves and reads back, with history newest first', async () => {
    const id = uid('TMA')
    expect(await getAvailability(id)).toBeNull()
    const a = await saveAvailability(id, 'Jessica', { ...empty(), weekly: { ...empty().weekly, '6': can('09:00', '17:00') } }, { id, name: 'Jessica' }, null)
    expect(a.staffId).toBe(id)
    expect(a.name).toBe('Jessica')
    expect(a.weekly['6']).toEqual(can('09:00', '17:00'))
    expect(a.updatedAt).toBeTruthy()
    expect(a.history[0]).toMatchObject({ by: { id, name: 'Jessica' }, change: 'Usual week: Sat' })
    expect(await getAvailability(id)).toEqual(a)
    const b = await saveAvailability(id, 'Jessica', { ...a, dates: { '2099-01-02': [can('10:00', '11:00')] } }, kaden, a.updatedAt)
    expect(b.history.map((h) => h.change)).toEqual(['Dates: Fri, Jan 2', 'Usual week: Sat'])
    expect(Date.parse(b.updatedAt!)).toBeGreaterThan(Date.parse(a.updatedAt!))
  })

  it('refuses a stale save with the current times', async () => {
    const id = uid('TMB')
    const a = await saveAvailability(id, 'Jessica', empty(), kaden, null)
    try {
      await saveAvailability(id, 'Jessica', empty(), kaden, '2020-01-01T00:00:00.000Z')
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(StaleError)
      expect((e as StaleError<unknown>).status).toBe(409)
      expect((e as StaleError<unknown>).message).toBe('Someone changed your times on another device. Here they are.')
      expect((e as StaleError<any>).current.updatedAt).toBe(a.updatedAt)
    }
    // a first save that expected something is stale too
    await expect(saveAvailability(uid('TMC'), 'X', empty(), kaden, a.updatedAt)).rejects.toBeInstanceOf(StaleError)
  })

  it('caps history at 50', async () => {
    const id = uid('TMD')
    let cur = await saveAvailability(id, 'J', empty(), kaden, null)
    for (let i = 0; i < 55; i++) {
      const weekly = { ...empty().weekly, '6': i % 2 ? can('09:00', '10:00') : can('09:00', '11:00') }
      cur = await saveAvailability(id, 'J', { weekly, dates: {} }, kaden, cur.updatedAt)
    }
    expect(cur.history).toHaveLength(50)
  })

  it('never stores under a fallback id or a malformed id', async () => {
    await expect(saveAvailability('kaden', 'Kaden', empty(), kaden, null)).rejects.toBeInstanceOf(StaffingError)
    await expect(saveAvailability('catherine', 'Catherine', empty(), kaden, null)).rejects.toBeInstanceOf(StaffingError)
    await expect(saveAvailability('../x', 'X', empty(), kaden, null)).rejects.toBeInstanceOf(StaffingError)
    expect(await getAvailability('../x')).toBeNull()
  })

  it('a lost race is retried and still checks staleness against the winner', async () => {
    const id = uid('TME')
    const a = await saveAvailability(id, 'J', empty(), kaden, null)
    hook.loseNext = true
    hook.beforeLose = async () => { await saveAvailability(id, 'J', { ...empty(), weekly: { ...empty().weekly, '0': can('09:00', '10:00') } }, kaden, a.updatedAt) }
    await expect(saveAvailability(id, 'J', empty(), kaden, a.updatedAt)).rejects.toBeInstanceOf(StaleError)
    expect((await getAvailability(id))!.weekly['0']).toEqual(can('09:00', '10:00'))
  })

  it('reads many at once, skipping people with nothing saved', async () => {
    const a = uid('TMF'), b = uid('TMG'), c = uid('TMH')
    await saveAvailability(a, 'A', empty(), kaden, null)
    await saveAvailability(b, 'B', empty(), kaden, null)
    const m = await getAvailabilityMany([a, b, c, 'kaden'])
    expect([...m.keys()].sort()).toEqual([a, b].sort())
  })
})

describe('staffing store', () => {
  it('creates an entry when missing, and lists its key back', async () => {
    const key = `ses:${uid('ses_')}` as const
    expect((await getEntries([key])).size).toBe(0)
    const e = await updateEntry(key, (x) => withAssigned(x, assignment('TM2', 'Jessica')), 'Put Jessica on', kaden)
    expect(e).toMatchObject({ key, needed: null, asks: [], seen: null, sequence: 0 })
    expect(e.assigned.map((a) => a.staffId)).toEqual(['TM2'])
    expect(e.history[0]).toMatchObject({ by: kaden, change: 'Put Jessica on' })
    expect((await getEntries([key])).get(key)).toEqual(e)
    expect(await listAllEntryKeys()).toContain(key)
  })

  it('keeps party and legacy keys apart and round-trips them through the store key', async () => {
    const p = `party:${uid('pty_')}` as const, l = `legacy:${uid('SCHED')}` as const
    await updateEntry(p, (x) => ({ ...x, needed: 2 }), 'Needs 2', kaden)
    await updateEntry(l, (x) => ({ ...x, needed: 0 }), 'Needs nobody', kaden)
    const keys = await listAllEntryKeys()
    expect(keys).toEqual(expect.arrayContaining([p, l]))
    const m = await getEntries([p, l])
    expect(m.get(p)!.needed).toBe(2)
    expect(m.get(l)!.needed).toBe(0)
  })

  it('concurrent assign: two owners adding different people both stay', async () => {
    const key = `ses:${uid('ses_')}` as const
    hook.loseNext = true
    hook.beforeLose = async () => { await updateEntry(key, (x) => withAssigned(x, assignment('TM3', 'Sam')), 'Put Sam on', { id: 'TM4', name: 'Catherine' }) }
    const e = await updateEntry(key, (x) => withAssigned(x, assignment('TM2', 'Jessica')), 'Put Jessica on', kaden)
    expect(e.assigned.map((a) => a.staffId).sort()).toEqual(['TM2', 'TM3'])
    expect(e.history).toHaveLength(2)
  })

  it('the same person assigned twice is on once', async () => {
    const key = `ses:${uid('ses_')}` as const
    await updateEntry(key, (x) => withAssigned(x, assignment('TM2', 'Jessica')), 'on', kaden)
    const e = await updateEntry(key, (x) => withAssigned(x, assignment('TM2', 'Jessica')), 'on', kaden)
    expect(e.assigned).toHaveLength(1)
    // even if a caller's fn pushes a duplicate by hand
    const f = await updateEntry(key, (x) => ({ ...x, assigned: [...x.assigned, assignment('TM2', 'Jessica')] }), 'on', kaden)
    expect(f.assigned).toHaveLength(1)
  })

  it('stale expectedUpdatedAt is refused with the latest entry', async () => {
    const key = `party:${uid('pty_')}` as const
    const a = await updateEntry(key, (x) => ({ ...x, needed: 2 }), 'Needs 2', kaden, null)
    await expect(updateEntry(key, (x) => ({ ...x, needed: 3 }), 'Needs 3', kaden, null)).rejects.toBeInstanceOf(StaleError)
    try {
      await updateEntry(key, (x) => ({ ...x, needed: 3 }), 'Needs 3', kaden, '2020-01-01T00:00:00.000Z')
      expect.unreachable()
    } catch (e) {
      expect((e as StaleError<any>).message).toBe("Someone else just changed who's on this. Here's the latest.")
      expect((e as StaleError<any>).current.needed).toBe(2)
    }
    const b = await updateEntry(key, (x) => ({ ...x, needed: 3 }), 'Needs 3', kaden, a.updatedAt)
    expect(b.needed).toBe(3)
  })

  it('caps history at 100, and the key in the record can never be changed by fn', async () => {
    const key = `ses:${uid('ses_')}` as const
    let e = await updateEntry(key, (x) => ({ ...x, needed: 1 }), 'x', kaden)
    for (let i = 0; i < 105; i++) e = await updateEntry(key, (x) => ({ ...x, needed: i % 2 ? 1 : 2, key: 'ses:other' as const }), `x${i}`, kaden)
    expect(e.history).toHaveLength(100)
    expect(e.history[0].change).toBe('x104')
    expect(e.key).toBe(key)
  })

  it('refuses a malformed key and gives up after 3 lost races', async () => {
    await expect(updateEntry('cafe:x' as any, (x) => x, 'x', kaden)).rejects.toBeInstanceOf(StaffingError)
    const key = `ses:${uid('ses_')}` as const
    let losses = 0
    const lose = async () => { losses++; if (losses < 3) { hook.loseNext = true; hook.beforeLose = lose } }
    hook.loseNext = true
    hook.beforeLose = lose
    await expect(updateEntry(key, (x) => ({ ...x, needed: 2 }), 'x', kaden)).rejects.toMatchObject({ status: 503 })
  })

  it('asks: add, replace note, remove; unassign', async () => {
    const key = `ses:${uid('ses_')}` as const
    const at = new Date().toISOString()
    let e = await updateEntry(key, (x) => withAsk(x, { staffId: 'TM2', name: 'Jessica', at, note: 'love this one' }), 'ask', { id: 'TM2', name: 'Jessica' })
    e = await updateEntry(key, (x) => withAsk(x, { staffId: 'TM2', name: 'Jessica', at, note: 'still keen' }), 'ask', { id: 'TM2', name: 'Jessica' })
    expect(e.asks).toEqual([{ staffId: 'TM2', name: 'Jessica', at, note: 'still keen' }])
    e = await updateEntry(key, (x) => withoutAsk(x, 'TM2'), 'unask', { id: 'TM2', name: 'Jessica' })
    expect(e.asks).toEqual([])
    e = await updateEntry(key, (x) => withAssigned(x, assignment('TM2', 'Jessica')), 'on', kaden)
    e = await updateEntry(key, (x) => withoutAssigned(x, 'TM2'), 'off', kaden)
    expect(e.assigned).toEqual([])
  })

  it('seen: no history line, updatedAt unchanged, SEQUENCE up only when the times move (I3)', async () => {
    const key = `ses:${uid('ses_')}` as const
    const ev = { startIso: '2026-10-25T18:00:00.000Z', endIso: '2026-10-25T20:00:00.000Z', title: 'Needlepoint 101' }
    expect(await noteSeen(key, ev)).toBeNull() // no record is made just to remember a time
    expect((await getEntries([key])).size).toBe(0)
    const a = await updateEntry(key, (x) => withAssigned(x, assignment('TM2', 'Jessica')), 'on', kaden)
    let e = (await noteSeen(key, ev))!
    expect(e).toMatchObject({ seen: ev, sequence: 0, updatedAt: a.updatedAt })
    expect(e.history).toHaveLength(1)
    e = (await noteSeen(key, { ...ev, title: 'Needlepoint' }))!
    expect(e.sequence).toBe(0)
    e = (await noteSeen(key, { ...ev, startIso: '2026-10-25T19:00:00.000Z' }))!
    expect(e.sequence).toBe(1)
    expect(e.seen!.startIso).toBe('2026-10-25T19:00:00.000Z')
    expect(e.updatedAt).toBe(a.updatedAt)
    expect(e.history).toHaveLength(1)
    // a screen that loaded before the feed read can still save (not stale)
    const b = await updateEntry(key, (x) => ({ ...x, needed: 2 }), 'Needs 2', kaden, a.updatedAt)
    expect(b).toMatchObject({ needed: 2, sequence: 1 })
    // the same times again: nothing written
    const before = hook.writes
    await noteSeen(key, { ...ev, startIso: '2026-10-25T19:00:00.000Z' })
    expect(hook.writes).toBe(before)
  })

  it('a change that changes nothing writes nothing: no history, no updatedAt, no new record (I3)', async () => {
    const key = `ses:${uid('ses_')}` as const
    let before = hook.writes
    const none = await updateEntry(key, (x) => withoutAssigned(x, 'TM2'), 'off', kaden)
    expect(none.updatedAt).toBeNull()
    expect(hook.writes).toBe(before)
    expect((await getEntries([key])).size).toBe(0)
    const a = await updateEntry(key, (x) => withAssigned(x, assignment('TM2', 'Jessica')), 'on', kaden)
    before = hook.writes
    const again = await updateEntry(key, (x) => withAssigned(x, assignment('TM2', 'Jessica')), 'on', kaden)
    expect(hook.writes).toBe(before)
    expect(again.updatedAt).toBe(a.updatedAt)
    expect(again.history).toHaveLength(1)
  })

  it('the event option remembers seen in the same write', async () => {
    const key = `ses:${uid('ses_')}` as const
    const ev = { startIso: '2026-10-25T18:00:00.000Z', endIso: '2026-10-25T20:00:00.000Z', title: 'Needlepoint 101' }
    const e = await updateEntry(key, (x) => withAssigned(x, assignment('TM2', 'Jessica')), 'on', kaden, undefined, { event: ev })
    expect(e.seen).toEqual(ev)
  })

  it('refuses a fallback id or a malformed id inside an entry, writing nothing (I2)', async () => {
    const key = `ses:${uid('ses_')}` as const
    for (const bad of ['kaden', 'catherine', '../x', '']) {
      await expect(updateEntry(key, (x) => withAssigned(x, assignment(bad, 'Kaden')), 'on', kaden)).rejects.toMatchObject({ status: 400, message: "That person isn't on the team list." })
      await expect(updateEntry(key, (x) => withAsk(x, { staffId: bad, name: 'K', at: 'x', note: '' }), 'ask', kaden)).rejects.toBeInstanceOf(StaffingError)
    }
    expect((await getEntries([key])).size).toBe(0)
  })

  it('party index: our parties with people, by last-seen start; gone when nobody is left (I4)', async () => {
    const p = `party:${uid('pty_')}` as const, sq = `party:${uid('SQB')}` as const
    const ev = { startIso: '2026-12-05T19:00:00.000Z', endIso: '2026-12-05T21:00:00.000Z', title: 'Party' }
    await updateEntry(p, (x) => withAssigned(x, assignment('TM2', 'Jessica')), 'on', kaden, undefined, { event: ev })
    await updateEntry(sq, (x) => withAssigned(x, assignment('TM2', 'Jessica')), 'on', kaden, undefined, { event: ev })
    let idx = await readPartyIndex()
    expect(idx[p]).toBe(ev.startIso)
    expect(idx[sq]).toBeUndefined() // Square-booked parties never need it
    await noteSeen(p, { ...ev, startIso: '2026-12-12T19:00:00.000Z', endIso: '2026-12-12T21:00:00.000Z' })
    expect((await readPartyIndex())[p]).toBe('2026-12-12T19:00:00.000Z')
    await updateEntry(p, (x) => withoutAssigned(x, 'TM2'), 'off', kaden)
    idx = await readPartyIndex()
    expect(idx[p]).toBeUndefined()
    expect(await listAllEntryKeys()).not.toContain('idx-parties')
  })
})

describe('R41: a test site sharing the live stores writes nothing (I5)', () => {
  const asPreview = async (fn: () => Promise<void>) => {
    const prevNs = process.env.STORE_NAMESPACE
    delete process.env.STORE_NAMESPACE
    site.context = 'deploy-preview'
    try { await fn() } finally {
      site.context = 'dev'
      if (prevNs !== undefined) process.env.STORE_NAMESPACE = prevNs
    }
  }

  it('availability, entries, seen and feed links are all refused with nothing written', async () => {
    const id = uid('TMR'), key = `ses:${uid('ses_')}` as const
    const existing = `ses:${uid('ses_')}` as const
    await updateEntry(existing, (x) => withAssigned(x, assignment('TM2', 'Jessica')), 'on', kaden)
    const { token } = await makeFeed({ staffId: 'TMR1' }, kaden)
    const before = hook.writes
    await asPreview(async () => {
      await expect(saveAvailability(id, 'J', empty(), kaden, null)).rejects.toBeInstanceOf(TestSiteStoreError)
      await expect(updateEntry(key, (x) => withAssigned(x, assignment('TM2', 'Jessica')), 'on', kaden)).rejects.toBeInstanceOf(TestSiteStoreError)
      await expect(noteSeen(existing, { startIso: '2026-10-25T18:00:00.000Z', endIso: '2026-10-25T20:00:00.000Z', title: 'x' })).rejects.toBeInstanceOf(TestSiteStoreError)
      await expect(makeFeed({ staffId: 'TMR2' }, kaden)).rejects.toBeInstanceOf(TestSiteStoreError)
      await expect(revokeFeed({ staffId: 'TMR1' }, kaden)).rejects.toBeInstanceOf(TestSiteStoreError)
      const found = await findFeed(token)
      await touchFeed(found!.hash, new Date('2030-01-01T00:00:00.000Z'))
    })
    expect(hook.writes).toBe(before)
    expect(await getAvailability(id)).toBeNull()
    expect((await getEntries([key])).size).toBe(0)
    expect((await findFeed(token))!.lastUsedAt).toBeNull()
  })
})

describe('calendar feed store', () => {
  const allStoredText = (): string => {
    const root = process.env.BLOB_STORE_FS_DIR!
    const out: string[] = []
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f)
        if (statSync(p).isDirectory()) walk(p)
        else out.push(f, readFileSync(p, 'utf8'))
      }
    }
    walk(root)
    return out.join('\n')
  }

  it('stores only the hash: the raw token appears in no stored key or value', async () => {
    const { token, record } = await makeFeed({ staffId: 'TM2' }, kaden)
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(record).toMatchObject({ scope: 'mine', staffId: 'TM2', owner: null, by: kaden, lastUsedAt: null })
    expect(record.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(allStoredText()).not.toContain(token)
    expect(await findFeed(token)).toEqual(record)
  })

  it('an owner link is scope all', async () => {
    const { token, record } = await makeFeed({ owner: 'Catherine' }, { id: 'admin', name: 'Catherine' })
    expect(record).toMatchObject({ scope: 'all', staffId: null, owner: 'Catherine' })
    expect((await findFeed(token))!.scope).toBe('all')
  })

  it('a second link for the same person stops the first', async () => {
    const first = await makeFeed({ staffId: 'TM5' }, kaden)
    const second = await makeFeed({ staffId: 'TM5' }, kaden)
    expect(await findFeed(first.token)).toBeNull()
    expect(await findFeed(second.token)).toEqual(second.record)
    // other people's links are untouched
    const other = await makeFeed({ staffId: 'TM6' }, kaden)
    await makeFeed({ staffId: 'TM5' }, kaden)
    expect(await findFeed(other.token)).not.toBeNull()
  })

  it('revoke stops the link', async () => {
    const { token } = await makeFeed({ owner: 'Kaden' }, kaden)
    await revokeFeed({ owner: 'Kaden' }, kaden)
    expect(await findFeed(token)).toBeNull()
    await revokeFeed({ staffId: 'TM-nobody' }, kaden) // nothing to revoke: fine
  })

  it('findFeed: garbage, short, long or odd input → null without throwing', async () => {
    const { token } = await makeFeed({ staffId: 'TM7' }, kaden)
    for (const bad of ['', 'x', token.slice(0, 42), token + 'A', token.replace(/./, '!'), '../../etc/passwd', 'A'.repeat(5000), null, undefined, 42, {}]) {
      expect(await findFeed(bad as any)).toBeNull()
    }
    // right shape, wrong token
    expect(await findFeed('A'.repeat(43))).toBeNull()
  })

  it('two "Make a new link" taps at once: one wins, the other is told to try again, nobody holds a dead link (M6)', async () => {
    let other: { token: string } | null = null
    hook.loseKey = 'who-staff-TM10'
    hook.beforeLose = async () => { other = await makeFeed({ staffId: 'TM10' }, kaden) }
    await expect(makeFeed({ staffId: 'TM10' }, kaden)).rejects.toMatchObject({ status: 409, message: LINK_RACE })
    expect(await findFeed(other!.token)).not.toBeNull()
  })

  it('never makes a link for a fallback id', async () => {
    await expect(makeFeed({ staffId: 'kaden' }, kaden)).rejects.toBeInstanceOf(StaffingError)
  })

  describe('touchFeed', () => {
    afterEach(() => vi.useRealTimers())
    it('writes lastUsedAt at most once an hour', async () => {
      const { token, record } = await makeFeed({ staffId: 'TM8' }, kaden)
      const t0 = new Date('2026-11-01T10:00:00.000Z')
      await touchFeed(record.hash, t0)
      expect((await findFeed(token))!.lastUsedAt).toBe(t0.toISOString())
      await touchFeed(record.hash, new Date('2026-11-01T10:30:00.000Z'))
      expect((await findFeed(token))!.lastUsedAt).toBe(t0.toISOString())
      await touchFeed(record.hash, new Date('2026-11-01T11:00:01.000Z'))
      expect((await findFeed(token))!.lastUsedAt).toBe('2026-11-01T11:00:01.000Z')
    })
    it('ignores unknown hashes and failures', async () => {
      await expect(touchFeed('nope', new Date())).resolves.toBeUndefined()
      await expect(touchFeed('f'.repeat(64), new Date())).resolves.toBeUndefined()
    })
  })
})

describe('storableStaffId', () => {
  it('refuses every fallback id listStaff can answer with', async () => {
    const { storableStaffId } = await import('@lib/staffing/ids')
    const { FALLBACK_IDS } = await import('@lib/staff-directory')
    for (const id of FALLBACK_IDS) expect(storableStaffId(id)).toBe(false)
    expect(storableStaffId('TMabc_1-2')).toBe(true)
    for (const bad of ['', 'a b', 'a/b', 'x'.repeat(65), null, 3]) expect(storableStaffId(bad)).toBe(false)
  })
})
