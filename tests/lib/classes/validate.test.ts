import { describe, it, expect } from 'vitest'
import { defaultRules, newId, validateContent, validateSessions, sellableCells } from '@lib/classes/validate'

const minimal = () => ({
  name: 'Potholders',
  description: 'Weave one.',
  passes: [{ id: 'p1', label: 'Class', covers: { kind: 'all' } }],
  ticketTypes: [{ id: 'person', label: 'Person' }],
  prices: { p1: { person: 2000 } },
})
const bad = (mut: (c: any) => void) => { const c: any = minimal(); mut(c); return validateContent(c) }

describe('validateContent', () => {
  it('accepts a minimal content and fills defaults', () => {
    const r = validateContent(minimal())
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.rules).toEqual(defaultRules())
      expect(r.value.imageUrl).toBeNull()
      expect(r.value.questions).toEqual([])
      expect(r.value.addOns).toEqual([])
      expect(r.value.defaultCapacity).toBeGreaterThanOrEqual(1)
    }
  })
  it('defaults the ticket type when none given', () => {
    const r = bad((c) => { delete c.ticketTypes })
    expect(r.ok && r.value.ticketTypes).toEqual([{ id: 'person', label: 'Person' }])
  })
  it('normalises instructor "" to null', () => {
    const r = bad((c) => { c.instructor = '  ' })
    expect(r.ok && r.value.instructor).toBeNull()
  })
  it('refuses bad names', () => {
    expect(bad((c) => { c.name = '  ' }).ok).toBe(false)
    expect(bad((c) => { c.name = 'x'.repeat(81) }).ok).toBe(false)
  })
  it('refuses no price or prices on unknown cells', () => {
    expect(bad((c) => { c.prices = {} }).ok).toBe(false)
    expect(bad((c) => { c.prices = { p1: {} } }).ok).toBe(false)
    expect(bad((c) => { c.prices = { zz: { person: 100 } } }).ok).toBe(false)
    expect(bad((c) => { c.prices = { p1: { zz: 100 } } }).ok).toBe(false)
  })
  it('refuses negative or fractional cents', () => {
    expect(bad((c) => { c.prices.p1.person = -1 }).ok).toBe(false)
    expect(bad((c) => { c.prices.p1.person = 10.5 }).ok).toBe(false)
  })
  it('refuses duplicate ids', () => {
    expect(bad((c) => { c.passes.push({ ...c.passes[0] }) }).ok).toBe(false)
    expect(bad((c) => { c.ticketTypes.push({ id: 'person', label: 'Other' }) }).ok).toBe(false)
    const q = { id: 'q1', label: 'Size', choices: ['S', 'M'] }
    expect(bad((c) => { c.questions = [q, { ...q }] }).ok).toBe(false)
  })
  it('refuses bad passes', () => {
    expect(bad((c) => { c.passes[0].covers = { kind: 'choose', count: 0 } }).ok).toBe(false)
    expect(bad((c) => { c.passes[0].covers = { kind: 'fixed', sessionIds: [] } }).ok).toBe(false)
    expect(bad((c) => { c.passes[0].covers = { kind: 'weird' } }).ok).toBe(false)
  })
  it('accepts choose and fixed and remaining passes', () => {
    expect(bad((c) => { c.passes[0].covers = { kind: 'choose', count: 2 } }).ok).toBe(true)
    expect(bad((c) => { c.passes[0].covers = { kind: 'fixed', sessionIds: ['s1'] } }).ok).toBe(true)
    expect(bad((c) => { c.passes[0].covers = { kind: 'remaining' } }).ok).toBe(true)
  })
  it('refuses questions with fewer than 2 choices', () => {
    expect(bad((c) => { c.questions = [{ id: 'q1', label: 'Size', choices: ['S'] }] }).ok).toBe(false)
  })
  it('refuses a negative add-on price', () => {
    expect(bad((c) => { c.addOns = [{ id: 'a1', label: 'Tote', priceCents: -1, maxPerSeat: 1 }] }).ok).toBe(false)
    expect(bad((c) => { c.addOns = [{ id: 'a1', label: 'Tote', priceCents: 500, maxPerSeat: 1 }] }).ok).toBe(true)
  })
  it('bounds maxPerBooking and defaultCapacity', () => {
    expect(bad((c) => { c.rules = { maxPerBooking: 0 } }).ok).toBe(false)
    expect(bad((c) => { c.rules = { maxPerBooking: 41 } }).ok).toBe(false)
    expect(bad((c) => { c.rules = { maxPerBooking: 40 } }).ok).toBe(true)
    expect(bad((c) => { c.defaultCapacity = 0 }).ok).toBe(false)
    expect(bad((c) => { c.defaultCapacity = 1000 }).ok).toBe(false)
  })
  it('refuses non-objects', () => {
    expect(validateContent(null).ok).toBe(false)
  })
})

