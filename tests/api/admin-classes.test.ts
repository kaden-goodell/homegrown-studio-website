// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  listBookings: vi.fn(),
  listAllWorkshops: vi.fn(),
  sync: vi.fn(),
  archive: vi.fn(),
  squareFetch: vi.fn(),
  audit: vi.fn(),
  libraryDown: false,
  classDown: 0,
}))
vi.mock('@lib/classes/class-store', async (importOriginal) => {
  const real = await importOriginal<typeof import('@lib/classes/class-store')>()
  return {
    ...real,
    // classDown > 0: that many class writes fail (the blob store dropped), after anything written before them.
    createClass: (...a: Parameters<typeof real.createClass>) =>
      mocks.classDown > 0 ? (mocks.classDown--, Promise.reject(new Error('Blob store "classes" is unavailable'))) : real.createClass(...a),
  }
})
vi.mock('@config/providers', () => ({
  providers: {
    booking: { listBookings: mocks.listBookings },
    workshop: { listAllWorkshops: mocks.listAllWorkshops, listWorkshops: vi.fn(async () => []) },
  },
}))
vi.mock('@lib/party-store', () => ({ getPartyRecord: vi.fn(async () => null) }))
vi.mock('@lib/classes/square-catalog', () => ({ syncClassToSquare: mocks.sync, archiveClassInSquare: mocks.archive, CLASS_TAX_NOT_SET: "Class tax isn't set up yet." }))
vi.mock('@lib/classes/square-api', () => ({ squareFetch: mocks.squareFetch, squareSettings: () => ({ environment: 'sandbox' }) }))
vi.mock('@lib/audit', () => ({ recordAudit: mocks.audit }))
vi.mock('@lib/classes/library-store', async (importOriginal) => {
  const real = await importOriginal<typeof import('@lib/classes/library-store')>()
  return {
    ...real,
    saveLibraryVersion: (...a: Parameters<typeof real.saveLibraryVersion>) =>
      mocks.libraryDown ? Promise.reject(new Error('Blob store "class-library" is unavailable')) : real.saveLibraryVersion(...a),
  }
})

import * as library from '@pages/api/admin/classes/library.json'
import * as classes from '@pages/api/admin/classes/classes.json'
import * as blocked from '@pages/api/admin/classes/blocked.json'
import * as bookings from '@pages/api/admin/classes/bookings.json'
import * as photo from '@pages/api/admin/classes/photo.json'
import { adminCookie } from '@lib/admin-auth'
import { getClass } from '@lib/classes/class-store'
import { getLibrary, saveLibraryVersion } from '@lib/classes/library-store'
import { getLedger, type LedgerLine } from '@lib/classes/seat-ledger'
import { makeKvStore } from '@lib/blob-store'
import { localToUtcISO } from '@lib/party-slots'
import type { ClassContent } from '@lib/classes/types'

const cookie = () => adminCookie().split(';')[0]
const req = (url: string, init: { method?: string; body?: unknown; signedIn?: boolean } = {}) =>
  new Request(`https://x.test${url}`, {
    method: init.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', ...(init.signedIn === false ? {} : { cookie: cookie() }) },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  })
const call = async (route: any, method: 'GET' | 'POST', url: string, body?: unknown, signedIn = true) => {
  const request = req(url, { method, body, signedIn })
  const res: Response = await route[method]({ request, url: new URL(request.url) } as any)
  return { status: res.status, body: await res.json() }
}

function content(name: string, over: Partial<ClassContent> = {}): ClassContent {
  return {
    name, description: 'Make a thing.', imageUrl: null, instructor: null,
    rules: { ages: '', dropOff: false, madeToOrder: false, taxable: true, maxPerBooking: 10, signupCutoffHours: null, minimumToRun: null, linkOnly: false, joinPartway: true, waitlistCutoffHours: 2, canShareRoom: false },
    ticketTypes: [{ id: 'person', label: 'Person' }, { id: 'kid', label: 'Kid' }],
    passes: [{ id: 'all', label: 'Full', covers: { kind: 'all' } }],
    prices: { all: { person: 3000, kid: 2000 } }, questions: [], addOns: [], defaultCapacity: 12, defaultMinutes: 90,
    ...over,
  }
}
const at = (ymd: string, hhmm: string) => localToUtcISO(ymd, hhmm)
let n = 0
const ses = (ymd: string, from: string, to: string, capacity = 12) => ({ id: `ses_a${++n}`, startIso: at(ymd, from), endIso: at(ymd, to), capacity })

const ledgerKv = makeKvStore('seat-ledger', 'seat-ledger')
/** An update from a form showing the class as it is now. */
const update = async (body: any) =>
  call(classes, 'POST', '/api/admin/classes/classes.json', { action: 'update', expectedUpdatedAt: (await getClass(body.id))?.updatedAt, ...body })
const cancel = async (id: string) =>
  call(classes, 'POST', '/api/admin/classes/classes.json', { action: 'cancel', id, expectedUpdatedAt: (await getClass(id))?.updatedAt })
function line(over: Partial<LedgerLine>): LedgerLine {
  return {
    id: `led_${++n}`, bookingId: 'bkg_1', sessionIds: [], ticketTypeId: 'person', passId: 'all', seat: 1,
    priceCents: 3000, taxCents: 270, addOns: {}, addOnCents: 0, addOnTaxCents: 0, answers: {}, source: 'online',
    state: 'confirmed', holdExpiresAt: null,
    customer: { givenName: 'Ada', familyName: 'Lovelace', email: 'ada@example.com', phone: '4029802907' },
    square: { orderId: 'o1', paymentId: 'p1', lineUid: null }, by: null, refunds: [], at: new Date().toISOString(),
    ...over,
  }
}
async function seedLedger(classId: string, lines: LedgerLine[]) {
  await ledgerKv.set(`ledger-${classId}`, JSON.stringify({ classId, lines }))
}

beforeEach(() => {
  vi.stubEnv('ADMIN_PASSCODE', 'owner-secret')
  mocks.listBookings.mockReset().mockResolvedValue([])
  mocks.listAllWorkshops.mockReset().mockResolvedValue([])
  mocks.sync.mockReset().mockImplementation(async (c: any) => ({ itemId: `item-${c.id}`, variations: { 'all:person': 'v1' }, imageUrl: null }))
  mocks.archive.mockReset().mockResolvedValue(undefined)
  mocks.squareFetch.mockReset().mockRejectedValue(new Error('no live Square in tests'))
  mocks.audit.mockReset().mockResolvedValue(undefined)
})
afterEach(() => vi.unstubAllEnvs())

describe('auth', () => {
  it('every route refuses without the owner cookie', async () => {
    for (const [route, methods] of [[library, ['GET', 'POST']], [classes, ['GET', 'POST']], [blocked, ['GET', 'POST']], [bookings, ['GET']], [photo, ['POST']]] as const) {
      for (const m of methods) {
        const r = await call(route, m as any, '/api/admin/classes/x?id=cls_x', m === 'POST' ? {} : undefined, false)
        expect(r.status).toBe(401)
        expect(r.body.error).toBe('Sign in first.')
      }
    }
  })
})

describe('library', () => {
  it('saves versions, lists, restores and archives', async () => {
    const saved = await call(library, 'POST', '/api/admin/classes/library.json', { action: 'save', content: content('Lib Candles'), note: 'First' })
    expect(saved.status).toBe(200)
    const id = saved.body.data.library.id
    await call(library, 'POST', '/api/admin/classes/library.json', { action: 'save', id, content: content('Lib Candles 2'), note: 'Second' })
    const restored = await call(library, 'POST', '/api/admin/classes/library.json', { action: 'restore', id, version: 1 })
    expect(restored.body.data.library.versions).toHaveLength(3)
    expect(restored.body.data.library.versions[2].content.name).toBe('Lib Candles')
    const list = await call(library, 'GET', '/api/admin/classes/library.json')
    expect(list.body.data.library.some((l: any) => l.id === id)).toBe(true)
    const arch = await call(library, 'POST', '/api/admin/classes/library.json', { action: 'archive', id, archived: true })
    expect(arch.body.data.library.archived).toBe(true)
    const after = await call(library, 'GET', '/api/admin/classes/library.json')
    expect(after.body.data.library.some((l: any) => l.id === id)).toBe(false)
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'class-library-save', by: expect.objectContaining({ id: 'admin', name: 'Owner', role: 'owner' }) }))
  })
  it('bad content is a 400 with a plain sentence; unknown id is 404', async () => {
    const bad = await call(library, 'POST', '/api/admin/classes/library.json', { action: 'save', content: { ...content(''), name: '' }, note: '' })
    expect(bad.status).toBe(400)
    expect(bad.body.error).toMatch(/\.$/)
    const missing = await call(library, 'POST', '/api/admin/classes/library.json', { action: 'restore', id: 'lib_nope', version: 1 })
    expect(missing.status).toBe(404)
  })
})

