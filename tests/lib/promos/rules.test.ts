import { describe, it, expect } from 'vitest'
import { normalizeCode, validatePromo, promoRefusal, usesLeft, describePromo, PROMO_REFUSALS } from '@lib/promos/rules'
import type { PromoCode, PromoUses } from '@lib/promos/types'
import type { ScheduledClass } from '@lib/classes/types'
import { defaultRules } from '@lib/classes/validate'

const by = { id: 'c', name: 'Catherine' }
function promo(over: Partial<PromoCode> = {}): PromoCode {
  return {
    code: 'FALLFRIENDS', label: 'Fall', off: { kind: 'percent', percent: 10 }, per: 'booking',
    appliesTo: { kind: 'all' }, includeExtras: false, endsYmd: null, maxUses: null, active: true,
    createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', by, history: [], ...over,
  }
}
function cls(id = 'cls_a', libraryId: string | null = 'lib_x'): ScheduledClass {
  return {
    id, libraryId, libraryVersion: 1,
    content: {
      name: 'Looms', description: '', imageUrl: null, instructor: null, rules: defaultRules(),
      ticketTypes: [{ id: 'person', label: 'Person' }], passes: [{ id: 'all', label: 'All', covers: { kind: 'all' } }],
      prices: { all: { person: 1500 } }, questions: [], addOns: [], defaultCapacity: 8, defaultMinutes: 90,
    },
    sessions: [{ id: 's1', startIso: '2026-11-20T18:00:00Z', endIso: '2026-11-20T20:00:00Z', capacity: 8 }],
    status: 'open', square: { itemId: null, variations: {} }, createdAt: '', updatedAt: '', by, history: [],
  }
}
const NOW = new Date('2026-11-01T18:00:00Z')

describe('normalizeCode', () => {
  it('upper-cases and drops spaces', () => {
    expect(normalizeCode('  fall friends ')).toBe('FALLFRIENDS')
    expect(normalizeCode('grandOpening26')).toBe('GRANDOPENING26')
  })
  it('refuses punctuation, too short, too long and non-strings', () => {
    expect(normalizeCode('FALL-FRIENDS')).toBeNull()
    expect(normalizeCode('10%OFF')).toBeNull()
    expect(normalizeCode('AB')).toBeNull()
    expect(normalizeCode('A'.repeat(21))).toBeNull()
    expect(normalizeCode('')).toBeNull()
    expect(normalizeCode(42 as unknown as string)).toBeNull()
  })
})

describe('validatePromo', () => {
  const base = { code: 'fall10', label: ' Fall ', off: { kind: 'percent', percent: 10 }, appliesTo: { kind: 'all' } }
  it('fills defaults: active, seats only, whole booking, no end, no limit', () => {
    const r = validatePromo(base)
    expect(r.ok && r.value).toEqual({
      code: 'FALL10', label: 'Fall', off: { kind: 'percent', percent: 10 }, per: 'booking',
      appliesTo: { kind: 'all' }, includeExtras: false, endsYmd: null, maxUses: null, active: true,
    })
  })
  it('percent is a whole number 1 to 100', () => {
    for (const percent of [0, 101, 12.5, -5]) {
      const r = validatePromo({ ...base, off: { kind: 'percent', percent } })
      expect(!r.ok && r.field).toBe('off')
    }
    expect(validatePromo({ ...base, off: { kind: 'percent', percent: 100 } }).ok).toBe(true)
  })
  it('an amount is at least 50 cents, whole cents', () => {
    expect(validatePromo({ ...base, off: { kind: 'amount', cents: 49 } }).ok).toBe(false)
    expect(validatePromo({ ...base, off: { kind: 'amount', cents: 50.5 } }).ok).toBe(false)
    const r = validatePromo({ ...base, off: { kind: 'amount', cents: 500 }, per: 'seat' })
    expect(r.ok && r.value.off).toEqual({ kind: 'amount', cents: 500 })
    expect(r.ok && r.value.per).toBe('seat')
  })
  it('a percent code is always per line (stored as booking)', () => {
    const r = validatePromo({ ...base, per: 'seat' })
    expect(r.ok && r.value.per).toBe('booking')
  })
  it('refuses a bad code with the code field', () => {
    const r = validatePromo({ ...base, code: 'no!' })
    expect(!r.ok && r.field).toBe('code')
    expect(!r.ok && r.error).toBe('A code is 3 to 20 letters or numbers, with no spaces or symbols.')
  })
  it('chosen classes need at least one', () => {
    const r = validatePromo({ ...base, appliesTo: { kind: 'classes', libraryIds: [], classIds: [] } })
    expect(!r.ok && r.error).toBe('Pick at least one class, or choose Everything.')
    const ok = validatePromo({ ...base, appliesTo: { kind: 'classes', libraryIds: ['lib_x', 'lib_x', ''], classIds: [] } })
    expect(ok.ok && ok.value.appliesTo).toEqual({ kind: 'classes', libraryIds: ['lib_x'], classIds: [] })
  })
  it('last day: a real date, not in the past when today is given', () => {
    expect(validatePromo({ ...base, endsYmd: '2026-02-30' }).ok).toBe(false)
    const past = validatePromo({ ...base, endsYmd: '2026-10-31' }, { todayYmd: '2026-11-01' })
    expect(!past.ok && past.error).toBe("The last day can't be in the past.")
    expect(validatePromo({ ...base, endsYmd: '2026-11-01' }, { todayYmd: '2026-11-01' }).ok).toBe(true)
    // An edit that doesn't pass today keeps an ended code as it is.
    expect(validatePromo({ ...base, endsYmd: '2026-10-31' }).ok).toBe(true)
    expect(validatePromo({ ...base, endsYmd: '' }).ok && validatePromo({ ...base, endsYmd: '' })).toMatchObject({ value: { endsYmd: null } })
  })
  it('use limit: null or a whole number of 1 or more', () => {
    expect(validatePromo({ ...base, maxUses: 0 }).ok).toBe(false)
    expect(validatePromo({ ...base, maxUses: 2.5 }).ok).toBe(false)
    const r = validatePromo({ ...base, maxUses: 20 })
    expect(r.ok && r.value.maxUses).toBe(20)
  })
  it('only a real yes turns on extras or off active', () => {
    const r = validatePromo({ ...base, includeExtras: 'false', active: false })
    expect(r.ok && r.value.includeExtras).toBe(false)
    expect(r.ok && r.value.active).toBe(false)
  })
})