const s = (start: string, end: string, capacity = 10, id = newId('ses')) => ({ id, startIso: start, endIso: end, capacity })

describe('validateSessions', () => {
  it('sorts by start', () => {
    const r = validateSessions([s('2026-11-02T18:00:00Z', '2026-11-02T20:00:00Z'), s('2026-11-01T18:00:00Z', '2026-11-01T20:00:00Z')])
    expect(r.ok && r.value.map((x) => x.startIso)).toEqual(['2026-11-01T18:00:00Z', '2026-11-02T18:00:00Z'])
  })
  it('refuses end before or at start', () => {
    expect(validateSessions([s('2026-11-01T18:00:00Z', '2026-11-01T18:00:00Z')]).ok).toBe(false)
    expect(validateSessions([s('2026-11-01T18:00:00Z', '2026-11-01T17:00:00Z')]).ok).toBe(false)
  })
  it('refuses overlaps but allows back to back', () => {
    expect(validateSessions([s('2026-11-01T18:00:00Z', '2026-11-01T20:00:00Z'), s('2026-11-01T19:00:00Z', '2026-11-01T21:00:00Z')]).ok).toBe(false)
    expect(validateSessions([s('2026-11-01T18:00:00Z', '2026-11-01T20:00:00Z'), s('2026-11-01T20:00:00Z', '2026-11-01T21:00:00Z')]).ok).toBe(true)
  })
  it('refuses more than 60, none, bad capacity, bad dates', () => {
    const many = Array.from({ length: 61 }, (_, i) => s(new Date(Date.UTC(2026, 0, 1 + i, 10)).toISOString(), new Date(Date.UTC(2026, 0, 1 + i, 11)).toISOString()))
    expect(validateSessions(many).ok).toBe(false)
    expect(validateSessions(many.slice(0, 60)).ok).toBe(true)
    expect(validateSessions([]).ok).toBe(false)
    expect(validateSessions([s('2026-11-01T18:00:00Z', '2026-11-01T20:00:00Z', 0)]).ok).toBe(false)
    expect(validateSessions([s('2026-11-01T18:00:00Z', '2026-11-01T20:00:00Z', 1000)]).ok).toBe(false)
    expect(validateSessions([s('nope', '2026-11-01T20:00:00Z')]).ok).toBe(false)
  })
})

describe('session and decide-by times', () => {
  it('stores an offset input as the equivalent Z string', () => {
    const r = validateSessions([s('2026-11-01T18:00:00-05:00', '2026-11-01T20:00:00-05:00')])
    expect(r.ok && r.value[0].startIso).toBe('2026-11-01T23:00:00.000Z')
    expect(r.ok && r.value[0].endIso).toBe('2026-11-02T01:00:00.000Z')
  })
  it('refuses zone-less and lenient strings', () => {
    expect(validateSessions([s('2026-11-01T18:00:00', '2026-11-01T20:00:00Z')]).ok).toBe(false)
    expect(validateSessions([s('1', '2026-11-01T20:00:00Z')]).ok).toBe(false)
  })
  it('normalises and checks decideByIso', () => {
    const ok = bad((c) => { c.rules = { minimumToRun: { count: 4, decideByIso: '2026-10-30T12:00:00-05:00' } } })
    expect(ok.ok && ok.value.rules.minimumToRun?.decideByIso).toBe('2026-10-30T17:00:00.000Z')
    expect(bad((c) => { c.rules = { minimumToRun: { count: 4, decideByIso: '2026-10-30T12:00:00' } } }).ok).toBe(false)
    expect(bad((c) => { c.rules = { minimumToRun: { count: 4, decideByIso: '1' } } }).ok).toBe(false)
  })
})

describe('sellableCells', () => {
  it('lists filled cells in pass then ticket order', () => {
    const r = validateContent({
      ...minimal(),
      passes: [{ id: 'a', label: 'A', covers: { kind: 'all' } }, { id: 'b', label: 'B', covers: { kind: 'remaining' } }],
      ticketTypes: [{ id: 'adult', label: 'Adult' }, { id: 'kid', label: 'Kid' }],
      prices: { b: { kid: 1000, adult: 1500 }, a: { kid: 500 } },
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(sellableCells(r.value)).toEqual([
      { passId: 'a', ticketTypeId: 'kid', cents: 500 },
      { passId: 'b', ticketTypeId: 'adult', cents: 1500 },
      { passId: 'b', ticketTypeId: 'kid', cents: 1000 },
    ])
  })
})

describe('newId', () => {
  it('has the prefix and is unique-ish', () => {
    expect(newId('cls')).toMatch(/^cls_[0-9a-z]{8,}$/)
    expect(newId('cls')).not.toBe(newId('cls'))
  })
})