describe('scheduling', () => {
  it('creates from the library, records the version and syncs the POS', async () => {
    const lib = await saveLibraryVersion({ content: content('From Library'), by: { id: 'k', name: 'K' }, note: '' })
    const r = await call(classes, 'POST', '/api/admin/classes/classes.json', {
      action: 'create', libraryId: lib.id, sessions: [{ startIso: at('2031-01-09', '17:00'), endIso: at('2031-01-09', '19:00'), capacity: 10 }], status: 'open',
    })
    expect(r.status).toBe(200)
    const cls = r.body.data.class
    expect(cls.id).toMatch(/^cls_/)
    expect(cls.sessions[0].id).toMatch(/^ses_/)
    expect(cls.libraryId).toBe(lib.id)
    expect(cls.libraryVersion).toBe(1)
    expect(cls.content.name).toBe('From Library')
    expect(mocks.sync).toHaveBeenCalledTimes(1)
    expect((await getClass(cls.id))!.square.itemId).toBe(`item-${cls.id}`)
    expect(r.body.warning).toBeUndefined()
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'class-create', target: expect.objectContaining({ id: cls.id }) }))
  })

  it('a draft is not put on the POS', async () => {
    const r = await call(classes, 'POST', '/api/admin/classes/classes.json', { action: 'create', content: content('Drafty'), sessions: [ses('2031-01-16', '17:00', '18:00')], status: 'draft' })
    expect(r.status).toBe(200)
    expect(mocks.sync).not.toHaveBeenCalled()
  })

  it('a Square failure keeps our change and warns', async () => {
    mocks.sync.mockRejectedValueOnce(new Error('Square down'))
    const r = await call(classes, 'POST', '/api/admin/classes/classes.json', { action: 'create', content: content('Square Down'), sessions: [ses('2031-01-23', '17:00', '18:00')], status: 'open' })
    expect(r.status).toBe(200)
    expect(r.body.warning).toBe("Saved. The POS item didn't update. Try Save again.")
    expect(await getClass(r.body.data.class.id)).not.toBeNull()
  })

  it('a taxable class with no class tax set up is saved off the POS, and the owner is told why', async () => {
    mocks.sync.mockRejectedValueOnce(new Error("Class tax isn't set up yet."))
    const r = await call(classes, 'POST', '/api/admin/classes/classes.json', { action: 'create', content: content('No Tax Yet'), sessions: [ses('2031-01-30', '17:00', '18:00')], status: 'open' })
    expect(r.status).toBe(200)
    expect(r.body.warning).toBe("Saved, but it isn't on the POS: Class tax isn't set up yet. It can't be sold until it is.")
    expect((await getClass(r.body.data.class.id))!.square.itemId).toBeNull()
  })

  it('refuses a clash with the clash message, allows rooms that can share', async () => {
    const day = '2031-02-06'
    const first = await call(classes, 'POST', '/api/admin/classes/classes.json', { action: 'create', content: content('Pottery'), sessions: [ses(day, '17:00', '19:00')], status: 'open' })
    expect(first.status).toBe(200)
    const clash = await call(classes, 'POST', '/api/admin/classes/classes.json', { action: 'create', content: content('Painting'), sessions: [ses(day, '18:00', '20:00')], status: 'open' })
    expect(clash.status).toBe(409)
    expect(clash.body.error).toMatch(/^Clashes with Pottery, /)

    const shareRules = { ...content('x').rules, canShareRoom: true }
    const a = await call(classes, 'POST', '/api/admin/classes/classes.json', { action: 'create', content: content('Share A', { rules: shareRules }), sessions: [ses('2031-02-13', '17:00', '19:00')], status: 'open' })
    const b = await call(classes, 'POST', '/api/admin/classes/classes.json', { action: 'create', content: content('Share B', { rules: shareRules }), sessions: [ses('2031-02-13', '18:00', '20:00')], status: 'open' })
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
  })

  it('M8: editing only the details never re-checks clashes on sessions that already ended', async () => {
    const { createClass } = await import('@lib/classes/class-store')
    const { addBlocked } = await import('@lib/classes/blocked-time')
    const past = ses('2025-03-01', '10:00', '12:00')
    const future = ses('2031-04-01', '10:00', '12:00')
    const c = await createClass({ content: content('Started Camp'), sessions: [past, future], status: 'open', by: { id: 'admin', name: 'Owner' } })
    await addBlocked({ startIso: past.startIso, endIso: past.endIso, reason: 'Floor redone', by: { id: 'admin', name: 'Owner' } })
    const r = await update({ id: c.id, content: content('Started Camp', { description: 'New words.' }) })
    expect(r.status).toBe(200)
    // a session list with the ended one unchanged doesn't re-check it either
    const again = await update({ id: c.id, sessions: (await getClass(c.id))!.sessions })
    expect(again.status).toBe(200)
  })

  it('moving a class past itself is not a clash with itself', async () => {
    const c = await call(classes, 'POST', '/api/admin/classes/classes.json', { action: 'create', content: content('Mover'), sessions: [ses('2031-02-20', '17:00', '19:00')], status: 'open' })
    const s = c.body.data.class.sessions[0]
    const r = await update({ id: c.body.data.class.id, sessions: [{ ...s, startIso: at('2031-02-20', '18:00'), endIso: at('2031-02-20', '20:00') }] })
    expect(r.status).toBe(200)
  })

  it('a 400 for bad sessions and 404 for an unknown class', async () => {
    const bad = await call(classes, 'POST', '/api/admin/classes/classes.json', { action: 'create', content: content('Bad'), sessions: [], status: 'open' })
    expect(bad.status).toBe(400)
    expect(bad.body.error).toBe('Add at least one session.')
    const missing = await update({ id: 'cls_nope', status: 'closed', expectedUpdatedAt: 'x' })
    expect(missing.status).toBe(404)
  })

  it('duplicate copies content onto new sessions with no bookings', async () => {
    const src = await call(classes, 'POST', '/api/admin/classes/classes.json', { action: 'create', content: content('Original'), sessions: [ses('2031-03-06', '17:00', '19:00')], status: 'open' })
    const srcId = src.body.data.class.id
    await seedLedger(srcId, [line({ sessionIds: [src.body.data.class.sessions[0].id] })])
    const dup = await call(classes, 'POST', '/api/admin/classes/classes.json', { action: 'duplicate', id: srcId, sessions: [{ startIso: at('2031-03-13', '17:00'), endIso: at('2031-03-13', '19:00'), capacity: 8 }] })
    expect(dup.status).toBe(200)
    const copy = dup.body.data.class
    expect(copy.id).not.toBe(srcId)
    expect(copy.content).toEqual(src.body.data.class.content)
    expect(copy.sessions[0].startIso).toBe(at('2031-03-13', '17:00'))
    expect(copy.sessions[0].id).not.toBe(src.body.data.class.sessions[0].id)
    expect((await getLedger(copy.id)).lines).toEqual([])
    expect(copy.square.itemId).toBe(`item-${copy.id}`)
  })

  it('GET lists classes in a range with seats taken', async () => {
    const c = await call(classes, 'POST', '/api/admin/classes/classes.json', { action: 'create', content: content('Listed'), sessions: [ses('2031-03-20', '17:00', '19:00')], status: 'open' })
    const sid = c.body.data.class.sessions[0].id
    await seedLedger(c.body.data.class.id, [line({ sessionIds: [sid] })])
    const r = await call(classes, 'GET', `/api/admin/classes/classes.json?from=${encodeURIComponent(at('2031-03-20', '00:00'))}&to=${encodeURIComponent(at('2031-03-21', '00:00'))}`)
    expect(r.status).toBe(200)
    expect(r.body.data.classes.map((x: any) => x.id)).toEqual([c.body.data.class.id])
    expect(r.body.data.seatsTaken[sid]).toBe(1)
  })
})

