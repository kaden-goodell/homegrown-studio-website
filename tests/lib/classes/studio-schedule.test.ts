import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  listBookings: vi.fn(),
  listAllWorkshops: vi.fn(),
}))
vi.mock('@config/providers', () => ({
  providers: {
    booking: { listBookings: mocks.listBookings },
    workshop: { listAllWorkshops: mocks.listAllWorkshops, listWorkshops: vi.fn(async () => []) },
  },
}))
vi.mock('@config/site.config', () => ({
  siteConfig: { providers: { booking: { config: { locationId: 'test-location' } } } },
}))
vi.mock('@lib/party-store', () => ({ getPartyRecord: vi.fn(async () => ({ hostName: 'Jamie Rivera' })) }))

import { busyBetween, clashes, clashMessage, type Busy } from '@lib/classes/studio-schedule'
import { createClass, updateClass } from '@lib/classes/class-store'
import { addBlocked } from '@lib/classes/blocked-time'
import { localToUtcISO } from '@lib/party-slots'
import { studioClock } from '@lib/studio-time'
import type { ClassContent, Session } from '@lib/classes/types'

const by = { id: 'k', name: 'Kaden' }
function content(name: string, canShareRoom = false): ClassContent {
  return {
    name, description: '', imageUrl: null, instructor: null,
    rules: { ages: '', dropOff: false, madeToOrder: false, taxable: true, maxPerBooking: 10, signupCutoffHours: null, minimumToRun: null, linkOnly: false, joinPartway: true, waitlistCutoffHours: 2, canShareRoom },
    ticketTypes: [{ id: 'person', label: 'Person' }],
    passes: [{ id: 'all', label: 'Full', covers: { kind: 'all' } }],
    prices: { all: { person: 3000 } }, questions: [], addOns: [], defaultCapacity: 12, defaultMinutes: 90,
  }
}
let n = 0
const ses = (start: string, end: string): Session => ({ id: `ses_t${++n}`, startIso: start, endIso: end, capacity: 12 })
const at = (ymd: string, hhmm: string) => localToUtcISO(ymd, hhmm)
const busy = (b: Partial<Busy> & Pick<Busy, 'kind' | 'startIso' | 'endIso'>): Busy => ({ id: `x${++n}`, label: 'Thing', ...b })

beforeEach(() => {
  mocks.listBookings.mockReset().mockResolvedValue([])
  mocks.listAllWorkshops.mockReset().mockResolvedValue([])
})

// Every source sits in its own far-future week so stores shared across tests don't collide.
describe('busyBetween', () => {
  it('our class sessions (draft/open/closed) block; cancelled ones do not', async () => {
    const day = '2030-03-07' // Thursday
    const open = await createClass({ content: content('Pottery Night'), sessions: [ses(at(day, '17:00'), at(day, '19:00'))], status: 'open', by })
    const draft = await createClass({ content: content('Draft Class'), sessions: [ses(at(day, '19:30'), at(day, '20:30'))], status: 'draft', by })
    const closed = await createClass({ content: content('Closed Class'), sessions: [ses(at(day, '16:00'), at(day, '16:30'))], status: 'closed', by })
    const gone = await createClass({ content: content('Gone Class'), sessions: [ses(at(day, '20:30'), at(day, '21:00'))], status: 'open', by })
    await updateClass(gone.id, { status: 'cancelled' }, by, 'Cancelled')
    const list = await busyBetween(at(day, '00:00'), at(day, '23:59'))
    const ours = list.filter((b) => b.kind === 'class')
    expect(ours.map((b) => b.id).sort()).toEqual([open.id, draft.id, closed.id].sort())
    const pottery = ours.find((b) => b.id === open.id)!
    expect(pottery.label).toBe('Pottery Night')
    expect(pottery.startIso).toBe(at(day, '17:00'))
    expect(pottery.canShareRoom).toBe(false)
  })

  it('legacy Square classes, parties, café, blocked time and closures each contribute', async () => {
    mocks.listAllWorkshops.mockResolvedValue([
      { scheduleId: 'clssch_1', name: 'Square Candle Class', startAt: at('2030-03-16', '14:00'), durationMinutes: 120 },
    ])
    mocks.listBookings.mockResolvedValue([
      { id: 'bk_1', status: 'accepted', slot: { startAt: at('2030-03-17', '13:00'), duration: 120 } },
      { id: 'bk_2', status: 'cancelled', slot: { startAt: at('2030-03-17', '16:00'), duration: 120 } },
    ])
    const blk = await addBlocked({ startIso: at('2030-03-15', '16:00'), endIso: at('2030-03-15', '18:00'), reason: 'Deep clean', by })
    const list = await busyBetween(at('2030-03-14', '00:00'), at('2030-03-18', '00:00'))
    const kinds = (k: Busy['kind']) => list.filter((b) => b.kind === k)

    expect(kinds('legacy-class')).toEqual([expect.objectContaining({ id: 'clssch_1', label: 'Square Candle Class', startIso: at('2030-03-16', '14:00'), endIso: at('2030-03-16', '16:00') })])
    expect(kinds('party')).toEqual([expect.objectContaining({ id: 'bk_1', label: 'the Rivera party', endIso: at('2030-03-17', '15:00') })])
    // Saturday café 9 to 12
    expect(kinds('cafe')).toEqual([expect.objectContaining({ startIso: at('2030-03-16', '09:00'), endIso: at('2030-03-16', '12:00'), label: 'Craft Café' })])
    expect(kinds('blocked')).toEqual([expect.objectContaining({ id: blk.id, label: 'Deep clean' })])
    expect(kinds('closed')).toEqual([])
  })

  it('a closed day is busy from midnight to midnight, studio time', async () => {
    const list = await busyBetween(at('2026-10-31', '10:00'), at('2026-10-31', '11:00'))
    const closed = list.filter((b) => b.kind === 'closed')
    expect(closed).toHaveLength(1)
    expect(closed[0].startIso).toBe(at('2026-10-31', '00:00'))
    expect(closed[0].endIso).toBe(at('2026-11-01', '00:00'))
    expect(closed[0].label).toBe('Closed for Halloween weekend')
  })

  it('fails closed: a source that cannot be read throws rather than reporting the time free', async () => {
    mocks.listBookings.mockRejectedValue(new Error('Square down'))
    await expect(busyBetween(at('2030-04-01', '00:00'), at('2030-04-02', '00:00'))).rejects.toThrow()
    mocks.listBookings.mockResolvedValue([])
    mocks.listAllWorkshops.mockRejectedValue(new Error('Square down'))
    await expect(busyBetween(at('2030-04-01', '00:00'), at('2030-04-02', '00:00'))).rejects.toThrow()
  })
})

