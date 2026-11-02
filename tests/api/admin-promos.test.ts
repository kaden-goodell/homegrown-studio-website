// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const audit = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('@lib/audit', () => ({ recordAudit: audit }))

import * as route from '@pages/api/admin/promos.json'
import { adminCookie } from '@lib/admin-auth'
import { createClass } from '@lib/classes/class-store'
import { confirmUse, getUses, reserveUse } from '@lib/promos/promo-store'
import { defaultRules } from '@lib/classes/validate'
import { makeKvStore } from '@lib/blob-store'
import { shortDay } from '@lib/classes/chicago-day'
import type { ClassContent } from '@lib/classes/types'

const cookie = () => adminCookie().split(';')[0]
async function call(method: 'GET' | 'POST', body?: unknown, opts: { signedIn?: boolean; query?: string } = {}) {
  const request = new Request(`https://x.test/api/admin/promos.json${opts.query ?? ''}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Admin-Who': 'Catherine', ...(opts.signedIn === false ? {} : { cookie: cookie() }) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  const res: Response = await (route as any)[method]({ request, url: new URL(request.url) })
  return { status: res.status, body: await res.json() }
}
let n = 0
const fresh = (p = 'CODE') => `${p}${++n}${Date.now().toString(36).toUpperCase().slice(-5)}`
const fields = (code: string, over: Record<string, unknown> = {}) => ({
  code, label: 'Grand opening', off: { kind: 'percent', percent: 10 }, per: 'booking', appliesTo: { kind: 'all' },
  includeExtras: false, endsYmd: null, maxUses: null, active: true, ...over,
})
const content = (name: string): ClassContent => ({
  name, description: 'Make a thing.', imageUrl: null, instructor: null, rules: defaultRules(),
  ticketTypes: [{ id: 'person', label: 'Person' }], passes: [{ id: 'all', label: 'All', covers: { kind: 'all' } }],
  prices: { all: { person: 2500 } }, questions: [], addOns: [], defaultCapacity: 10, defaultMinutes: 60,
})

beforeEach(() => { audit.mockClear(); vi.stubEnv('ADMIN_PASSCODE', 'owner-secret') })

describe('/api/admin/promos.json', () => {
  it('owners only', async () => {
    expect((await call('GET', undefined, { signedIn: false })).status).toBe(401)
    expect((await call('POST', { action: 'save', fields: fields(fresh()), expectedUpdatedAt: null }, { signedIn: false })).status).toBe(401)
  })

  it('makes a code (audited); the same code again is "That code is taken."', async () => {
    const code = fresh('FALL')
    const made = await call('POST', { action: 'save', fields: fields(code.toLowerCase()), expectedUpdatedAt: null })
    expect(made.status).toBe(200)
    expect(made.body.data.code).toMatchObject({ code, usedCount: 0, payingNow: 0, active: true, by: { name: 'Catherine' } })
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'promo.save', target: expect.objectContaining({ kind: 'promo', id: code }) }))
    const again = await call('POST', { action: 'save', fields: fields(code), expectedUpdatedAt: null })
    expect(again).toMatchObject({ status: 409, body: { error: 'That code is taken.', field: 'code' } })
    expect(again.body.stale).toBeUndefined()
  })

  it('refuses in place: a bad amount names its field; nothing saved', async () => {
    const code = fresh()
    const r = await call('POST', { action: 'save', fields: fields(code, { off: { kind: 'percent', percent: 150 } }), expectedUpdatedAt: null })
    expect(r).toMatchObject({ status: 400, body: { field: 'off', error: 'Percent off is a whole number from 1 to 100.' } })
    expect((await call('GET', undefined, { query: `?code=${code}` })).status).toBe(404)
  })

  it('edits with expectedUpdatedAt; an old one is stale (409, stale: true); the code text never changes', async () => {
    const code = fresh()
    const made = (await call('POST', { action: 'save', fields: fields(code), expectedUpdatedAt: null })).body.data.code
    const edited = await call('POST', { action: 'save', fields: fields(code, { maxUses: 20 }), expectedUpdatedAt: made.updatedAt })
    expect(edited.status).toBe(200)
    expect(edited.body.data.code).toMatchObject({ maxUses: 20 })
    const stale = await call('POST', { action: 'save', fields: fields(code, { maxUses: 5 }), expectedUpdatedAt: made.updatedAt })
    expect(stale).toMatchObject({ status: 409, body: { stale: true } })
  })

  it('turns a code off and on (audited)', async () => {
    const code = fresh()
    const made = (await call('POST', { action: 'save', fields: fields(code), expectedUpdatedAt: null })).body.data.code
    const off = await call('POST', { action: 'active', code, active: false, expectedUpdatedAt: made.updatedAt })
    expect(off.body.data.code.active).toBe(false)
    expect(audit).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'promo.active', details: { active: false } }))
    const on = await call('POST', { action: 'active', code, active: true, expectedUpdatedAt: off.body.data.code.updatedAt })
    expect(on.body.data.code.active).toBe(true)
  })

  it('an ended code can still be turned off (its old last day is not re-checked)', async () => {
    const code = fresh()
    const made = (await call('POST', { action: 'save', fields: fields(code, { endsYmd: '2099-01-01' }), expectedUpdatedAt: null })).body.data.code
    // Pretend the day passed: rewrite the stored last day.
    const kv = makeKvStore('promo-codes', 'promo-codes')
    await kv.set(`code-${code}`, JSON.stringify({ ...made, endsYmd: '2020-01-01' }))
    const off = await call('POST', { action: 'active', code, active: false, expectedUpdatedAt: made.updatedAt })
    expect(off.status).toBe(200)
  })

  it('the list names picked classes, lists choices, counts uses; ?code= says who used it; Give this use back works once', async () => {
    const lib = await (await import('@lib/classes/library-store')).saveLibraryVersion({ content: content('Clay Camp'), by: { id: 'k', name: 'K' }, note: '' })
    // A date a month ahead (the picker lists the coming year's classes), at noon Chicago.
    const ymd = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)
    const label = `Looms · ${shortDay(ymd)}`
    const cls = await createClass({
      content: content('Looms'), status: 'open', by: { id: 'k', name: 'K' },
      sessions: [{ id: 'ses_1', startIso: `${ymd}T17:00:00.000Z`, endIso: `${ymd}T19:00:00.000Z`, capacity: 10 }],
    })
    const code = fresh('MAYA')
    await call('POST', { action: 'save', fields: fields(code, { maxUses: 1, appliesTo: { kind: 'classes', libraryIds: [lib.id], classIds: [cls.id] } }), expectedUpdatedAt: null })
    // Maya booked with it and was then refunded (her seat freed).
    await makeKvStore('seat-ledger', 'seat-ledger').set(`ledger-${cls.id}`, JSON.stringify({ classId: cls.id, lines: [{
      id: 'led_m', bookingId: 'bkg_maya', sessionIds: ['ses_1'], ticketTypeId: 'person', passId: 'all', seat: 1, priceCents: 0, taxCents: 0,
      addOns: {}, addOnCents: 0, addOnTaxCents: 0, answers: {}, source: 'online', state: 'refunded', holdExpiresAt: null,
      customer: { givenName: 'Maya', familyName: 'Rivera', email: 'm@example.com', phone: '' },
      square: { orderId: null, paymentId: null, lineUid: null, chargedCents: 0 }, by: null,
      refunds: [{ at: '2026-11-01T00:00:00Z', cents: 0, reason: 'cancelled', by: { id: 'k', name: 'K' }, freedSeat: true, squareRefundId: null }], at: '2026-10-30T00:00:00Z',
    }] }))
    await reserveUse(code, 'bkg_maya', new Date(Date.now() + 60_000).toISOString(), new Date(), 1)
    await confirmUse(code, 'bkg_maya', cls.id)

    const list = await call('GET')
    expect(list.status).toBe(200)
    const mine = list.body.data.codes.find((c: any) => c.code === code)
    expect(mine).toMatchObject({ usedCount: 1, maxUses: 1 })
    expect(list.body.data.names[lib.id]).toBe('Clay Camp')
    expect(list.body.data.names[cls.id]).toBe(label)
    expect(list.body.data.choices).toEqual(expect.arrayContaining([
      { kind: 'library', id: lib.id, name: 'Clay Camp' },
      { kind: 'class', id: cls.id, name: 'Looms', day: ymd },
    ]))

    const one = await call('GET', undefined, { query: `?code=${code.toLowerCase()}` })
    expect(one.body.data.uses).toEqual([expect.objectContaining({ bookingId: 'bkg_maya', who: 'Maya Rivera', className: label, cancelled: true, seats: 1 })])

    const back = await call('POST', { action: 'give-back', code, bookingId: 'bkg_maya' })
    expect(back.status).toBe(200)
    expect(back.body.data.code.usedCount).toBe(0)
    expect(back.body.data.givenBack).toEqual([expect.objectContaining({ bookingId: 'bkg_maya', by: 'Catherine', who: 'Maya Rivera' })])
    expect(audit).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'promo.give-back', details: { bookingId: 'bkg_maya' } }))
    expect((await getUses(code))!.used).toEqual([])
    const twice = await call('POST', { action: 'give-back', code, bookingId: 'bkg_maya' })
    expect(twice.status).toBe(409)
  })

  it('an unknown code is 404', async () => {
    expect((await call('GET', undefined, { query: '?code=NOSUCH999' })).status).toBe(404)
    expect((await call('POST', { action: 'active', code: 'NOSUCH999', active: false, expectedUpdatedAt: 'x' })).status).toBe(404)
  })
})