describe('editing a class with bookings', () => {
  async function booked(day: string, name: string) {
    const c = await call(classes, 'POST', '/api/admin/classes/classes.json', {
      action: 'create', content: content(name, { passes: [{ id: 'all', label: 'Full', covers: { kind: 'all' } }, { id: 'one', label: 'One day', covers: { kind: 'choose', count: 1 } }], prices: { all: { person: 3000, kid: 2000 }, one: { person: 1800 } } }),
      sessions: [ses(day, '17:00', '19:00', 10), ses(day, '19:30', '20:30', 10)], status: 'open',
    })
    const cls = c.body.data.class
    await seedLedger(cls.id, [
      line({ bookingId: 'bkg_a', sessionIds: [cls.sessions[0].id, cls.sessions[1].id], seat: 1 }),
      line({ bookingId: 'bkg_a', sessionIds: [cls.sessions[0].id, cls.sessions[1].id], seat: 2, ticketTypeId: 'kid' }),
      line({ bookingId: 'bkg_a', sessionIds: [cls.sessions[0].id, cls.sessions[1].id], seat: 3 }),
      line({ bookingId: 'bkg_b', sessionIds: [cls.sessions[0].id], seat: 1, passId: 'one', customer: { givenName: 'Bo', familyName: 'Diddley', email: 'bo@example.com', phone: '4029802907' } }),
      line({ bookingId: 'bkg_c', sessionIds: [cls.sessions[1].id], passId: 'one', state: 'released' }),
    ])
    return cls
  }

  it('refuses capacity below seats taken, naming the session', async () => {
    const cls = await booked('2031-04-03', 'Cap Class')
    const r = await update({ id: cls.id, sessions: [{ ...cls.sessions[0], capacity: 3 }, cls.sessions[1]] })
    expect(r.status).toBe(409)
    expect(r.body.error).toMatch(/4 seats taken/)
    expect(r.body.error).toMatch(/Apr 3/)
    const ok = await update({ id: cls.id, sessions: [{ ...cls.sessions[0], capacity: 4 }, cls.sessions[1]] })
    expect(ok.status).toBe(200)
  })

  it('refuses removing a booked session, pass or price cell', async () => {
    const cls = await booked('2031-04-10', 'Remove Class')
    expect((await update({ id: cls.id, sessions: [cls.sessions[1]] })).status).toBe(409)
    const noPass = await update({ id: cls.id, content: { ...cls.content, passes: [cls.content.passes[0]], prices: { all: cls.content.prices.all } } })
    expect(noPass.status).toBe(409)
    expect(noPass.body.error).toMatch(/One day/)
    const noKid = await update({ id: cls.id, content: { ...cls.content, prices: { ...cls.content.prices, all: { person: 3000 } } } })
    expect(noKid.status).toBe(409)
    expect(noKid.body.error).toMatch(/Kid/)
  })

  it('allows a session with only released seats to go, and price changes keep paid prices', async () => {
    const cls = await booked('2031-04-17', 'Price Class')
    const r = await update({ id: cls.id, content: { ...cls.content, prices: { ...cls.content.prices, all: { person: 4000, kid: 2500 } } } })
    expect(r.status).toBe(200)
    expect(r.body.data.class.content.prices.all.person).toBe(4000)
    const ledger = await getLedger(cls.id)
    expect(ledger.lines.find((l) => l.bookingId === 'bkg_a')!.priceCents).toBe(3000)
  })

  it('moving booked sessions needs confirmMove and lists the people to tell', async () => {
    const cls = await booked('2031-04-24', 'Move Class')
    const moved = [{ ...cls.sessions[0], startIso: at('2031-04-25', '17:00'), endIso: at('2031-04-25', '19:00') }, cls.sessions[1]]
    const refused = await update({ id: cls.id, sessions: moved })
    expect(refused.status).toBe(409)
    expect(refused.body.peopleToTell).toHaveLength(2)
    expect((await getClass(cls.id))!.sessions[0].startIso).toBe(cls.sessions[0].startIso)
    const ok = await update({ id: cls.id, sessions: moved, confirmMove: true })
    expect(ok.status).toBe(200)
    expect(ok.body.data.class.sessions.some((s: any) => s.startIso === at('2031-04-25', '17:00'))).toBe(true)
    const people = ok.body.data.peopleToTell
    expect(people).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Ada Lovelace', email: 'ada@example.com', phone: '4029802907', sessions: [expect.stringMatching(/Apr 24/)] }),
      expect.objectContaining({ name: 'Bo Diddley' }),
    ]))
    expect(people).toHaveLength(2)
  })

  it('alsoUpdateLibrary appends a library version and points the class at it', async () => {
    const lib = await saveLibraryVersion({ content: content('Lib Sync'), by: { id: 'k', name: 'K' }, note: '' })
    const c = await call(classes, 'POST', '/api/admin/classes/classes.json', { action: 'create', libraryId: lib.id, sessions: [ses('2031-05-01', '17:00', '18:00')], status: 'open' })
    const cls = c.body.data.class
    const r = await update({ id: cls.id, content: { ...cls.content, description: 'New words.' }, alsoUpdateLibrary: true })
    expect(r.status).toBe(200)
    const after = await getLibrary(lib.id)
    expect(after!.versions).toHaveLength(2)
    expect(after!.versions[1].content.description).toBe('New words.')
    expect(after!.versions[1].note).toMatch(/^Updated while scheduling /)
    expect(r.body.data.class.libraryVersion).toBe(2)
  })

  it('alsoUpdateLibrary on a class added from scratch: it is already in the library, and the same details add no version', async () => {
    const c = await call(classes, 'POST', '/api/admin/classes/classes.json', { action: 'create', content: content('No Lib'), sessions: [ses('2031-05-08', '17:00', '18:00')], status: 'open' })
    const r = await update({ id: c.body.data.class.id, content: c.body.data.class.content, alsoUpdateLibrary: true })
    expect(r.body.data.class.libraryId).toMatch(/^lib_/)
    expect(r.body.data.class.libraryVersion).toBe(1)
    expect((await getLibrary(r.body.data.class.libraryId))!.versions).toHaveLength(1)
    expect(r.body.warning).toBeUndefined()
  })
})