describe('clashes', () => {
  const day = '2030-05-02' // Thursday
  const party = busy({ kind: 'party', id: 'bk_9', label: 'the Rivera party', startIso: at(day, '13:00'), endIso: at(day, '15:00') })
  const cls = busy({ kind: 'class', id: 'cls_a', label: 'Pottery', startIso: at(day, '17:00'), endIso: at(day, '19:00') })

  it('class after a party: exactly 60 minutes is fine, 59 clashes', () => {
    expect(clashes({ kind: 'class', startIso: at(day, '16:00'), endIso: at(day, '17:00') }, [party])).toEqual([])
    expect(clashes({ kind: 'class', startIso: at(day, '15:59'), endIso: at(day, '17:00') }, [party])).toEqual([party])
  })

  it('party before a class: exactly 60 minutes is fine, 59 clashes', () => {
    expect(clashes({ kind: 'party', startIso: at(day, '14:00'), endIso: at(day, '16:00') }, [cls])).toEqual([])
    expect(clashes({ kind: 'party', startIso: at(day, '14:01'), endIso: at(day, '16:01') }, [cls])).toEqual([cls])
  })

  it('party next to a legacy class keeps the same hour', () => {
    const legacy = busy({ kind: 'legacy-class', startIso: at(day, '17:00'), endIso: at(day, '19:00') })
    expect(clashes({ kind: 'party', startIso: at(day, '19:59'), endIso: at(day, '21:59') }, [legacy])).toEqual([legacy])
    expect(clashes({ kind: 'party', startIso: at(day, '20:00'), endIso: at(day, '22:00') }, [legacy])).toEqual([])
  })

  it('two parties keep the hour too', () => {
    expect(clashes({ kind: 'party', startIso: at(day, '15:30'), endIso: at(day, '17:30') }, [party])).toEqual([party])
    expect(clashes({ kind: 'party', startIso: at(day, '16:00'), endIso: at(day, '18:00') }, [party])).toEqual([])
  })

  it('two classes that overlap clash unless both can share the room', () => {
    const cand = { kind: 'class' as const, startIso: at(day, '18:00'), endIso: at(day, '20:00') }
    expect(clashes(cand, [cls])).toEqual([cls])
    expect(clashes({ ...cand, canShareRoom: true }, [cls])).toEqual([cls])
    const sharing = { ...cls, canShareRoom: true }
    expect(clashes(cand, [sharing])).toEqual([sharing])
    expect(clashes({ ...cand, canShareRoom: true }, [sharing])).toEqual([])
    // touching classes do not clash
    expect(clashes({ kind: 'class', startIso: at(day, '19:00'), endIso: at(day, '20:00') }, [cls])).toEqual([])
    // a legacy class never shares
    const legacy = busy({ kind: 'legacy-class', startIso: cls.startIso, endIso: cls.endIso })
    expect(clashes({ ...cand, canShareRoom: true }, [legacy])).toEqual([legacy])
  })

  it('blocked time stops a class and a party (plain overlap)', () => {
    const blk = busy({ kind: 'blocked', label: 'Deep clean', startIso: at(day, '10:00'), endIso: at(day, '12:00') })
    expect(clashes({ kind: 'class', startIso: at(day, '11:00'), endIso: at(day, '13:00') }, [blk])).toEqual([blk])
    expect(clashes({ kind: 'party', startIso: at(day, '11:30'), endIso: at(day, '13:30') }, [blk])).toEqual([blk])
    expect(clashes({ kind: 'class', startIso: at(day, '12:00'), endIso: at(day, '13:00') }, [blk])).toEqual([])
  })

  it('a closed day stops anything on it', () => {
    const closed = busy({ kind: 'closed', label: 'Closed for Halloween weekend', startIso: at('2026-10-31', '00:00'), endIso: at('2026-11-01', '00:00') })
    expect(clashes({ kind: 'class', startIso: at('2026-10-31', '09:00'), endIso: at('2026-10-31', '10:00') }, [closed])).toEqual([closed])
    expect(clashes({ kind: 'party', startIso: at('2026-10-31', '23:00'), endIso: at('2026-11-01', '01:00') }, [closed])).toEqual([closed])
    expect(clashes({ kind: 'class', startIso: at('2026-11-01', '00:00'), endIso: at('2026-11-01', '02:00') }, [closed])).toEqual([])
  })

  it('café: a class only clashes by overlap; a party keeps the café gap', () => {
    const sat = '2030-05-04'
    const cafe = busy({ kind: 'cafe', label: 'Craft Café', startIso: at(sat, '09:00'), endIso: at(sat, '12:00') })
    expect(clashes({ kind: 'class', startIso: at(sat, '12:00'), endIso: at(sat, '13:00') }, [cafe])).toEqual([])
    expect(clashes({ kind: 'class', startIso: at(sat, '11:59'), endIso: at(sat, '13:00') }, [cafe])).toEqual([cafe])
    expect(clashes({ kind: 'party', startIso: at(sat, '12:59'), endIso: at(sat, '14:59') }, [cafe])).toEqual([cafe])
    expect(clashes({ kind: 'party', startIso: at(sat, '13:00'), endIso: at(sat, '15:00') }, [cafe])).toEqual([])
  })

  it('ignoreIds lets a class move without clashing with itself', () => {
    const cand = { kind: 'class' as const, startIso: at(day, '17:30'), endIso: at(day, '19:30') }
    expect(clashes(cand, [cls])).toEqual([cls])
    expect(clashes({ ...cand, ignoreIds: ['cls_a'] }, [cls])).toEqual([])
  })

  it('across the clock change, a 4-day camp keeps 9 AM local and checks use real instants', () => {
    const days = ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']
    const camp: Busy[] = days.map((d, i) => busy({ kind: 'class', id: 'cls_camp', label: 'Fall Camp', startIso: at(d, '09:00'), endIso: at(d, '12:00') }))
    expect(camp.map((b) => studioClock(b.startIso))).toEqual(['09:00', '09:00', '09:00', '09:00'])
    // CDT before the change, CST after it: the UTC hour moves, the local hour does not.
    expect(camp[0].startIso).toBe('2026-10-30T14:00:00.000Z')
    expect(camp[3].startIso).toBe('2026-11-02T15:00:00.000Z')
    // 8 to 9 AM local on Nov 2 touches the camp and is fine; the pre-change UTC hour would have overlapped.
    expect(clashes({ kind: 'class', startIso: '2026-11-02T14:00:00.000Z', endIso: '2026-11-02T15:00:00.000Z' }, camp)).toEqual([])
    expect(clashes({ kind: 'class', startIso: '2026-11-02T14:30:00.000Z', endIso: '2026-11-02T15:30:00.000Z' }, camp)).toEqual([camp[3]])
    // A party at 12 to 2 PM local on Nov 2 is 0 minutes after the camp: clashes.
    expect(clashes({ kind: 'party', startIso: at('2026-11-02', '12:00'), endIso: at('2026-11-02', '14:00') }, camp)).toEqual([camp[3]])
  })
})

