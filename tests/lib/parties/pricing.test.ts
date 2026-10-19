import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { quoteParty, quoteAddOn, orderLineItems } from '@lib/parties/pricing'
import { configPartySettings } from '@lib/parties/party-times'
import { dueCents } from '@lib/parties/money'
import type { PartyAddOn, PartyPackage, PartySettings } from '@lib/parties/types'
import type { PartyItem, PartyRecord } from '@lib/party-store'

const pkg = (over: Partial<PartyPackage>): PartyPackage => ({
  id: 'pkg_x', name: 'X', priceCents: 10000, minutes: 90, minGuests: 1, maxGuests: 30, defaultGuests: 10, quickPicks: [], who: 'everyone', archived: false, ...over,
})
const add = (over: Partial<PartyAddOn>): PartyAddOn => ({
  id: 'add_x', label: 'X', priceCents: 1000, per: 'party', extraMinutes: 0, maxQty: 1, online: true, archived: false, ...over,
})

function settings(): PartySettings {
  const s = structuredClone(configPartySettings())
  s.packages.push(
    pkg({ id: 'pkg_test', name: 'Test party', priceCents: 100, minutes: 30, who: 'link' }),
    pkg({ id: 'pkg_private', name: 'Private evening', priceCents: 50000, minutes: 120, minGuests: 10, maxGuests: 30, who: 'admin' }),
    pkg({ id: 'pkg_old', name: 'Old', archived: true }),
  )
  s.addOns.push(
    add({ id: 'add_bags', label: 'Goodie bags', priceCents: 500, per: 'guest' }),
    add({ id: 'add_half', label: 'Extra half hour', priceCents: 5000, extraMinutes: 30 }),
    add({ id: 'add_balloons', label: 'Balloons', priceCents: 2000, maxQty: 3, online: false }),
    add({ id: 'add_gone', label: 'Gone', archived: true }),
  )
  return s
}

const ok = <T,>(r: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error(`expected ok, got ${r.error}`)
  return r.value
}