describe('every new class lands in the library (R21)', () => {
  it('from scratch: the library has it at version 1, made by the owner, with the first date as its usual length and seats; the class points at it', async () => {
    const r = await call(classes, 'POST', '/api/admin/classes/classes.json', {
      action: 'create', content: content('Auto Macrame'), sessions: [ses('2031-11-06', '18:00', '20:30', 9)], status: 'open',
    })
    expect(r.status).toBe(200)
    const cls = r.body.data.class
    expect(cls.libraryId).toMatch(/^lib_/)
    expect(cls.libraryVersion).toBe(1)
    const lib = await getLibrary(cls.libraryId)
    expect(lib!.versions).toHaveLength(1)
    expect(lib!.versions[0]).toMatchObject({ version: 1, changed: [], by: { id: 'admin', name: 'Owner' } })
    expect(lib!.versions[0].content).toMatchObject({ name: 'Auto Macrame', defaultMinutes: 150, defaultCapacity: 9 })
    expect(lib!.versions[0].note).toMatch(/^Added with the class on /)
    expect((await getClass(cls.id))!.libraryId).toBe(cls.libraryId)
    const list = await call(library, 'GET', '/api/admin/classes/library.json')
    expect(list.body.data.library.find((l: any) => l.id === cls.libraryId).versions[0].version).toBe(1)
    expect(r.body.warning).toBeUndefined()
  })

  it('a refused class (a clash) adds nothing to the library', async () => {
    const day = '2031-11-13'
    await call(classes, 'POST', '/api/admin/classes/classes.json', { action: 'create', content: content('First In'), sessions: [ses(day, '17:00', '19:00')], status: 'open' })
    const before = (await call(library, 'GET', '/api/admin/classes/library.json')).body.data.library.length
    const r = await call(classes, 'POST', '/api/admin/classes/classes.json', { action: 'create', content: content('Clasher'), sessions: [ses(day, '18:00', '19:00')], status: 'open' })
    expect(r.status).toBe(409)
    expect((await call(library, 'GET', '/api/admin/classes/library.json')).body.data.library.length).toBe(before)
  })

  it('a library that can’t be written never loses the class: it is added, unlinked, and the reply says so', async () => {
    mocks.libraryDown = true
    const r = await call(classes, 'POST', '/api/admin/classes/classes.json', { action: 'create', content: content('No Library Today'), sessions: [ses('2031-11-20', '17:00', '18:00')], status: 'draft' })
      .finally(() => { mocks.libraryDown = false })
    expect(r.status).toBe(200)
    expect(r.body.data.class.libraryId).toBeNull()
    expect(r.body.warning).toBe("Added. It'll go into the library the next time you open or save it.")
  })

  it('from the library with changed details: "This class and the library" saves a new version first; without it the library stays', async () => {
    const lib = await saveLibraryVersion({ content: content('Lib Wreaths'), by: { id: 'k', name: 'K' }, note: '' })
    const plain = await call(classes, 'POST', '/api/admin/classes/classes.json', {
      action: 'create', libraryId: lib.id, content: content('Lib Wreaths', { description: 'Only here.' }), sessions: [ses('2031-12-04', '17:00', '18:00')], status: 'open',
    })
    expect(plain.body.data.class).toMatchObject({ libraryId: lib.id, libraryVersion: 1 })
    expect(plain.body.data.class.content.description).toBe('Only here.')
    expect((await getLibrary(lib.id))!.versions).toHaveLength(1)

    const both = await call(classes, 'POST', '/api/admin/classes/classes.json', {
      action: 'create', libraryId: lib.id, content: content('Lib Wreaths', { description: 'Everywhere.', prices: { all: { person: 3500, kid: 2000 } } }),
      sessions: [ses('2031-12-11', '17:00', '18:00')], status: 'open', alsoUpdateLibrary: true,
    })
    expect(both.body.data.class).toMatchObject({ libraryId: lib.id, libraryVersion: 2 })
    const after = await getLibrary(lib.id)
    expect(after!.versions[1].content.description).toBe('Everywhere.')
    expect(after!.versions[1].changed).toEqual(['Price', 'Description'])
  })

  it('library versions say what changed and who changed it (I4)', async () => {
    const saved = await call(library, 'POST', '/api/admin/classes/library.json', { action: 'save', content: content('Changes'), note: '' })
    const id = saved.body.data.library.id
    const req2 = new Request('https://x.test/api/admin/classes/library.json', {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie: cookie(), 'X-Admin-Who': 'Catherine' },
      body: JSON.stringify({ action: 'save', id, content: content('Changes', { description: 'New words.', imageUrl: 'https://x.test/p.jpg', defaultMinutes: 120 }), note: '' }),
    })
    const two = await (await library.POST({ request: req2, url: new URL(req2.url) } as any)).json()
    expect(two.data.library.versions[1]).toMatchObject({ by: { id: 'owner-catherine', name: 'Catherine' }, changed: ['Photo', 'Description', 'How long it usually runs'] })
    const back = await call(library, 'POST', '/api/admin/classes/library.json', { action: 'restore', id, version: 1 })
    expect(back.body.data.library.versions[2].changed).toEqual(['Photo', 'Description', 'How long it usually runs'])
  })

  it('the library GET says when each class last ran and its usual times', async () => {
    const lib = await saveLibraryVersion({ content: content('Runs Twice'), by: { id: 'k', name: 'K' }, note: '' })
    const past = await call(classes, 'POST', '/api/admin/classes/classes.json', { action: 'create', libraryId: lib.id, sessions: [ses('2031-12-18', '17:00', '19:00')], status: 'open' })
    const future = await call(classes, 'POST', '/api/admin/classes/classes.json', { action: 'create', libraryId: lib.id, sessions: [ses('2032-01-08', '18:00', '20:00')], status: 'open' })
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(at('2031-12-25', '12:00')))
    try {
      const r = await call(library, 'GET', '/api/admin/classes/library.json')
      expect(r.body.data.runs[lib.id]).toEqual({
        lastIso: past.body.data.class.sessions[0].startIso, nextIso: future.body.data.class.sessions[0].startIso,
        startIso: future.body.data.class.sessions[0].startIso, endIso: future.body.data.class.sessions[0].endIso,
      })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('cancel', () => {
  it('cancels, takes the POS item off, lists everyone booked and never refunds', async () => {
    const c = await call(classes, 'POST', '/api/admin/classes/classes.json', { action: 'create', content: content('Cancel Me'), sessions: [ses('2031-06-05', '17:00', '19:00')], status: 'open' })
    const cls = c.body.data.class
    const lines = [
      line({ bookingId: 'bkg_x', sessionIds: [cls.sessions[0].id], seat: 1, square: { orderId: 'o', paymentId: 'p', lineUid: null, chargedCents: 6540 } }),
      line({ bookingId: 'bkg_x', sessionIds: [cls.sessions[0].id], seat: 2, square: { orderId: 'o', paymentId: 'p', lineUid: null, chargedCents: 6540 } }),
      line({ bookingId: 'bkg_y', sessionIds: [cls.sessions[0].id], customer: { givenName: 'Bo', familyName: 'D', email: 'bo@example.com', phone: '1' } }),
      line({ bookingId: 'bkg_z', sessionIds: [cls.sessions[0].id], state: 'released' }),
    ]
    await seedLedger(cls.id, lines)
    const r = await cancel(cls.id)
    expect(r.status).toBe(200)
    expect(r.body.data.class.status).toBe('cancelled')
    expect(mocks.archive).toHaveBeenCalledTimes(1)
    expect(r.body.data.booked).toEqual([
      { bookingId: 'bkg_x', name: 'Ada Lovelace', email: 'ada@example.com', phone: '4029802907', seats: 2, paidCents: 6540 },
      { bookingId: 'bkg_y', name: 'Bo D', email: 'bo@example.com', phone: '1', seats: 1, paidCents: 3270 },
    ])
    expect((await getLedger(cls.id)).lines).toEqual(lines)
    expect(mocks.squareFetch).not.toHaveBeenCalled()
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'class-cancel' }))
  })
})

