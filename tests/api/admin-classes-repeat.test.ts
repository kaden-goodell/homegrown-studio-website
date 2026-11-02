// @vitest-environment node
/** Stage 4 Task 7: repeat a class every week, every 2 weeks or on picked dates. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  sync: vi.fn(),
  audit: vi.fn(),
  libraryDown: false,
  /** The Nth createClass call from now fails (the blob store dropped). 0 = none. */
  failCreateAt: 0,
  creates: 0,
  closures: [] as { from: string; to: string; name: string }[],
}))
vi.mock('@lib/classes/class-store', async (importOriginal) => {
  const real = await importOriginal<typeof import('@lib/classes/class-store')>()
  return {
    ...real,
    createClass: (...a: Parameters<typeof real.createClass>) => {
      mocks.creates++
      if (mocks.failCreateAt && mocks.creates === mocks.failCreateAt) return Promise.reject(new Error('Blob store "classes" is unavailable'))
      return real.createClass(...a)
    },
  }
})
vi.mock('@config/providers', () => ({
  providers: {
    booking: { listBookings: vi.fn(async () => []) },
    workshop: { listAllWorkshops: vi.fn(async () => []), listWorkshops: vi.fn(async () => []) },
  },
}))
vi.mock('@lib/party-store', () => ({ getPartyRecord: vi.fn(async () => null) }))
vi.mock('@lib/classes/square-catalog', () => ({ syncClassToSquare: mocks.sync, archiveClassInSquare: vi.fn(), CLASS_TAX_NOT_SET: "Class tax isn't set up yet." }))
vi.mock('@lib/classes/square-api', () => ({ squareFetch: vi.fn(async () => { throw new Error('no live Square in tests') }), squareSettings: () => ({ environment: 'sandbox' }) }))
vi.mock('@lib/audit', () => ({ recordAudit: mocks.audit }))
vi.mock('@lib/studio-settings', async (importOriginal) => {
  const real = await importOriginal<typeof import('@lib/studio-settings')>()
  const { CONFIG_STUDIO_DAYS } = await import('@config/studio-days')
  return { ...real, getStudioDays: async () => ({ ...CONFIG_STUDIO_DAYS, closures: [...CONFIG_STUDIO_DAYS.closures, ...mocks.closures] }) }
})
vi.mock('@lib/classes/library-store', async (importOriginal) => {
  const real = await importOriginal<typeof import('@lib/classes/library-store')>()
  return {
    ...real,
    saveLibraryVersion: (...a: Parameters<typeof real.saveLibraryVersion>) =>
      mocks.libraryDown ? Promise.reject(new Error('Blob store "class-library" is unavailable')) : real.saveLibraryVersion(...a),
  }
})

import * as classes from '@pages/api/admin/classes/classes.json'
import * as blocked from '@pages/api/admin/classes/blocked.json'
import { adminCookie } from '@lib/admin-auth'
import { getClass, listClasses } from '@lib/classes/class-store'
import { getLibrary, listLibrary } from '@lib/classes/library-store'
import { repeatLimits } from '@lib/classes/admin-actions'
import { listedPublicly, toPublicClass } from '@lib/classes/public-view'
import { chicagoToIso } from '@lib/classes/repeat'
import type { ClassContent } from '@lib/classes/types'