describe('clashMessage', () => {
  const kid = busy({ kind: 'class', label: 'Kids Halloween Cookie Decorating', startIso: at('2026-10-18', '16:00'), endIso: at('2026-10-18', '18:00') })
  it('one', () => {
    expect(clashMessage([kid])).toBe('Clashes with Kids Halloween Cookie Decorating, Sun Oct 18 4 PM.')
  })
  it('shows minutes when not on the hour', () => {
    expect(clashMessage([{ ...kid, startIso: at('2026-10-18', '16:30') }])).toBe('Clashes with Kids Halloween Cookie Decorating, Sun Oct 18 4:30 PM.')
  })
  it('several: up to 3 then "and N more"', () => {
    const a = { ...kid, label: 'A' }, b = { ...kid, label: 'B' }, c = { ...kid, label: 'C' }
    expect(clashMessage([a, b])).toBe('Clashes with A, Sun Oct 18 4 PM and B, Sun Oct 18 4 PM.')
    expect(clashMessage([a, b, c])).toBe('Clashes with A, Sun Oct 18 4 PM, B, Sun Oct 18 4 PM and C, Sun Oct 18 4 PM.')
    expect(clashMessage([a, b, c, kid, kid])).toBe('Clashes with A, Sun Oct 18 4 PM, B, Sun Oct 18 4 PM, C, Sun Oct 18 4 PM and 2 more.')
  })
  it('empty is empty', () => {
    expect(clashMessage([])).toBe('')
  })
})