describe('bookings', () => {
  it('groups ledger lines by booking', async () => {
    const c = await call(classes, 'POST', '/api/admin/classes/classes.json', { action: 'create', content: content('Grouped'), sessions: [ses('2031-06-12', '17:00', '19:00')], status: 'open' })
    const cls = c.body.data.class
    const sid = cls.sessions[0].id
    await seedLedger(cls.id, [
      line({ bookingId: 'bkg_g', sessionIds: [sid], seat: 1, answers: { q1: 'Blue' }, addOns: { add_1: 1 }, addOnCents: 500, addOnTaxCents: 45 }),
      line({ bookingId: 'bkg_g', sessionIds: [sid], seat: 2, ticketTypeId: 'kid', priceCents: 2000, taxCents: 180, overCapacity: true,
        state: 'refunded', refunds: [{ at: 'x', cents: 2180, reason: 'sick', by: { id: 'k', name: 'K' }, freedSeat: true, squareRefundId: 'r1' }] }),
      line({ bookingId: 'bkg_r', sessionIds: [sid], state: 'released' }),
    ])
    const r = await call(bookings, 'GET', `/api/admin/classes/bookings.json?id=${cls.id}`)
    expect(r.status).toBe(200)
    expect(r.body.data.bookings).toHaveLength(1)
    const b = r.body.data.bookings[0]
    expect(b).toMatchObject({
      bookingId: 'bkg_g', source: 'online', seats: { person: 1, kid: 1 }, sessionIds: [sid],
      addOns: { add_1: 1 }, paidCents: 3270 + 545 + 2180, refundedCents: 2180, overCapacity: true,
      customer: { givenName: 'Ada' },
    })
    expect(b.picks).toEqual([{ seat: 1, ticketTypeId: 'person', answers: { q1: 'Blue' } }, { seat: 2, ticketTypeId: 'kid', answers: {} }])
    expect(b.state).toBe('part refunded')
    expect(b.waiting).toBeNull()
    expect(r.body.data.seatsTaken).toEqual({ [sid]: 1 })
    expect((await call(bookings, 'GET', '/api/admin/classes/bookings.json?id=cls_nope')).status).toBe(404)
  })

  it('the class list carries each class’s bookings, seats and money taken less refunds', async () => {
    const c = await call(classes, 'POST', '/api/admin/classes/classes.json', { action: 'create', content: content('Totals'), sessions: [ses('2031-06-19', '17:00', '19:00')], status: 'open' })
    const cls = c.body.data.class
    const sid = cls.sessions[0].id
    await seedLedger(cls.id, [
      line({ bookingId: 'bkg_t1', sessionIds: [sid], seat: 1 }),
      line({ bookingId: 'bkg_t1', sessionIds: [sid], seat: 2 }),
      line({ bookingId: 'bkg_t2', sessionIds: [sid], state: 'refunded', refunds: [{ at: 'x', cents: 3270, reason: '', by: { id: 'k', name: 'K' }, freedSeat: true, squareRefundId: 'r1' }] }),
      line({ bookingId: 'bkg_t3', sessionIds: [sid], state: 'held', holdExpiresAt: new Date(Date.now() + 600_000).toISOString() }),
    ])
    const r = await call(classes, 'GET', '/api/admin/classes/classes.json')
    expect(r.body.data.totals[cls.id]).toEqual({ bookings: 2, seats: 2, cents: 6540 })
  })
})