describe('quoteParty', () => {
  it('whole studio, 10 guests = $300, 90 minutes, one package line', () => {
    const q = ok(quoteParty(settings(), { guests: 10 }, 'public'))
    expect(q.totalCents).toBe(30000)
    expect(q.minutes).toBe(90)
    expect(q.pkg.id).toBe('pkg_whole')
    expect(q.items).toEqual([{ kind: 'package', refId: 'pkg_whole', label: 'Whole studio', qty: 1, count: 1, unitCents: 30000, cents: 30000, extraMinutes: 0 }])
  })

  it('refuses 9 or 31 guests, and a fraction', () => {
    for (const guests of [9, 31, 10.5, Number.NaN]) {
      const r = quoteParty(settings(), { guests }, 'public')
      expect(r).toEqual({ ok: false, error: 'Parties are for 10 to 30 guests.', field: 'guests' })
    }
  })

  it('refuses an unknown or archived package', () => {
    for (const packageId of ['pkg_nope', 'pkg_old']) {
      const r = quoteParty(settings(), { packageId, guests: 10 }, 'admin')
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.field).toBe('packageId')
    }
  })

  it('a link package: refused for the public without its id, allowed with it and for owners', () => {
    expect(quoteParty(settings(), { packageId: 'pkg_test', guests: 5 }, 'public').ok).toBe(false)
    expect(quoteParty(settings(), { packageId: 'pkg_test', guests: 5 }, 'public', 'pkg_other').ok).toBe(false)
    expect(ok(quoteParty(settings(), { packageId: 'pkg_test', guests: 5 }, 'public', 'pkg_test')).totalCents).toBe(100)
    expect(ok(quoteParty(settings(), { packageId: 'pkg_test', guests: 5 }, 'link', 'pkg_test')).totalCents).toBe(100)
    expect(ok(quoteParty(settings(), { guests: 5 }, 'link', 'pkg_test')).pkg.id).toBe('pkg_test')
    expect(ok(quoteParty(settings(), { packageId: 'pkg_test', guests: 5 }, 'admin')).totalCents).toBe(100)
  })

  it('an owners-only package only from /admin', () => {
    expect(quoteParty(settings(), { packageId: 'pkg_private', guests: 12 }, 'public').ok).toBe(false)
    expect(quoteParty(settings(), { packageId: 'pkg_private', guests: 12 }, 'link', 'pkg_private').ok).toBe(false)
    expect(ok(quoteParty(settings(), { packageId: 'pkg_private', guests: 12 }, 'admin')).totalCents).toBe(50000)
  })

  it('a per-guest extra is priced × guests', () => {
    const q = ok(quoteParty(settings(), { guests: 14, addOns: { add_bags: 1 } }, 'public'))
    expect(q.items[1]).toEqual({ kind: 'addon', refId: 'add_bags', label: 'Goodie bags', qty: 14, count: 1, forGuests: 14, unitCents: 500, cents: 7000, extraMinutes: 0 })
    expect(q.totalCents).toBe(30000 + 7000)
  })

  it('keeps to maxQty; zero means none; refuses a bad count', () => {
    expect(ok(quoteParty(settings(), { guests: 10, addOns: { add_balloons: 3 } }, 'admin')).totalCents).toBe(36000)
    const r = quoteParty(settings(), { guests: 10, addOns: { add_balloons: 4 } }, 'admin')
    expect(r).toEqual({ ok: false, error: 'You can add up to 3 Balloons.', field: 'addOns.add_balloons' })
    expect(ok(quoteParty(settings(), { guests: 10, addOns: { add_half: 0 } }, 'public')).items).toHaveLength(1)
    expect(quoteParty(settings(), { guests: 10, addOns: { add_half: -1 } }, 'public').ok).toBe(false)
    expect(quoteParty(settings(), { guests: 10, addOns: { add_half: 1.5 } }, 'public').ok).toBe(false)
  })

  it('an extra not offered online is refused for the public, allowed for owners', () => {
    const r = quoteParty(settings(), { guests: 10, addOns: { add_balloons: 1 } }, 'public')
    expect(r).toEqual({ ok: false, error: 'That extra isn’t available.', field: 'addOns.add_balloons' })
    expect(quoteParty(settings(), { guests: 10, addOns: { add_balloons: 1 } }, 'link', 'pkg_test').ok).toBe(false)
    expect(ok(quoteParty(settings(), { guests: 10, addOns: { add_balloons: 1 } }, 'admin')).totalCents).toBe(32000)
  })

  it('refuses an unknown or archived extra', () => {
    for (const id of ['add_nope', 'add_gone']) expect(quoteParty(settings(), { guests: 10, addOns: { [id]: 1 } }, 'admin').ok).toBe(false)
  })

  it('an extra half hour adds 30 minutes', () => {
    const q = ok(quoteParty(settings(), { guests: 10, addOns: { add_half: 1 } }, 'public'))
    expect(q.minutes).toBe(120)
    expect(q.items[1]).toMatchObject({ refId: 'add_half', extraMinutes: 30, cents: 5000 })
    expect(q.totalCents).toBe(35000)
  })

  it('never takes a price from the request', () => {
    const q = ok(quoteParty(settings(), { guests: 10, priceCents: 1, totalCents: 1 } as never, 'public'))
    expect(q.totalCents).toBe(30000)
  })
})