const URL_ = '/api/admin/classes/classes.json'
const post = async (route: any, body: unknown, url = URL_) => {
  const request = new Request(`https://x.test${url}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie().split(';')[0] }, body: JSON.stringify(body),
  })
  const res: Response = await route.POST({ request, url: new URL(request.url) } as any)
  return { status: res.status, body: await res.json() }
}
function content(name: string, over: Partial<ClassContent> = {}): ClassContent {
  return {
    name, description: 'Make a thing.', imageUrl: null, instructor: null,
    rules: { ages: '', dropOff: false, madeToOrder: false, taxable: true, maxPerBooking: 10, signupCutoffHours: null, minimumToRun: null, linkOnly: false, joinPartway: true, waitlistCutoffHours: 2, canShareRoom: false },
    ticketTypes: [{ id: 'person', label: 'Person' }],
    passes: [{ id: 'all', label: 'Full', covers: { kind: 'all' } }],
    prices: { all: { person: 3000 } }, questions: [], addOns: [], defaultCapacity: 12, defaultMinutes: 120,
    ...over,
  }
}
let n = 0
const ses = (ymd: string, h: number, len = 120) => {
  const startIso = chicagoToIso(ymd, h, 0)
  return { id: `ses_r${++n}`, startIso, endIso: new Date(Date.parse(startIso) + len * 60_000).toISOString(), capacity: 12 }
}
const clock = (iso: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(iso))

beforeEach(() => {
  vi.stubEnv('ADMIN_PASSCODE', 'owner-secret')
  mocks.sync.mockReset().mockImplementation(async (c: any) => ({ itemId: `item-${c.id}`, variations: { 'all:person': 'v1' }, imageUrl: null }))
  mocks.audit.mockReset().mockResolvedValue(undefined)
  mocks.libraryDown = false
  mocks.failCreateAt = 0
  mocks.creates = 0
  mocks.closures = []
  repeatLimits.budgetMs = 6_000
  repeatLimits.hardMs = 6_000
})
afterEach(() => vi.unstubAllEnvs())

describe('repeat-preview', () => {
  it('lists each date with ✓, a closed day, a clash and a passed date; writes nothing', async () => {
    mocks.closures = [{ from: '2033-11-24', to: '2033-11-25', name: 'Thanksgiving' }]
    const block = await post(blocked, { action: 'add', startIso: chicagoToIso('2033-12-01', 17, 0), endIso: chicagoToIso('2033-12-01', 21, 0), reason: 'Rivera party' }, '/api/admin/classes/blocked.json')
    expect(block.status).toBe(200)
    const before = (await listClasses()).length
    const r = await post(classes, {
      action: 'repeat-preview', content: content('Preview Looms'), sessions: [ses('2033-11-17', 18)], pattern: { every: 1, untilYmd: '2033-12-08' },
    })
    expect(r.status).toBe(200)
    expect(r.body.data.dates).toEqual([
      { ymd: '2033-11-17', ok: true, reason: null },
      { ymd: '2033-11-24', ok: false, reason: 'Closed for Thanksgiving.' },
      { ymd: '2033-12-01', ok: false, reason: 'Clashes with Rivera party, Thu Dec 1 5 PM.' },
      { ymd: '2033-12-08', ok: true, reason: null },
    ])
    expect((await listClasses()).length).toBe(before)

    const past = await post(classes, { action: 'repeat-preview', content: content('Past Looms'), sessions: [ses('2033-01-06', 18)], pattern: { dates: ['2020-01-02'] } })
    expect(past.body.data.dates[0]).toEqual({ ymd: '2020-01-02', ok: false, reason: 'That date has passed.' })
  })

  it('refuses a bad pattern in plain words', async () => {
    const r = await post(classes, { action: 'repeat-preview', content: content('X'), sessions: [ses('2033-02-03', 18)], pattern: { every: 1, untilYmd: '2033-02-01' } })
    expect(r.status).toBe(400)
    expect(r.body).toMatchObject({ error: 'Pick an until date after the first date.', field: 'repeat' })
    const many = await post(classes, { action: 'repeat-preview', content: content('X'), sessions: [ses('2033-02-03', 18)], pattern: { every: 1, untilYmd: '2034-02-03' } })
    expect(many.body.error).toBe('Repeat up to 26 dates at a time.')
  })
})

describe('repeat', () => {
  it('across the clock change: weekly Thursdays at 6 PM become separate classes, each 6 PM Chicago, each on the POS, one library entry', async () => {
    const libsBefore = (await listLibrary()).length
    const r = await post(classes, {
      action: 'repeat', content: content('Weekly Looms'), sessions: [ses('2032-10-21', 18)], status: 'open',
      pattern: { every: 1, untilYmd: '2032-11-11' }, skip: [], createKey: 'repeat-key-dst-1',
    })
    expect(r.status).toBe(200)
    const made = r.body.data.created
    expect(made.map((c: any) => c.ymd)).toEqual(['2032-10-21', '2032-10-28', '2032-11-04', '2032-11-11'])
    expect(r.body.data.skipped).toEqual([])
    expect(r.body.data.left).toEqual([])
    const ids = new Set(made.map((c: any) => c.class.id))
    expect(ids.size).toBe(4)
    for (const c of made) {
      const cls = (await getClass(c.class.id))!
      expect(clock(cls.sessions[0].startIso)).toMatch(/^Thu, .* 6:00 PM$/)
      expect(cls.square.itemId).toBe(`item-${cls.id}`)
      expect(cls.libraryId).toBe(made[0].class.libraryId)
      // Customer side: each date is its own listed class at the right time.
      expect(listedPublicly(cls)).toBe(true)
      const pub = toPublicClass(cls, { classId: cls.id, lines: [] } as any, new Date())
      expect(JSON.stringify(pub)).toContain(cls.sessions[0].startIso)
    }
    // Clock went back Nov 7 2032: UTC hour moves, Chicago doesn't.
    expect(made[2].class.sessions[0].startIso).toBe('2032-11-04T23:00:00.000Z')
    expect(made[3].class.sessions[0].startIso).toBe('2032-11-12T00:00:00.000Z')
    // Session ids are new and different per class.
    const sesIds = made.map((c: any) => c.class.sessions[0].id)
    expect(new Set(sesIds).size).toBe(4)
    expect(mocks.sync).toHaveBeenCalledTimes(4)
    expect((await listLibrary()).length).toBe(libsBefore + 1)
    expect((await getLibrary(made[0].class.libraryId))!.versions).toHaveLength(1)
  })

  it('retry once: the same repeat sent twice answers with the same classes; one POS sync each, no second library entry', async () => {
    const body = { action: 'repeat', content: content('Retry Looms'), sessions: [ses('2032-12-02', 18)], status: 'open', pattern: { every: 2, untilYmd: '2032-12-30' }, skip: [], createKey: 'repeat-key-retry-1' }
    const libsBefore = (await listLibrary()).length
    const a = await post(classes, body)
    const b = await post(classes, body)
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    expect(b.body.data.created.map((c: any) => c.class.id)).toEqual(a.body.data.created.map((c: any) => c.class.id))
    expect(a.body.data.created).toHaveLength(3)
    expect(mocks.sync).toHaveBeenCalledTimes(3)
    expect((await listLibrary()).length).toBe(libsBefore + 1)
    expect((await listClasses()).filter((c) => c.content.name === 'Retry Looms')).toHaveLength(3)
  })

  it('closed and clashing dates are skipped with the reason; unticked dates are left out; the rest stand', async () => {
    mocks.closures = [{ from: '2033-03-10', to: '2033-03-10', name: 'spring cleaning' }]
    await post(blocked, { action: 'add', startIso: chicagoToIso('2033-03-17', 18, 30), endIso: chicagoToIso('2033-03-17', 19, 0), reason: 'Garcia party' }, '/api/admin/classes/blocked.json')
    const r = await post(classes, {
      action: 'repeat', content: content('Skip Looms'), sessions: [ses('2033-03-03', 18)], status: 'draft',
      pattern: { every: 1, untilYmd: '2033-03-31' }, skip: ['2033-03-24'], createKey: 'repeat-key-skip-1',
    })
    expect(r.status).toBe(200)
    expect(r.body.data.created.map((c: any) => c.ymd)).toEqual(['2033-03-03', '2033-03-31'])
    expect(r.body.data.skipped).toEqual([
      { ymd: '2033-03-10', reason: 'Closed for spring cleaning.' },
      { ymd: '2033-03-17', reason: 'Clashes with Garcia party, Thu Mar 17 6:30 PM.' },
    ])
    expect(r.body.data.created.every((c: any) => c.class.status === 'draft')).toBe(true)
  })

  it('a past picked date is refused (R37), the others are made', async () => {
    const r = await post(classes, {
      action: 'repeat', content: content('Past Pick'), sessions: [ses('2033-04-07', 18)], status: 'open',
      pattern: { dates: ['2020-04-02', '2033-04-14'] }, skip: [], createKey: 'repeat-key-past-1',
    })
    expect(r.body.data.skipped).toEqual([{ ymd: '2020-04-02', reason: 'That date has passed.' }])
    expect(r.body.data.created.map((c: any) => c.ymd)).toEqual(['2033-04-07', '2033-04-14'])
  })

  it('M3: copies that overlap each other are caught in the preview ("Overlaps the … copy.") and skipped at create time; others created', async () => {
    // A two-week series repeated weekly overlaps itself: the second copy's first date is the first copy's second date.
    const camp = [ses('2033-06-06', 9), ses('2033-06-13', 9)]
    const preview = await post(classes, { action: 'repeat-preview', content: content('Overlap Camp'), sessions: camp, pattern: { every: 1, untilYmd: '2033-06-20' } })
    expect(preview.body.data.dates.map((d: any) => [d.ok, d.reason])).toEqual([[true, null], [false, 'Overlaps the Mon Jun 6 copy.'], [true, null]])
    const r = await post(classes, { action: 'repeat', content: content('Overlap Camp'), sessions: camp, status: 'open', pattern: { every: 1, untilYmd: '2033-06-20' }, skip: [], createKey: 'repeat-key-camp-1' })
    expect(r.body.data.created.map((c: any) => c.ymd)).toEqual(['2033-06-06', '2033-06-20'])
    expect(r.body.data.skipped).toHaveLength(1)
    expect(r.body.data.skipped[0].ymd).toBe('2033-06-13')
    expect(r.body.data.skipped[0].reason).toBe('Overlaps the Mon Jun 6 copy.')
  })

  it('a break part way says exactly what was added and what is left; Try the rest again makes only the rest', async () => {
    const body = { action: 'repeat', content: content('Break Looms'), sessions: [ses('2033-08-04', 18)], status: 'open', pattern: { every: 1, untilYmd: '2033-08-25' }, skip: [], createKey: 'repeat-key-break-1' }
    mocks.failCreateAt = 3
    const a = await post(classes, body)
    expect(a.status).toBe(200)
    expect(a.body.data.created.map((c: any) => c.ymd)).toEqual(['2033-08-04', '2033-08-11'])
    expect(a.body.data.left).toEqual(['2033-08-18', '2033-08-25'])
    expect(a.body.data.leftBecause).toBe('error')
    mocks.failCreateAt = 0
    const b = await post(classes, body)
    expect(b.body.data.created.map((c: any) => c.ymd)).toEqual(['2033-08-04', '2033-08-11', '2033-08-18', '2033-08-25'])
    expect(b.body.data.created.slice(0, 2).map((c: any) => c.class.id)).toEqual(a.body.data.created.map((c: any) => c.class.id))
    expect(b.body.data.left).toEqual([])
    expect((await listClasses()).filter((c) => c.content.name === 'Break Looms')).toHaveLength(4)
  })

  it('out of time: answers with what is left so the sheet sends it again', async () => {
    repeatLimits.budgetMs = -1
    const body = { action: 'repeat', content: content('Slow Looms'), sessions: [ses('2033-09-01', 18)], status: 'open', pattern: { every: 1, untilYmd: '2033-09-15' }, skip: [], createKey: 'repeat-key-slow-1' }
    const a = await post(classes, body)
    expect(a.body.data.created.map((c: any) => c.ymd)).toEqual(['2033-09-01'])
    expect(a.body.data.left).toEqual(['2033-09-08', '2033-09-15'])
    expect(a.body.data.leftBecause).toBe('time')
    repeatLimits.budgetMs = 6_000
    const b = await post(classes, body)
    expect(b.body.data.created).toHaveLength(3)
    expect(b.body.data.created[0].class.id).toBe(a.body.data.created[0].class.id)
  })

  it('I2: no new date starts when the slowest one so far would carry the request past the hard limit', async () => {
    repeatLimits.hardMs = 0 // any date at all is "too slow" for what's left
    const body = { action: 'repeat', content: content('Hard Looms'), sessions: [ses('2033-09-02', 18)], status: 'open', pattern: { every: 1, untilYmd: '2033-09-16' }, skip: [], createKey: 'repeat-key-hard-1' }
    const a = await post(classes, body)
    expect(a.body.data.created.map((c: any) => c.ymd)).toEqual(['2033-09-02'])
    expect(a.body.data).toMatchObject({ left: ['2033-09-09', '2033-09-16'], leftBecause: 'time' })
  })

  it('M5: from scratch, an ended early-bird left off is said once in the reply', async () => {
    const body = { action: 'repeat', content: content('Old Bird', { earlyBird: { untilYmd: '2020-01-01', prices: { all: { person: 2000 } } } }), sessions: [ses('2033-09-05', 18)], status: 'open', pattern: { every: 1, untilYmd: '2033-09-12' }, skip: [], createKey: 'repeat-key-oldbird-1' }
    const r = await post(classes, body)
    expect(r.body.data.created).toHaveLength(2)
    expect(r.body.warning).toBe('Early-bird ended, so it was left off.')
    expect(r.body.data.created.every((c: any) => !c.class.content.earlyBird)).toBe(true)
  })

  it('library down from scratch: nothing is added', async () => {
    mocks.libraryDown = true
    const r = await post(classes, { action: 'repeat', content: content('No Lib'), sessions: [ses('2033-10-06', 18)], status: 'open', pattern: { every: 1, untilYmd: '2033-10-13' }, skip: [], createKey: 'repeat-key-nolib-1' })
    expect(r.status).toBe(503)
    expect(r.body.error).toBe("The library couldn't be reached, so nothing was added. Try again.")
    expect((await listClasses()).filter((c) => c.content.name === 'No Lib')).toHaveLength(0)
  })

  it('needs a create key, and at least one ticked date', async () => {
    const noKey = await post(classes, { action: 'repeat', content: content('K'), sessions: [ses('2033-10-20', 18)], pattern: { every: 1, untilYmd: '2033-10-27' } })
    expect(noKey.status).toBe(400)
    const none = await post(classes, { action: 'repeat', content: content('K'), sessions: [ses('2033-10-20', 18)], pattern: { every: 1, untilYmd: '2033-10-27' }, skip: ['2033-10-20', '2033-10-27'], createKey: 'repeat-key-none-1' })
    expect(none.status).toBe(400)
    expect(none.body.error).toBe('Tick at least one date.')
  })

  it('from the library (Run it again / Schedule it): every copy links to that entry and its latest version', async () => {
    const first = await post(classes, { action: 'create', content: content('Lib Looms'), sessions: [ses('2034-01-05', 18)], status: 'open', createKey: 'repeat-key-libsrc-0' })
    const libraryId = first.body.data.class.libraryId
    const r = await post(classes, { action: 'repeat', libraryId, content: content('Lib Looms'), sessions: [ses('2034-01-12', 18)], status: 'open', pattern: { dates: ['2034-01-19'] }, skip: [], createKey: 'repeat-key-libsrc-1' })
    expect(r.body.data.created).toHaveLength(2)
    expect(r.body.data.created.every((c: any) => c.class.libraryId === libraryId && c.class.libraryVersion === 1)).toBe(true)
  })
})