describe('blocked time', () => {
  it('adds, lists and removes', async () => {
    const add = await call(blocked, 'POST', '/api/admin/classes/blocked.json', { action: 'add', startIso: at('2031-07-01', '09:00'), endIso: at('2031-07-01', '12:00'), reason: 'Inventory' })
    expect(add.status).toBe(200)
    const id = add.body.data.blocked.id
    const list = await call(blocked, 'GET', `/api/admin/classes/blocked.json?from=${encodeURIComponent(at('2031-07-01', '00:00'))}&to=${encodeURIComponent(at('2031-07-02', '00:00'))}`)
    expect(list.body.data.blocked.map((b: any) => b.id)).toEqual([id])
    const bad = await call(blocked, 'POST', '/api/admin/classes/blocked.json', { action: 'add', startIso: at('2031-07-01', '12:00'), endIso: at('2031-07-01', '09:00'), reason: '' })
    expect(bad.status).toBe(400)
    expect((await call(blocked, 'POST', '/api/admin/classes/blocked.json', { action: 'remove', id })).status).toBe(200)
    const after = await call(blocked, 'GET', `/api/admin/classes/blocked.json?from=${encodeURIComponent(at('2031-07-01', '00:00'))}&to=${encodeURIComponent(at('2031-07-02', '00:00'))}`)
    expect(after.body.data.blocked).toEqual([])
  })
})

describe('photo', () => {
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
  const upload = (bytes: Buffer, type: string, signedIn = true) => {
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(bytes)], { type }), 'photo')
    const request = new Request('https://x.test/api/admin/classes/photo.json', { method: 'POST', body: form, headers: signedIn ? { cookie: cookie() } : {} })
    return photo.POST({ request, url: new URL(request.url) } as any)
  }
  it('stores an image and serves it back at a stable URL', async () => {
    const res = await upload(PNG, 'image/png')
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.url).toMatch(/^https:\/\/x\.test\/api\/admin\/classes\/photo\.json\?id=/)
    const u = new URL(data.url)
    const got = await photo.GET({ request: new Request(data.url), url: u } as any)
    expect(got.status).toBe(200)
    expect(got.headers.get('content-type')).toBe('image/png')
    expect(got.headers.get('x-content-type-options')).toBe('nosniff')
    expect(Buffer.from(await got.arrayBuffer())).toEqual(PNG)
  })
  it('refuses other types and anything over 4 MB', async () => {
    expect((await upload(Buffer.from('GIF89a....'), 'image/gif')).status).toBe(400)
    const big = Buffer.alloc(4 * 1024 * 1024 + 1); PNG.copy(big)
    const tooBig = await upload(big, 'image/png')
    expect(tooBig.status).toBe(400)
    expect((await tooBig.json()).error).toBe('The photo is too large. It can be up to 4 MB.')
    expect((await upload(PNG, 'image/png', false)).status).toBe(401)
  })
})

describe('a live hold protects what it is buying', () => {
  it('a session with an unexpired hold cannot be removed', async () => {
    const c = await call(classes, 'POST', '/api/admin/classes/classes.json', { action: 'create', content: content('Held Class'), sessions: [ses('2031-08-07', '17:00', '18:00'), ses('2031-08-07', '18:30', '19:30')], status: 'open' })
    const cls = c.body.data.class
    await seedLedger(cls.id, [line({ bookingId: 'bkg_h', sessionIds: [cls.sessions[0].id], state: 'held', holdExpiresAt: new Date(Date.now() + 600_000).toISOString() })])
    const r = await update({ id: cls.id, sessions: [cls.sessions[1]] })
    expect(r.status).toBe(409)
  })
})

describe('fix round 1', () => {
  it('update and cancel need the copy the form loaded; an older copy is refused', async () => {
    const c = await call(classes, 'POST', '/api/admin/classes/classes.json', { action: 'create', content: content('Two Owners'), sessions: [ses('2031-09-04', '17:00', '18:00')], status: 'open' })
    const loaded = c.body.data.class
    const missing = await call(classes, 'POST', '/api/admin/classes/classes.json', { action: 'update', id: loaded.id, status: 'closed' })
    expect(missing.status).toBe(400)
    const first = await call(classes, 'POST', '/api/admin/classes/classes.json', { action: 'update', id: loaded.id, expectedUpdatedAt: loaded.updatedAt, content: { ...loaded.content, description: 'Kaden wrote this.' } })
    expect(first.status).toBe(200)
    const stale = await call(classes, 'POST', '/api/admin/classes/classes.json', { action: 'update', id: loaded.id, expectedUpdatedAt: loaded.updatedAt, content: { ...loaded.content, description: 'Catherine wrote this.' } })
    expect(stale.status).toBe(409)
    expect(stale.body.error).toBe('Someone else changed this class. Reload to see their changes.')
    expect(stale.body.stale).toBe(true)
    expect((await getClass(loaded.id))!.content.description).toBe('Kaden wrote this.')
    const staleCancel = await call(classes, 'POST', '/api/admin/classes/classes.json', { action: 'cancel', id: loaded.id, expectedUpdatedAt: loaded.updatedAt })
    expect(staleCancel.status).toBe(409)
    expect(staleCancel.body.stale).toBe(true)
    expect((await getClass(loaded.id))!.status).toBe('open')
  })

  it('moving a session someone is paying for right now needs confirmMove and names them', async () => {
    const c = await call(classes, 'POST', '/api/admin/classes/classes.json', { action: 'create', content: content('Held Move'), sessions: [ses('2031-09-11', '17:00', '18:00')], status: 'open' })
    const cls = c.body.data.class
    await seedLedger(cls.id, [line({ bookingId: 'bkg_hm', sessionIds: [cls.sessions[0].id], state: 'held', holdExpiresAt: new Date(Date.now() + 600_000).toISOString(),
      customer: { givenName: 'Hal', familyName: 'Held', email: 'hal@example.com', phone: '4029802907' } })])
    const moved = [{ ...cls.sessions[0], startIso: at('2031-09-11', '19:00'), endIso: at('2031-09-11', '20:00') }]
    const r = await update({ id: cls.id, sessions: moved })
    expect(r.status).toBe(409)
    expect(r.body.peopleToTell).toEqual([expect.objectContaining({ name: 'Hal Held', email: 'hal@example.com' })])
  })

  it('a library failure after the class saved keeps the class and warns', async () => {
    const lib = await saveLibraryVersion({ content: content('Lib Gone'), by: { id: 'k', name: 'K' }, note: '' })
    const c = await call(classes, 'POST', '/api/admin/classes/classes.json', { action: 'create', libraryId: lib.id, sessions: [ses('2031-09-18', '17:00', '18:00')], status: 'open' })
    const cls = c.body.data.class
    mocks.libraryDown = true
    const r = await update({ id: cls.id, content: { ...cls.content, description: 'Changed.' }, alsoUpdateLibrary: true }).finally(() => { mocks.libraryDown = false })
    expect(r.status).toBe(200)
    expect(r.body.warning).toBe("Saved. The library didn't update. Try again.")
    expect(r.body.data.class.content.description).toBe('Changed.')
    expect((await getClass(cls.id))!.content.description).toBe('Changed.')
  })
})