describe('quoteAddOn (an extra added to a booked party)', () => {
  const rec = (over: Partial<PartyRecord> = {}): PartyRecord => ({
    bookingId: 'pty_1', hostToken: 't', craftName: 'Pails', startIso: '2026-11-08T19:30:00.000Z', durationMinutes: 90, hostName: 'Ada',
    hostEmail: 'a@x.co', guestCount: 12, title: null, dropOff: false, createdAt: '2026-10-19T00:00:00.000Z', source: 'ours', status: 'booked', items: [], ...over,
  })

  it('prices per guest from the party’s guests and allows offline extras', () => {
    expect(ok(quoteAddOn(settings(), rec(), 'add_bags', 1))).toEqual({ kind: 'addon', refId: 'add_bags', label: 'Goodie bags', qty: 12, count: 1, forGuests: 12, unitCents: 500, cents: 6000, extraMinutes: 0 })
    expect(ok(quoteAddOn(settings(), rec(), 'add_balloons', 2)).cents).toBe(4000)
  })

  it('counts what the party already has toward maxQty', () => {
    const have = { id: 'itm_1', kind: 'addon' as const, refId: 'add_balloons', label: 'Balloons', qty: 2, count: 2, unitCents: 2000, cents: 4000, extraMinutes: 0, chargeId: null, addedAt: '', by: null }
    expect(quoteAddOn(settings(), rec({ items: [have] }), 'add_balloons', 2).ok).toBe(false)
    expect(ok(quoteAddOn(settings(), rec({ items: [have] }), 'add_balloons', 1)).cents).toBe(2000)
  })

  it('refuses unknown, archived, a cancelled party and a Square-booked one, naming the field', () => {
    expect(quoteAddOn(settings(), rec(), 'add_nope', 1)).toEqual({ ok: false, error: 'That extra isn’t available.', field: 'addOns.add_nope' })
    expect(quoteAddOn(settings(), rec(), 'add_gone', 1)).toEqual({ ok: false, error: 'That extra isn’t available.', field: 'addOns.add_gone' })
    expect(quoteAddOn(settings(), rec(), 'add_half', 0)).toEqual({ ok: false, error: 'You can add up to 1 Extra half hour.', field: 'addOns.add_half' })
    expect(quoteAddOn(settings(), rec({ status: 'cancelled' }), 'add_half', 1)).toEqual({ ok: false, error: 'This party was cancelled.', field: 'status' })
    expect(quoteAddOn(settings(), rec({ source: undefined }), 'add_half', 1)).toEqual({ ok: false, error: 'This party was booked in Square. Change it there.', field: 'source' })
  })

  const bagItem = (over: Partial<PartyItem>): PartyItem => ({
    id: 'itm_b', kind: 'addon', refId: 'add_bags', label: 'Goodie bags', qty: 30, count: 1, forGuests: 30, unitCents: 500, cents: 15000, extraMinutes: 0, chargeId: 'chg_1', addedAt: '', by: null, ...over,
  })
  const threeBags = () => {
    const s = settings()
    s.addOns.find((a) => a.id === 'add_bags')!.maxQty = 3
    return s
  }

  it('30 → 10 guests, then add: the quota counts what was chosen (1), not 30 ÷ 10', () => {
    const r = rec({ guestCount: 10, items: [bagItem({})] })
    expect(quoteAddOn(settings(), r, 'add_bags', 1)).toEqual({ ok: false, error: 'You can add up to 1 Goodie bags.', field: 'addOns.add_bags' })
    const more = ok(quoteAddOn(threeBags(), r, 'add_bags', 2))
    expect(more).toMatchObject({ count: 2, forGuests: 10, qty: 20, cents: 10000 })
    expect(quoteAddOn(threeBags(), r, 'add_bags', 3).ok).toBe(false)
  })

  it('an old item with no count is derived once as before', () => {
    const r = rec({ guestCount: 10, items: [bagItem({ count: undefined, forGuests: undefined })] })
    expect(quoteAddOn(threeBags(), r, 'add_bags', 1).ok).toBe(false) // 30 ÷ 10 = 3 already
  })

  it('10 → 20 guests: a top-up charges the 10 new guests only, and never guests already covered', () => {
    const r = rec({ guestCount: 20, items: [bagItem({ qty: 10, forGuests: 10, cents: 5000 })] })
    const top = ok(quoteAddOn(settings(), r, 'add_bags', 1, 10))
    expect(top).toEqual({ kind: 'addon', refId: 'add_bags', label: 'Goodie bags', qty: 10, count: 1, forGuests: 10, topUp: true, unitCents: 500, cents: 5000, extraMinutes: 0 })
    expect(quoteAddOn(settings(), r, 'add_bags', 1, 11)).toEqual({ ok: false, error: 'Only 10 guests don’t have Goodie bags yet.', field: 'forGuests' })
    const after = rec({ guestCount: 20, items: [bagItem({ qty: 10, forGuests: 10, cents: 5000 }), { ...bagItem({}), ...top, id: 'itm_t', chargeId: null }] })
    expect(quoteAddOn(settings(), after, 'add_bags', 1, 1)).toEqual({ ok: false, error: 'Every guest already has Goodie bags.', field: 'forGuests' })
    // and a top-up item doesn't use up the quota of a three-a-guest extra
    expect(ok(quoteAddOn(threeBags(), after, 'add_bags', 2))).toMatchObject({ count: 2, forGuests: 20, qty: 40 })
  })

  it('a top-up needs the extra on the party already, a per-guest extra, and a whole number of guests', () => {
    expect(quoteAddOn(settings(), rec(), 'add_bags', 1, 5)).toEqual({ ok: false, error: 'Add Goodie bags for every guest first.', field: 'forGuests' })
    expect(quoteAddOn(settings(), rec(), 'add_balloons', 1, 5)).toEqual({ ok: false, error: 'Balloons is per party, not per guest.', field: 'forGuests' })
    const r = rec({ guestCount: 20, items: [bagItem({ qty: 10, forGuests: 10 })] })
    for (const g of [0, -1, 2.5]) expect(quoteAddOn(settings(), r, 'add_bags', 1, g).ok).toBe(false)
    expect(quoteAddOn(settings(), r, 'add_bags', 2, 10)).toEqual({ ok: false, error: 'You can add up to 1 Goodie bags.', field: 'addOns.add_bags' })
  })
})

