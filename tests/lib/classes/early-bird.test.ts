import { describe, it, expect } from 'vitest'
import { contentChanges } from '@lib/classes/content-diff'
import { dropEndedEarlyBird, earlyBirdCents, earlyBirdLabel, earlyBirdRunning, EARLY_BIRD_ENDED } from '@lib/classes/early-bird'
import { defaultRules } from '@lib/classes/validate'
import type { ClassContent } from '@lib/classes/types'

const content = (over: Partial<ClassContent> = {}): ClassContent => ({
  name: 'Looms', description: '', imageUrl: null, instructor: null, rules: defaultRules(),
  ticketTypes: [{ id: 'person', label: 'Person' }], passes: [{ id: 'all', label: 'All', covers: { kind: 'all' } }],
  prices: { all: { person: 2000 } }, questions: [], addOns: [], defaultCapacity: 8, defaultMinutes: 90, ...over,
})
const eb = { untilYmd: '2026-10-30', prices: { all: { person: 1500 } } }

describe('early-bird', () => {
  it('runs to the end of its Chicago day', () => {
    const c = content({ earlyBird: eb })
    expect(earlyBirdRunning(c, new Date('2026-10-31T04:59:00Z'))).toBe(true) // 11:59 PM CDT Oct 30
    expect(earlyBirdRunning(c, new Date('2026-10-31T05:00:00Z'))).toBe(false)
    expect(earlyBirdRunning(content(), new Date('2026-10-01T00:00:00Z'))).toBe(false)
  })
  it('the early-bird price of a cell while running, else null', () => {
    const c = content({ earlyBird: eb })
    expect(earlyBirdCents(c, 'all', 'person', new Date('2026-10-20T12:00:00Z'))).toBe(1500)
    expect(earlyBirdCents(c, 'all', 'kid', new Date('2026-10-20T12:00:00Z'))).toBeNull()
    expect(earlyBirdCents(c, 'all', 'person', new Date('2026-11-01T12:00:00Z'))).toBeNull()
  })
  it('the public label', () => {
    expect(earlyBirdLabel(content({ earlyBird: eb }))).toBe('Early-bird $15 until Fri Oct 30')
    const two = content({
      ticketTypes: [{ id: 'adult', label: 'Adult' }, { id: 'kid', label: 'Kid' }],
      prices: { all: { adult: 2000, kid: 1500 } },
      earlyBird: { untilYmd: '2026-10-30', prices: { all: { adult: 1600, kid: 1200 } } },
    })
    expect(earlyBirdLabel(two)).toBe('Early-bird $16 adult · $12 kid until Fri Oct 30')
    const some = content({
      passes: [{ id: 'all', label: 'All', covers: { kind: 'all' } }, { id: 'day', label: 'Day', covers: { kind: 'choose', count: 1 } }],
      prices: { all: { person: 2000 }, day: { person: 900 } },
      earlyBird: { untilYmd: '2026-10-30', prices: { all: { person: 1500 }, day: { person: 700 } } },
    })
    expect(earlyBirdLabel(some)).toBe('Early-bird from $7 until Fri Oct 30')
    expect(earlyBirdLabel(content())).toBe('')
  })
  it('run it again drops one whose date has passed, and says so', () => {
    const now = new Date('2026-11-01T12:00:00Z')
    const r = dropEndedEarlyBird(content({ earlyBird: eb }), now)
    expect('earlyBird' in r.content).toBe(false)
    expect(r.note).toBe(EARLY_BIRD_ENDED)
    expect(EARLY_BIRD_ENDED).toBe('Early-bird ended, so it was left off.')
    const keep = dropEndedEarlyBird(content({ earlyBird: { ...eb, untilYmd: '2026-11-01' } }), now)
    expect(keep.content.earlyBird?.untilYmd).toBe('2026-11-01')
    expect(keep.note).toBeNull()
  })
  it('the diff label', () => {
    expect(contentChanges(content(), content({ earlyBird: eb }))).toEqual(['Early-bird'])
    expect(contentChanges(content({ earlyBird: eb }), content({ earlyBird: { ...eb, untilYmd: '2026-10-31' } }))).toEqual(['Early-bird'])
    expect(contentChanges(content(), content({ earlyBird: null }))).toEqual([])
  })
})