describe('blocked time over something booked', () => {
  const range = (d: string) => `?from=${encodeURIComponent(at(d, '00:00'))}&to=${encodeURIComponent(at(d, '23:59'))}`
  it('refuses a block over a class session unless confirmed, then saves and lists the clashes', async () => {
    const day = '2031-10-02'
    await call(classes, 'POST', '/api/admin/classes/classes.json', { action: 'create', content: content('Under The Block'), sessions: [ses(day, '17:00', '19:00')], status: 'open' })
    const body = { action: 'add', startIso: at(day, '18:00'), endIso: at(day, '20:00'), reason: 'Plumber' }
    const refused = await call(blocked, 'POST', '/api/admin/classes/blocked.json', body)
    expect(refused.status).toBe(409)
    expect(refused.body.error).toMatch(/^Clashes with Under The Block, /)
    expect((await call(blocked, 'GET', `/api/admin/classes/blocked.json${range(day)}`)).body.data.blocked).toEqual([])
    const ok = await call(blocked, 'POST', '/api/admin/classes/blocked.json', { ...body, confirm: true })
    expect(ok.status).toBe(200)
    expect(ok.body.data.blocked.reason).toBe('Plumber')
    expect(ok.body.data.clashes).toEqual([expect.objectContaining({ kind: 'class', label: 'Under The Block' })])
  })
  it('refuses a block over a party', async () => {
    const day = '2031-10-04'
    mocks.listBookings.mockResolvedValue([{ id: 'bk_p', status: 'accepted', slot: { startAt: at(day, '13:00'), duration: 120 } }])
    const r = await call(blocked, 'POST', '/api/admin/classes/blocked.json', { action: 'add', startIso: at(day, '14:00'), endIso: at(day, '16:00'), reason: '' })
    expect(r.status).toBe(409)
    expect(r.body.error).toMatch(/^Clashes with /)
  })
  it('a block over nothing saves with no clashes', async () => {
    const day = '2031-10-09'
    const r = await call(blocked, 'POST', '/api/admin/classes/blocked.json', { action: 'add', startIso: at(day, '06:00'), endIso: at(day, '07:00'), reason: 'Early' })
    expect(r.status).toBe(200)
    expect(r.body.data.clashes).toEqual([])
  })
})