describe('items keep their price', () => {
  it('changing the saved price never changes an existing record’s items', () => {
    const s = settings()
    const q = ok(quoteParty(s, { guests: 10, addOns: { add_half: 1 } }, 'public'))
    const items: PartyItem[] = q.items.map((it, i) => ({ ...it, id: `itm_${i}`, chargeId: null, addedAt: '2026-10-19T00:00:00.000Z', by: null }))
    const rec = { source: 'ours', status: 'booked', items } as PartyRecord
    s.packages[0].priceCents = 35000
    s.packages[0].name = 'Renamed'
    s.addOns.find((a) => a.id === 'add_half')!.priceCents = 9900
    expect(dueCents(rec)).toBe(35000)
    expect(rec.items![0]).toMatchObject({ label: 'Whole studio', unitCents: 30000, cents: 30000 })
    expect(ok(quoteParty(s, { guests: 10 }, 'public')).totalCents).toBe(35000)
  })
})

describe('orderLineItems', () => {
  const pkgItem = (refId: string, label: string, cents: number) => ({ kind: 'package' as const, refId, label, qty: 1, unitCents: cents })
  it('the whole-studio package keeps today’s line name; its extras share the prefix', () => {
    const lines = orderLineItems([pkgItem('pkg_whole', 'Whole studio', 30000), { kind: 'addon', refId: 'add_bags', label: 'Goodie bags', qty: 12, unitCents: 500 }], 'Whole studio', 'pkg_whole')
    expect(lines).toEqual([
      { name: 'Whole Studio Party — studio fee', quantity: 1, pricePerUnit: 30000, note: 'pkg_whole' },
      { name: 'Whole Studio Party — Goodie bags', quantity: 12, pricePerUnit: 500, note: 'add_bags' },
    ])
  })

  it('other packages are "Party — <name>"', () => {
    const lines = orderLineItems([pkgItem('pkg_test', 'Test party', 100), { kind: 'addon', refId: 'add_half', label: 'Extra half hour', qty: 1, unitCents: 5000 }], 'Test party', 'pkg_test')
    expect(lines.map((l) => l.name)).toEqual(['Party — Test party', 'Party — Extra half hour'])
  })

  it('extras paid later on a whole-studio party keep the whole-studio prefix', () => {
    const lines = orderLineItems([{ kind: 'addon', refId: 'add_half', label: 'Extra half hour', qty: 1, unitCents: 5000 }], 'Whole studio', 'pkg_whole')
    expect(lines[0].name).toBe('Whole Studio Party — Extra half hour')
  })
})

describe('browser-safe', () => {
  it('pricing.ts and money.ts import no server code', () => {
    for (const f of ['src/lib/parties/pricing.ts', 'src/lib/parties/money.ts']) {
      const src = readFileSync(join(process.cwd(), f), 'utf8')
      expect(src, f).not.toMatch(/from ['"]node:/)
      expect(src, f).not.toMatch(/makeKvStore|process\.env/)
      for (const m of src.matchAll(/^import (?!type ).*from ['"]([^'"]+)['"]/gm)) expect(m[1], f).toMatch(/^\.\/party-times$|^\.\/types$/)
    }
  })
})