describe('promoRefusal', () => {
  it('unknown and inactive read the same', () => {
    expect(promoRefusal(null, cls(), NOW, null)).toBe(PROMO_REFUSALS.invalid)
    expect(promoRefusal(promo({ active: false }), cls(), NOW, null)).toBe(PROMO_REFUSALS.invalid)
    expect(PROMO_REFUSALS.invalid).toBe("That code isn't valid.")
  })
  it('ends at Chicago midnight', () => {
    const p = promo({ endsYmd: '2026-11-01' })
    // 11:59 PM CST on Nov 1 (after the clock change, Chicago is UTC−6)
    expect(promoRefusal(p, cls(), new Date('2026-11-02T05:59:00Z'), null)).toBeNull()
    expect(promoRefusal(p, cls(), new Date('2026-11-02T06:00:00Z'), null)).toBe("That code has ended.")
  })
  it('a library id covers every date of it; a class id only that date', () => {
    const lib = promo({ appliesTo: { kind: 'classes', libraryIds: ['lib_x'], classIds: [] } })
    expect(promoRefusal(lib, cls('cls_a', 'lib_x'), NOW, null)).toBeNull()
    expect(promoRefusal(lib, cls('cls_b', 'lib_x'), NOW, null)).toBeNull()
    expect(promoRefusal(lib, cls('cls_c', 'lib_y'), NOW, null)).toBe("That code isn't for this class.")
    const one = promo({ appliesTo: { kind: 'classes', libraryIds: [], classIds: ['cls_a'] } })
    expect(promoRefusal(one, cls('cls_a', 'lib_x'), NOW, null)).toBeNull()
    expect(promoRefusal(one, cls('cls_b', 'lib_x'), NOW, null)).toBe("That code isn't for this class.")
    expect(promoRefusal(one, cls('cls_n', null), NOW, null)).toBe("That code isn't for this class.")
  })
  it('used up when no uses are left', () => {
    expect(promoRefusal(promo({ maxUses: 2 }), cls(), NOW, 0)).toBe('That code has been used up.')
    expect(promoRefusal(promo({ maxUses: 2 }), cls(), NOW, 1)).toBeNull()
  })
})

describe('usesLeft', () => {
  const uses = (u: Partial<PromoUses>): PromoUses => ({ code: 'X', used: [], holds: [], ...u })
  it('no limit → null; counts paid uses and live holds, not expired ones', () => {
    expect(usesLeft(promo(), uses({}), NOW)).toBeNull()
    const u = uses({
      used: [{ bookingId: 'b1', at: '', classId: 'c' }],
      holds: [{ bookingId: 'b2', until: '2026-11-01T18:10:00Z' }, { bookingId: 'b3', until: '2026-11-01T17:59:00Z' }],
    })
    expect(usesLeft(promo({ maxUses: 3 }), u, NOW)).toBe(1)
    expect(usesLeft(promo({ maxUses: 3 }), u, NOW, 'b2')).toBe(2) // this booking's own hold doesn't count against it
    expect(usesLeft(promo({ maxUses: 1 }), u, NOW)).toBe(0)
  })
})

describe('describePromo', () => {
  it('reads in plain words', () => {
    expect(describePromo(promo({ endsYmd: '2026-11-30' }))).toBe('10% off · every class · ends Mon Nov 30')
    expect(describePromo(promo({ off: { kind: 'amount', cents: 500 }, appliesTo: { kind: 'classes', libraryIds: ['a'], classIds: ['b'] } })))
      .toBe('$5 off the booking · 2 classes')
    expect(describePromo(promo({ off: { kind: 'amount', cents: 250 }, per: 'seat', includeExtras: true, appliesTo: { kind: 'classes', libraryIds: ['a'], classIds: [] } })))
      .toBe('$2.50 off each person · 1 class · extras too')
  })
})