describe('who made the change (X-Admin-Who)', () => {
  const callAs = async (route: any, url: string, body: unknown, who?: string) => {
    const request = new Request(`https://x.test${url}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: cookie(), ...(who !== undefined ? { 'X-Admin-Who': who } : {}) },
      body: JSON.stringify(body),
    })
    const res: Response = await route.POST({ request, url: new URL(request.url) } as any)
    return { status: res.status, body: await res.json() }
  }

  it('a library version records the owner named in the header', async () => {
    const saved = await callAs(library, '/api/admin/classes/library.json', { action: 'save', content: content('Who Candles'), note: '' }, 'Catherine')
    expect(saved.status).toBe(200)
    expect(saved.body.data.library.versions[0].by).toEqual({ id: 'owner-catherine', name: 'Catherine' })
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'class-library-save', by: { id: 'owner-catherine', name: 'Catherine', role: 'owner' } }))
  })

  it('blocked time and a new class record the owner; any case is fine', async () => {
    const add = await callAs(blocked, '/api/admin/classes/blocked.json', { action: 'add', startIso: at('2031-08-01', '09:00'), endIso: at('2031-08-01', '10:00'), reason: 'Who' }, 'kaden')
    expect(add.body.data.blocked.by).toEqual({ id: 'owner-kaden', name: 'Kaden' })
    const made = await callAs(classes, '/api/admin/classes/classes.json', { action: 'create', content: content('Who Pottery'), sessions: [ses('2031-03-19', '10:00', '11:30')], status: 'draft' }, 'Kaden')
    expect(made.status).toBe(200)
    expect((await getClass(made.body.data.class.id))?.by).toEqual({ id: 'owner-kaden', name: 'Kaden' })
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'class-create', by: { id: 'owner-kaden', name: 'Kaden', role: 'owner' } }))
  })

  it('a name off the owner list, or none, is recorded as Owner', async () => {
    const odd = await callAs(blocked, '/api/admin/classes/blocked.json', { action: 'add', startIso: at('2031-08-03', '09:00'), endIso: at('2031-08-03', '10:00'), reason: '' }, 'Mallory')
    expect(odd.body.data.blocked.by).toEqual({ id: 'admin', name: 'Owner' })
    const none = await callAs(blocked, '/api/admin/classes/blocked.json', { action: 'add', startIso: at('2031-08-04', '09:00'), endIso: at('2031-08-04', '10:00'), reason: '' })
    expect(none.body.data.blocked.by).toEqual({ id: 'admin', name: 'Owner' })
  })
})

describe('fix round 1: a retried Add never makes a second class or library entry (R35)', () => {
  const libCount = async () => (await call(library, 'GET', '/api/admin/classes/library.json?archived=1')).body.data.library.length
  const create = (key: string, body: any = {}) => call(classes, 'POST', '/api/admin/classes/classes.json', {
    action: 'create', content: content('Keyed Class'), sessions: [ses('2032-02-05', '17:00', '19:00')], status: 'open', createKey: key, ...body,
  })

  it('the same createKey twice (a lost reply): the second answers with the class the first made; one class, one library entry, one POS item', async () => {
    const before = await libCount()
    const one = await create('key-lost-reply-1')
    expect(one.status).toBe(200)
    const again = await create('key-lost-reply-1')
    expect(again.status).toBe(200)
    expect(again.body.data.class.id).toBe(one.body.data.class.id)
    expect(again.body.data.replay).toBe(true)
    expect(await libCount()).toBe(before + 1)
    expect(mocks.sync).toHaveBeenCalledTimes(1)
    const all = (await call(classes, 'GET', '/api/admin/classes/classes.json')).body.data.classes.filter((c: any) => c.content.name === 'Keyed Class')
    expect(all).toHaveLength(1)
  })

  it('the class write failed after the library entry was made: the retry uses that same entry, never a second', async () => {
    const before = await libCount()
    mocks.classDown = 1
    const first = await create('key-half-failure', { content: content('Half Failure'), sessions: [ses('2032-02-12', '17:00', '19:00')] })
    expect(first.status).toBe(503)
    expect(await libCount()).toBe(before + 1)
    const retry = await create('key-half-failure', { content: content('Half Failure'), sessions: [ses('2032-02-12', '17:00', '19:00')] })
    expect(retry.status).toBe(200)
    expect(await libCount()).toBe(before + 1)
    const lib = await getLibrary(retry.body.data.class.libraryId)
    expect(lib!.versions).toHaveLength(1)
  })

  it('a replay finishes what the first try didn’t: the POS item when Square failed, the library link when the library was down', async () => {
    mocks.sync.mockRejectedValueOnce(new Error('Square down'))
    mocks.libraryDown = true
    const first = await create('key-finish-up', { content: content('Finish Up'), sessions: [ses('2032-02-19', '17:00', '19:00')] }).finally(() => { mocks.libraryDown = false })
    expect(first.body.data.class.libraryId).toBeNull()
    expect(first.body.data.class.square.itemId).toBeNull()
    const again = await create('key-finish-up', { content: content('Finish Up'), sessions: [ses('2032-02-19', '17:00', '19:00')] })
    expect(again.body.data.class.id).toBe(first.body.data.class.id)
    expect(again.body.data.class.libraryId).toMatch(/^lib_/)
    expect(again.body.data.class.square.itemId).toBe(`item-${first.body.data.class.id}`)
  })

  it('duplicate takes a createKey the same way; a bad key is refused before anything is written', async () => {
    const src = await create('key-dup-source', { content: content('Dup Source'), sessions: [ses('2032-03-04', '17:00', '19:00')] })
    const dup = (key: string) => call(classes, 'POST', '/api/admin/classes/classes.json', { action: 'duplicate', id: src.body.data.class.id, sessions: [ses('2032-03-11', '17:00', '19:00')], createKey: key })
    const a = await dup('key-dup-copy')
    const b = await dup('key-dup-copy')
    expect(b.body.data.class.id).toBe(a.body.data.class.id)
    expect((await dup('bad key!')).status).toBe(400)
  })
})

describe('fix round 1: an unlinked class goes into the library (R36)', () => {
  it('library down on create, then any save of the class links it at version 1 and says so', async () => {
    mocks.libraryDown = true
    const c = await call(classes, 'POST', '/api/admin/classes/classes.json', { action: 'create', content: content('Heal On Save'), sessions: [ses('2032-04-01', '17:00', '19:00')], status: 'draft' })
      .finally(() => { mocks.libraryDown = false })
    expect(c.body.warning).toBe("Added. It'll go into the library the next time you open or save it.")
    const r = await update({ id: c.body.data.class.id, status: 'draft' })
    expect(r.status).toBe(200)
    expect(r.body.data.libraryAdded).toBe(true)
    expect(r.body.data.class.libraryVersion).toBe(1)
    expect((await getLibrary(r.body.data.class.libraryId))!.versions[0].content.name).toBe('Heal On Save')
  })

  it('a class from before R21 is linked quietly when its sheet opens (link-library); twice at once makes one entry', async () => {
    const kv = makeKvStore('classes', 'classes')
    const old = { ...(await (async () => {
      const c = await call(classes, 'POST', '/api/admin/classes/classes.json', { action: 'create', content: content('Pre R21'), sessions: [ses('2032-04-08', '17:00', '19:00')], status: 'draft' })
      return c.body.data.class
    })()), libraryId: null, libraryVersion: null }
    await kv.set(`class-${old.id}`, JSON.stringify(old))
    const [a, b] = await Promise.all([
      call(classes, 'POST', '/api/admin/classes/classes.json', { action: 'link-library', id: old.id }),
      call(classes, 'POST', '/api/admin/classes/classes.json', { action: 'link-library', id: old.id }),
    ])
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    expect(a.body.data.class.libraryId).toBe(b.body.data.class.libraryId)
    expect((await getLibrary(a.body.data.class.libraryId))!.versions).toHaveLength(1)
    const again = await call(classes, 'POST', '/api/admin/classes/classes.json', { action: 'link-library', id: old.id })
    expect(again.body.data.libraryAdded).toBe(false)
  })

  it('"This class and the library" with details the library already has points the class at the latest version', async () => {
    const lib = await saveLibraryVersion({ content: content('Bump Me'), by: { id: 'k', name: 'K' }, note: '' })
    const c = await call(classes, 'POST', '/api/admin/classes/classes.json', { action: 'create', libraryId: lib.id, sessions: [ses('2032-04-15', '17:00', '19:00')], status: 'draft' })
    await saveLibraryVersion({ id: lib.id, content: content('Bump Me', { description: 'Newer.' }), by: { id: 'k', name: 'K' }, note: '' })
    const r = await update({ id: c.body.data.class.id, content: content('Bump Me', { description: 'Newer.' }), alsoUpdateLibrary: true })
    expect(r.body.data.class.libraryVersion).toBe(2)
    expect((await getLibrary(lib.id))!.versions).toHaveLength(2)
  })
})

describe('fix round 1: money', () => {
  it('Past totals leave out a counter seat nobody has rung up yet, and comps', async () => {
    const c = await call(classes, 'POST', '/api/admin/classes/classes.json', { action: 'create', content: content('Money'), sessions: [ses('2032-05-06', '17:00', '19:00')], status: 'open' })
    const sid = c.body.data.class.sessions[0].id
    await seedLedger(c.body.data.class.id, [
      line({ bookingId: 'bkg_m1', sessionIds: [sid] }),
      line({ bookingId: 'bkg_m2', sessionIds: [sid], source: 'door-counter', square: { orderId: null, paymentId: null, lineUid: null } }),
      line({ bookingId: 'bkg_m3', sessionIds: [sid], source: 'comp', priceCents: 0, taxCents: 0, square: { orderId: null, paymentId: null, lineUid: null } }),
    ])
    const r = await call(classes, 'GET', '/api/admin/classes/classes.json')
    expect(r.body.data.totals[c.body.data.class.id]).toEqual({ bookings: 3, seats: 3, cents: 3270 })
  })

  it('the usual time comes from a class on the website, not a draft at an odd time; a draft never counts as "last ran"', async () => {
    const lib = await saveLibraryVersion({ content: content('Usual Time'), by: { id: 'k', name: 'K' }, note: '' })
    const real = await call(classes, 'POST', '/api/admin/classes/classes.json', { action: 'create', libraryId: lib.id, sessions: [ses('2032-06-03', '18:00', '20:00')], status: 'open' })
    await call(classes, 'POST', '/api/admin/classes/classes.json', { action: 'create', libraryId: lib.id, sessions: [ses('2032-06-24', '07:00', '08:00')], status: 'draft' })
    const r = await call(library, 'GET', '/api/admin/classes/library.json')
    expect(r.body.data.runs[lib.id].startIso).toBe(real.body.data.class.sessions[0].startIso)
  })

  it('a library save from a form opened on an older version is refused as stale, nothing written', async () => {
    const lib = await saveLibraryVersion({ content: content('Two Owners'), by: { id: 'k', name: 'K' }, note: '' })
    await saveLibraryVersion({ id: lib.id, content: content('Two Owners', { description: 'Kaden was here.' }), by: { id: 'k', name: 'K' }, note: '' })
    const r = await call(library, 'POST', '/api/admin/classes/library.json', { action: 'save', id: lib.id, expectedVersion: 1, content: content('Two Owners', { description: 'Catherine too.' }), note: '' })
    expect(r.status).toBe(409)
    expect(r.body).toMatchObject({ stale: true, error: 'Someone else changed this library class. Your edits are kept; check them and save again.' })
    expect((await getLibrary(lib.id))!.versions).toHaveLength(2)
  })
})

