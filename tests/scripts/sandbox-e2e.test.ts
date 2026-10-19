// tests/scripts/sandbox-e2e.test.ts — the sandbox E2E suite's helpers, with a mocked fetch (no network).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import {
  assertAllowed, AssertionFailed, check, checkEqual, checkStatus, chicagoToUtcIso, Cleanup, CookieJar, formatPlan, formatSummary,
  lineTax, MissingSecretError, onStop, parseArgs, type Pending, pick, PREVIEW_ORIGIN, PreviewClient, RateGate, readSecrets, redact, RefusedHostError, RUN_LINE,
  runScenarios, SkipScenario, SlotAllocator, SquareError, SquareSandbox, SQUARE_SANDBOX_VERSION, totalWithTax, type Scenario,
} from '../../scripts/lib/sandbox-e2e/core'
import { blockedDay, bookingIdOf, cleanUpLeftovers, CLEANUP_PLAN, firstDay, scenarios, testContent, type Ctx } from '../../scripts/lib/sandbox-e2e/scenarios'
import { main } from '../../scripts/sandbox-e2e'
import { bookingIdFor } from '@lib/classes/checkout'
import { SQUARE_API_VERSION } from '@lib/classes/square-api'
import { taxCents } from '@lib/tax'
import { validateContent } from '@lib/classes/validate'

const PREVIEW_HOST = new URL(PREVIEW_ORIGIN).host
const ADMIN = 'admin-secret-1234'
const STAFF = 'staff-secret-5678'

function res(status: number, body: unknown, headers: Record<string, string | string[]> = {}): Response {
  const h = new Headers({ 'Content-Type': 'application/json' })
  for (const [k, v] of Object.entries(headers)) for (const x of [v].flat()) h.append(k, x)
  return new Response(body === undefined ? '' : JSON.stringify(body), { status, headers: h })
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('hosts', () => {
  it('allows only the preview over https', () => {
    expect(assertAllowed(`${PREVIEW_ORIGIN}/api/x`, 'preview').host).toBe(PREVIEW_HOST)
    for (const bad of [
      'https://ourhometownstudio.com/api/classes/book.json',
      'https://www.ourhometownstudio.com/',
      'https://iridescent-croissant-494fc3.netlify.app/',
      `http://${PREVIEW_HOST}/`,
      `https://${PREVIEW_HOST}.evil.example/`,
      `https://user:pw@${PREVIEW_HOST}/`,
      'not a url',
    ]) expect(() => assertAllowed(bad, 'preview'), bad).toThrow(RefusedHostError)
  })

  it('allows only the Square sandbox for Square', () => {
    expect(assertAllowed('https://connect.squareupsandbox.com/v2/orders', 'square').host).toBe('connect.squareupsandbox.com')
    expect(() => assertAllowed('https://connect.squareup.com/v2/orders', 'square')).toThrow(RefusedHostError)
    expect(() => assertAllowed(`${PREVIEW_ORIGIN}/`, 'square')).toThrow(RefusedHostError)
  })

  it('a preview client never sends a request to another host', async () => {
    const fetch = vi.fn()
    const c = new PreviewClient({ fetch })
    await expect(c.get('https://ourhometownstudio.com/api/workshops.json')).rejects.toThrow(RefusedHostError)
    await expect(c.get('//ourhometownstudio.com/api/workshops.json')).rejects.toThrow(RefusedHostError)
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('secrets', () => {
  it('refuses to start without both passcodes, in one line, naming the run line and no values', () => {
    try {
      readSecrets({ ADMIN_PASSCODE: ADMIN })
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(MissingSecretError)
      const msg = (e as Error).message
      expect(msg).toContain('STAFF_PASSCODE')
      expect(msg).not.toContain('ADMIN_PASSCODE and')
      expect(msg).toContain(RUN_LINE)
      expect(msg).not.toContain(ADMIN)
      expect(msg.split('\n')).toHaveLength(1)
    }
    expect(() => readSecrets({})).toThrow(/ADMIN_PASSCODE and STAFF_PASSCODE not set/)
  })

  it('reads them from the env, the sandbox token optional', () => {
    expect(readSecrets({ ADMIN_PASSCODE: ADMIN, STAFF_PASSCODE: STAFF })).toEqual({ adminPasscode: ADMIN, staffPasscode: STAFF, sandboxToken: null })
    expect(readSecrets({ ADMIN_PASSCODE: ADMIN, STAFF_PASSCODE: STAFF, SQUARE_SANDBOX_ACCESS_TOKEN: 'tok-abcdef' }).sandboxToken).toBe('tok-abcdef')
  })

  it('redacts every secret', () => {
    expect(redact(`a ${ADMIN} b ${STAFF} c ${ADMIN}`, [ADMIN, STAFF, null])).toBe('a [hidden] b [hidden] c [hidden]')
    expect(redact('abc', ['', 'ab'])).toBe('abc')
  })

  it('the run line is the one in the brief, and in the script header', async () => {
    expect(RUN_LINE).toBe('! ADMIN_PASSCODE="$(npx netlify env:get ADMIN_PASSCODE --context branch:kaden/own-booking-system)" STAFF_PASSCODE="$(npx netlify env:get STAFF_PASSCODE --context branch:kaden/own-booking-system)" npx tsx scripts/sandbox-e2e.ts')
    const { readFileSync } = await import('node:fs')
    expect(readFileSync('scripts/sandbox-e2e.ts', 'utf8')).toContain(RUN_LINE)
    expect(readFileSync('docs/superpowers/plans/stage1-real-money-checklist.md', 'utf8')).toContain(RUN_LINE)
  })
})

describe('cookies and requests', () => {
  it('keeps cookies, drops one set to Max-Age=0', () => {
    const jar = new CookieJar()
    jar.set(['hg_admin=abc.def; Path=/; HttpOnly; Max-Age=100', 'other=1'])
    expect(jar.header()).toBe('hg_admin=abc.def; other=1')
    jar.set(['hg_admin=; Path=/; Max-Age=0'])
    expect(jar.has('hg_admin')).toBe(false)
  })

  it('sends JSON, carries the cookie back, never follows a redirect', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(res(200, { data: { ok: true } }, { 'Set-Cookie': 'hg_admin=xyz.sig; Path=/; HttpOnly' }))
      .mockResolvedValueOnce(res(200, { data: {} }))
    const c = new PreviewClient({ fetch })
    const r = await c.post('/api/admin/login.json', { passcode: ADMIN })
    expect(r.status).toBe(200)
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe(`${PREVIEW_ORIGIN}/api/admin/login.json`)
    expect(init.redirect).toBe('manual')
    expect(init.headers['Content-Type']).toBe('application/json')
    await c.get('/api/admin/classes/bookings.json?id=cls_x')
    expect(fetch.mock.calls[1][1].headers.Cookie).toBe('hg_admin=xyz.sig')
  })

  it('a gated call waits for the gate', async () => {
    const take = vi.fn().mockResolvedValue(undefined)
    const c = new PreviewClient({ fetch: vi.fn(async () => res(200, {})), gate: { take } as unknown as RateGate })
    await c.post('/api/classes/book.json', {}, { gated: true })
    await c.post('/api/admin/x', {})
    expect(take).toHaveBeenCalledTimes(1)
  })

  it('Square sandbox calls carry the token and version; errors say what Square said', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(res(200, { order: { id: 'o1' } }))
      .mockResolvedValueOnce(res(404, { errors: [{ code: 'NOT_FOUND', detail: 'Missing' }] }))
    const sq = new SquareSandbox('sandbox-tok-1', fetch)
    expect((await sq.get('/orders/o1')).order.id).toBe('o1')
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('https://connect.squareupsandbox.com/v2/orders/o1')
    expect(init.headers.Authorization).toBe('Bearer sandbox-tok-1')
    expect(init.headers['Square-Version']).toBe(SQUARE_SANDBOX_VERSION)
    const err = await sq.get('/orders/o2').catch((e) => e)
    expect(err).toBeInstanceOf(SquareError)
    expect(err.status).toBe(404)
    expect(err.message).toContain('NOT_FOUND Missing')
    expect(err.message).not.toContain('sandbox-tok-1')
  })

  it('uses the same Square version as the site', () => {
    expect(SQUARE_SANDBOX_VERSION).toBe(SQUARE_API_VERSION)
  })
})

describe('RateGate', () => {
  it('lets 4 through a minute, then waits for the oldest to age out', async () => {
    let t = 0
    const sleeps: number[] = []
    const gate = new RateGate(4, 60_000, () => t, async (ms) => { sleeps.push(ms); t += ms })
    for (let i = 0; i < 4; i++) { await gate.take(); t += 1000 }
    expect(sleeps).toEqual([])
    await gate.take()
    expect(t).toBeGreaterThanOrEqual(60_000)
    expect(sleeps.length).toBeGreaterThan(0)
  })

  it('takes two at once only when both fit', async () => {
    let t = 0
    const gate = new RateGate(4, 60_000, () => t, async (ms) => { t += ms })
    await gate.take(3)
    await gate.take(2)
    expect(t).toBeGreaterThanOrEqual(60_000)
    await expect(gate.take(5)).rejects.toThrow(/allows 4/)
  })
})

describe('assertions', () => {
  it('say what was expected and what came back', () => {
    expect(() => check(false, 'nope')).toThrow(AssertionFailed)
    expect(() => checkEqual(3, 2, 'Seats')).toThrow('Seats: expected 2, got 3')
    expect(() => checkEqual({ a: 1 }, { a: 1 }, 'x')).not.toThrow()
    expect(() => checkEqual({ adult: 1, kid: 2 }, { kid: 2, adult: 1 }, 'Seats per type')).not.toThrow()
    expect(() => checkStatus({ status: 409, body: { code: 'sold_out', detail: 'Full.' }, text: '' }, 200, 'Booking'))
      .toThrow('Booking: expected HTTP 200, got 409 sold_out / Full.')
    expect(() => checkStatus({ status: 402, body: null, text: '' }, [200, 402], 'x')).not.toThrow()
  })
})

describe('Cleanup', () => {
  it('runs last-in first-out and keeps going past a failure', async () => {
    const order: string[] = []
    const c = new Cleanup()
    c.add('archive', async () => { order.push('archive') })
    c.add('cancel', async () => { order.push('cancel'); throw new Error('boom') })
    c.add('unblock', async () => { order.push('unblock') })
    const out = await c.run()
    expect(order).toEqual(['unblock', 'cancel', 'archive'])
    expect(out.map((r) => [r.label, r.ok])).toEqual([['unblock', true], ['cancel', false], ['archive', true]])
    expect(out[1].error).toBe('boom')
    expect(c.size).toBe(0)
  })
})

describe('runner and summary', () => {
  const s = (id: number, run: Scenario<null>['run']): Scenario<null> => ({ id, title: `Scenario ${id}`, plan: ['does a thing'], run })

  it('PASS, FAIL, SKIP; cleanup always runs; a failed cleanup fails the scenario; secrets never shown', async () => {
    const cleaned: number[] = []
    const lines: string[] = []
    const results = await runScenarios([
      s(1, async (_c, scope) => { scope.cleanup.add('one', async () => { cleaned.push(1) }) }),
      s(2, async (_c, scope) => { scope.cleanup.add('two', async () => { cleaned.push(2) }); throw new AssertionFailed(`bad ${ADMIN}`) }),
      s(3, async () => { throw new SkipScenario('needs a token') }),
      s(4, async (_c, scope) => { scope.note(`saw ${STAFF}`); scope.cleanup.add('four', async () => { throw new Error(`cancel refused ${ADMIN}`) }) }),
      s(5, async () => { throw new TypeError('x is undefined') }),
    ], null, { secrets: [ADMIN, STAFF], log: (l) => lines.push(l) })
    expect(results.map((r) => r.outcome)).toEqual(['PASS', 'FAIL', 'SKIP', 'FAIL', 'FAIL'])
    expect(cleaned).toEqual([1, 2])
    expect(results[1].detail).toBe('bad [hidden]')
    expect(results[3].detail).toBe('cleanup failed: four (cancel refused [hidden])')
    expect(results[3].notes).toEqual(['saw [hidden]'])
    expect(results[4].detail).toBe('TypeError: x is undefined')
    const all = lines.join('\n') + formatSummary(results)
    expect(all).not.toContain(ADMIN)
    expect(all).not.toContain(STAFF)
  })

  it('prints a table with a line per scenario and the counts', () => {
    const table = formatSummary([
      { id: 1, title: 'Library class', outcome: 'PASS', ms: 1500, detail: '', notes: ['Square side not checked'], cleanup: [] },
      { id: 2, title: 'One price', outcome: 'FAIL', ms: 200, detail: 'Charged (cents): expected 6540, got 6000', notes: [], cleanup: [] },
      { id: 11, title: 'Counter sale', outcome: 'SKIP', ms: 0, detail: 'needs a token', notes: [], cleanup: [] },
    ])
    const rows = table.split('\n')
    expect(rows[0]).toMatch(/^#\s+Scenario\s+Result\s+Time\s+Why \/ note$/)
    expect(rows[2]).toMatch(/^1\s+Library class\s+PASS\s+1\.5s\s+Square side not checked$/)
    expect(rows[3]).toContain('FAIL')
    expect(table).toContain('1 passed, 1 failed, 1 skipped, of 3.')
    expect(table).toContain('[2] FAIL: Charged (cents): expected 6540, got 6000')
  })

  it('the dry-run plan names the preview and every step', () => {
    const plan = formatPlan(scenarios.slice(0, 2))
    expect(plan).toContain(PREVIEW_ORIGIN)
    expect(plan).toContain('[1] ')
    expect(plan).toContain('[2] ')
    expect(plan).toContain('    - ')
  })
})

describe('arguments', () => {
  it('--only, --dry-run, --help', () => {
    expect(parseArgs([])).toEqual({ only: null, dryRun: false, help: false, cleanupOnly: false })
    expect(parseArgs(['--only', '3'])).toEqual({ only: [3], dryRun: false, help: false, cleanupOnly: false })
    expect(parseArgs(['--cleanup-only', '--dry-run'])).toMatchObject({ cleanupOnly: true, dryRun: true })
    expect(() => parseArgs(['--cleanup-only', '--only', '3'])).toThrow(/takes no --only/)
    expect(parseArgs(['--only=3,5', '--dry-run']).only).toEqual([3, 5])
    expect(parseArgs(['--help']).help).toBe(true)
    expect(() => parseArgs(['--only'])).toThrow(/--only takes/)
    expect(() => parseArgs(['--only', 'x'])).toThrow(/--only takes/)
    expect(() => parseArgs(['--host', 'ourhometownstudio.com'])).toThrow(/Unknown option/)
  })

  it('pick refuses a scenario that does not exist', () => {
    expect(pick(scenarios, [3]).map((s) => s.id)).toEqual([3])
    expect(() => pick(scenarios, [99])).toThrow(/No scenario 99/)
  })
})

describe('studio days', () => {
  it('converts studio time to UTC across daylight saving', () => {
    expect(chicagoToUtcIso('2027-07-14', '05:00')).toBe('2027-07-14T10:00:00.000Z')
    expect(chicagoToUtcIso('2027-01-14', '05:00')).toBe('2027-01-14T11:00:00.000Z')
    expect(chicagoToUtcIso('2026-11-01', '05:00')).toBe('2026-11-01T11:00:00.000Z')
    expect(chicagoToUtcIso('2027-03-14', '05:00')).toBe('2027-03-14T10:00:00.000Z')
  })

  it('hands out each day once and skips closed and café days', () => {
    const skip = blockedDay({
      closures: [{ from: '2027-02-02', to: '2027-02-03' }],
      cafeWeekly: [{ weekday: 'Saturday' }],
      cafeSpecialDays: [{ date: '2027-02-08' }],
    })
    const slots = new SlotAllocator('2027-02-01', skip)
    // Feb 1 2027 is a Monday; 2–3 closed; 6 a Saturday (café); 8 a special café day.
    expect(slots.days(3)).toEqual(['2027-02-01', '2027-02-04', '2027-02-05'])
    expect(slots.days(2)).toEqual(['2027-02-07', '2027-02-09'])
    const [s] = slots.sessions(1, { capacity: 2 })
    expect(s).toEqual({ startIso: '2027-02-10T11:00:00.000Z', endIso: '2027-02-10T11:30:00.000Z', capacity: 2 })
  })

  it('a run starts 90 to 300 days out', () => {
    const now = new Date('2026-10-19T15:00:00Z')
    expect(firstDay(now, 0)).toBe('2027-01-17')
    expect(firstDay(now, 0.9999)).toBe('2027-08-14')
  })
})

describe('money and ids match the site', () => {
  it('tax per line as the site works it out', () => {
    for (const p of [2000, 1500, 1250, 999, 0]) expect(lineTax(p)).toBe(taxCents(p, 9))
    expect(totalWithTax([2000, 2000, 2000])).toBe(6540)
    expect(totalWithTax([2000, 1500, 1500])).toBe(5450)
  })

  it('booking ids as the booking endpoint makes them', () => {
    const a = '7b1f3c1e-8a6b-4c55-9b1f-0f6f2f0f9a11'
    expect(bookingIdOf(a)).toBe(bookingIdFor(a))
  })

  it('test class content passes the site’s own validation, link-only', () => {
    const v = validateContent(testContent({ name: 'E2E 1019 Test' }))
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.value.rules.linkOnly).toBe(true)
  })
})

describe('the scenarios', () => {
  it('are numbered 1..N with a title and a plan each, covering the brief', () => {
    expect(scenarios.map((s) => s.id)).toEqual(Array.from({ length: scenarios.length }, (_, i) => i + 1))
    expect(scenarios.length).toBe(23)
    for (const s of scenarios) {
      expect(s.title.length).toBeGreaterThan(5)
      expect(s.plan.length).toBeGreaterThan(0)
    }
  })
})

// ── A fake preview + sandbox, to run real scenarios against a mocked fetch ──

interface Fake { calls: { method: string; url: string; body: any }[]; fetch: any }
function fakeServer(opts: { taxPerSeat?: number; decline?: boolean } = {}): Fake {
  const calls: Fake['calls'] = []
  let cls: any = null
  const tax = opts.taxPerSeat ?? 180
  const bookings: { bookingId: string; seats: number; orderId: string; paymentId: string }[] = []
  const paid = (n: number) => n * (2000 + 180)
  const fetch = vi.fn(async (url: string, init: any = {}) => {
    const u = new URL(url)
    const body = init.body ? JSON.parse(init.body) : null
    calls.push({ method: init.method ?? 'GET', url, body })
    const p = u.pathname
    if (u.host === 'connect.squareupsandbox.com') {
      if (p === '/v2/locations') return res(200, { locations: [{ id: 'L1', status: 'ACTIVE' }] })
      if (p === '/v2/orders/search') return res(200, { orders: [{ id: 'ord_x', reference_id: 'bkg_someone_else', state: 'COMPLETED', tenders: [{ id: 't' }] }] })
      const b = bookings.find((x) => p === `/v2/orders/${x.orderId}` || p === `/v2/payments/${x.paymentId}`)
      if (b && p.startsWith('/v2/orders/')) {
        return res(200, { order: { id: b.orderId, state: 'COMPLETED', reference_id: b.bookingId, total_money: { amount: b.seats * (2000 + tax) },
          line_items: Array.from({ length: b.seats }, () => ({ quantity: '1', base_price_money: { amount: 2000 }, total_tax_money: { amount: tax } })) } })
      }
      if (b) return res(200, { payment: { id: b.paymentId, status: 'COMPLETED', total_money: { amount: paid(b.seats) }, order_id: b.orderId } })
      return res(404, { errors: [{ code: 'NOT_FOUND' }] })
    }
    if (p === '/api/admin/classes/classes.json' && body.action === 'create') {
      cls = { id: 'cls_test1', libraryId: 'lib_1', status: 'open', updatedAt: 't1', content: body.content, sessions: body.sessions.map((s: any, i: number) => ({ ...s, id: `ses_${i}` })), square: { itemId: 'ITEM1', variations: { 'single:person': 'V1' } } }
      return res(200, { data: { class: cls } })
    }
    if (p === '/api/admin/classes/classes.json' && body.action === 'cancel') { cls.status = 'cancelled'; return res(200, { data: { class: cls, booked: [] } }) }
    if (p === '/api/admin/classes/library.json') return res(200, { data: { library: { id: body.id } } })
    const taken = () => bookings.reduce((n, b) => n + b.seats, 0)
    if (p === '/api/admin/classes/bookings.json') {
      return res(200, { data: { class: cls, seatsTaken: { ses_0: taken() }, bookings: bookings.map((b) => ({
        bookingId: b.bookingId, state: 'confirmed', source: 'online', paidCents: paid(b.seats), lineIds: Array.from({ length: b.seats }, (_, i) => `led_${b.bookingId}_${i}`),
        seats: { person: b.seats }, sessionIds: ['ses_0'], paidHere: true,
      })) } })
    }
    if (p === '/api/classes/book.json') {
      const bookingId = bookingIdOf(body.attemptId)
      const n = body.tickets.person
      if (taken() + n > cls.sessions[0].capacity) return res(409, { error: 'Unable to book class', code: 'sold_out', detail: 'Full.' })
      if (opts.decline || body.paymentToken !== 'cnon:card-nonce-ok') return res(402, { error: 'Unable to book class', code: 'card_declined', detail: 'Declined.' })
      const k = bookings.length + 1
      bookings.push({ bookingId, seats: n, orderId: `ord_${k}`, paymentId: `pay_${k}` })
      return res(200, { data: { bookingId, classId: cls.id, orderId: `ord_${k}`, paymentId: `pay_${k}`, totalChargedCents: paid(n), seatsBooked: n, sessionIds: ['ses_0'] } })
    }
    return res(404, { error: 'Not found' })
  })
  return { calls, fetch }
}

function fakeCtx(f: Fake, withSquare: boolean): Ctx {
  const noWait = { take: async () => undefined } as unknown as RateGate
  return {
    pub: new PreviewClient({ fetch: f.fetch, gate: noWait }),
    admin: new PreviewClient({ fetch: f.fetch }),
    staff: new PreviewClient({ fetch: f.fetch }),
    gate: noWait,
    square: withSquare ? new SquareSandbox('tok-test', f.fetch) : null,
    slots: new SlotAllocator('2027-02-01'),
    runTag: '1019',
    person: { givenName: 'E2E', familyName: 'Sandbox', email: 'kaden+e2e@ourhometownstudio.com', phone: '(402) 980-2907' },
    settings: {},
    sleep: async () => undefined,
    log: () => undefined,
  }
}

describe('scenarios against a fake preview', () => {
  const two = scenarios.find((s) => s.id === 2)!
  const eight = scenarios.find((s) => s.id === 8)!

  it('scenario 2 passes when the site, ledger and Square agree, and cleans up', async () => {
    const f = fakeServer()
    const [r] = await runScenarios([two], fakeCtx(f, true), { secrets: [] })
    expect(r.detail).toBe('')
    expect(r.outcome).toBe('PASS')
    expect(r.cleanup.map((c) => c.label)).toEqual(['cancel cls_test1', 'archive library lib_1'])
    expect(f.calls.every((c) => [PREVIEW_HOST, 'connect.squareupsandbox.com'].includes(new URL(c.url).host))).toBe(true)
    const created = f.calls.find((c) => c.body?.action === 'create')!.body
    expect(created.content.name).toMatch(/^E2E 1019 /)
    expect(created.content.rules.linkOnly).toBe(true)
  })

  it('scenario 2 fails when Square taxed a line differently', async () => {
    const [r] = await runScenarios([two], fakeCtx(fakeServer({ taxPerSeat: 200 }), true), { secrets: [] })
    expect(r.outcome).toBe('FAIL')
    expect(r.detail).toMatch(/Square (order total|tax on the 20 line)/)
  })

  it('without a sandbox token the Square side is skipped with a note', async () => {
    const f = fakeServer()
    const [r] = await runScenarios([two], fakeCtx(f, false), { secrets: [] })
    expect(r.outcome).toBe('PASS')
    expect(r.notes).toContain('Square side not checked (no SQUARE_SANDBOX_ACCESS_TOKEN)')
    expect(f.calls.some((c) => new URL(c.url).host === 'connect.squareupsandbox.com')).toBe(false)
  })

  it('scenario 6: the third seat is refused and nothing of it is charged', async () => {
    const [r] = await runScenarios([scenarios.find((s) => s.id === 6)!], fakeCtx(fakeServer(), true), { secrets: [] })
    expect(r.detail).toBe('')
    expect(r.outcome).toBe('PASS')
  })

  it('scenario 8: declined cards hold nothing and pay nothing', async () => {
    const [r] = await runScenarios([eight], fakeCtx(fakeServer({ decline: true }), true), { secrets: [] })
    expect(r.detail).toBe('')
    expect(r.outcome).toBe('PASS')
  })

  it('scenarios needing a sandbox token skip without one', async () => {
    const f = fakeServer()
    const results = await runScenarios(scenarios.filter((s) => s.id === 11 || s.id === 22), fakeCtx(f, false), { secrets: [] })
    expect(results.map((r) => r.outcome)).toEqual(['SKIP', 'SKIP'])
    expect(f.fetch).not.toHaveBeenCalled()
  })
})

describe('main', () => {
  it('--dry-run prints the plan and touches no network', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    expect(await main(['--dry-run', '--only', '2'], {})).toBe(0)
    expect(fetch).not.toHaveBeenCalled()
    expect(log.mock.calls.flat().join('\n')).toContain('[2] One price')
  })

  it('without passcodes it stops before any request', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(await main([], {})).toBe(2)
    expect(fetch).not.toHaveBeenCalled()
    expect(err.mock.calls.flat().join('\n')).toContain('not set. Run it with: !')
  })

  it('stops before booking when the preview is not on the sandbox, never printing a passcode', async () => {
    const fetch = vi.fn(async (url: string, _init?: RequestInit) => {
      const p = new URL(url).pathname
      if (p === '/api/admin/login.json') return res(200, { data: { ok: true } }, { 'Set-Cookie': 'hg_admin=a.b; Path=/' })
      if (p === '/api/staff/login.json') return res(200, { data: { staff: [{ id: 's1', name: 'Kaden', role: 'owner' }] } })
      if (p === '/api/staff/pick.json') return res(200, { data: {} }, { 'Set-Cookie': 'hg_staff=c.d; Path=/' })
      if (p === '/api/admin/classes/seed-sandbox.json') return res(200, { data: { sandbox: false } })
      return res(500, {})
    })
    vi.stubGlobal('fetch', fetch)
    const out: string[] = []
    vi.spyOn(console, 'log').mockImplementation((...a) => { out.push(a.join(' ')) })
    vi.spyOn(console, 'error').mockImplementation((...a) => { out.push(a.join(' ')) })
    const proc = new EventEmitter()
    expect(await main(['--only', '2'], { ADMIN_PASSCODE: ADMIN, STAFF_PASSCODE: STAFF }, { proc, exit: vi.fn() })).toBe(1)
    expect(out.join('\n')).toContain('not on the Square sandbox')
    const deletes = fetch.mock.calls.filter(([, init]) => (init as any)?.method === 'DELETE').map(([u]) => new URL(u as string).pathname)
    expect(deletes).toEqual(['/api/admin/login.json', '/api/staff/login.json'])
    expect(proc.listenerCount('SIGINT')).toBe(0)
    expect(out.join('\n')).not.toContain(ADMIN)
    expect(out.join('\n')).not.toContain(STAFF)
    expect(fetch.mock.calls.some(([u]) => new URL(u as string).pathname === '/api/classes/book.json')).toBe(false)
    expect(fetch.mock.calls.every(([u]) => new URL(u as string).host === PREVIEW_HOST)).toBe(true)
  })
})

describe('stopping part way', () => {
  it('a signal runs the running scenario’s cleanups once, last in first out, signs out, then exits', async () => {
    const proc = new EventEmitter()
    const pending: Pending = { current: new Cleanup() }
    const order: string[] = []
    pending.current!.add('archive library', async () => { order.push('archive') })
    pending.current!.add(`cancel cls_1 ${ADMIN}`, async () => { order.push('cancel') })
    const signOut = vi.fn(async () => undefined)
    const lines: string[] = []
    let exited: number | null = null
    const done = new Promise<void>((resolve) => {
      onStop({ proc, pending, signOut, log: (l) => lines.push(l), secrets: [ADMIN], exit: (c) => { exited = c; resolve() } })
    })
    proc.emit('SIGINT')
    proc.emit('SIGINT')
    proc.emit('SIGTERM')
    await done
    expect(order).toEqual(['cancel', 'archive'])
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(exited).toBe(130)
    expect(lines.join('\n')).toContain('Stopping (SIGINT)')
    expect(lines.join('\n')).not.toContain(ADMIN)
  })

  it('an uncaught error does the same and exits 1; a failed cleanup points at --cleanup-only', async () => {
    const proc = new EventEmitter()
    const pending: Pending = { current: new Cleanup() }
    pending.current!.add('cancel cls_1', async () => { throw new Error('refused') })
    const lines: string[] = []
    const code = await new Promise<number>((resolve) => {
      onStop({ proc, pending, signOut: async () => undefined, log: (l) => lines.push(l), secrets: [], exit: resolve })
      proc.emit('uncaughtException', new Error('boom'))
    })
    expect(code).toBe(1)
    expect(lines.join('\n')).toContain('NOT cleaned: cancel cls_1 (refused)')
    expect(lines.join('\n')).toContain('--cleanup-only')
  })

  it('the handlers come off again', () => {
    const proc = new EventEmitter()
    const off = onStop({ proc, pending: { current: null }, signOut: async () => undefined, log: () => undefined, secrets: [], exit: () => undefined })
    expect(proc.listenerCount('SIGINT')).toBe(1)
    off()
    for (const e of ['SIGINT', 'SIGTERM', 'uncaughtException', 'unhandledRejection']) expect(proc.listenerCount(e)).toBe(0)
  })

  it('the runner points the stop at the running scenario’s cleanup, and clears it after', async () => {
    const pending: Pending = { current: null }
    let seen: Cleanup | null = null
    await runScenarios([{ id: 1, title: 't', plan: ['p'], run: async (_c, scope) => { seen = pending.current; expect(seen).toBe(scope.cleanup) } }], null, { secrets: [], pending })
    expect(seen).not.toBeNull()
    expect(pending.current).toBeNull()
  })

  it('--cleanup-only --dry-run prints what it would clear, with no network and no passcodes', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    expect(await main(['--cleanup-only', '--dry-run'], {})).toBe(0)
    expect(fetch).not.toHaveBeenCalled()
    const out = log.mock.calls.flat().join('\n')
    expect(out).toContain(PREVIEW_ORIGIN)
    for (const step of CLEANUP_PLAN) expect(out).toContain(step)
  })

  it('--cleanup-only clears only "E2E" leftovers', async () => {
    const calls: { path: string; body: any }[] = []
    const fetch = vi.fn(async (url: string, init: any = {}) => {
      const path = new URL(url).pathname
      const body = init.body ? JSON.parse(init.body) : null
      calls.push({ path, body })
      if (init.method === 'GET' && path === '/api/admin/classes/classes.json') return res(200, { data: { classes: [
        { id: 'cls_a', status: 'open', updatedAt: 'u1', content: { name: 'E2E 1019 Refund' } },
        { id: 'cls_b', status: 'cancelled', updatedAt: 'u2', content: { name: 'E2E 1019 Cancel' } },
        { id: 'cls_c', status: 'open', updatedAt: 'u3', content: { name: 'Pottery night' } },
        { id: 'cls_d', status: 'open', updatedAt: 'u4', content: { name: 'E2Ething' } },
      ] } })
      if (init.method === 'GET' && path === '/api/admin/classes/library.json') return res(200, { data: { library: [
        { id: 'lib_a', archived: false, versions: [{ content: { name: 'Old' } }, { content: { name: 'E2E 1019 Refund' } }] },
        { id: 'lib_c', archived: false, versions: [{ content: { name: 'Pottery night' } }] },
      ] } })
      if (init.method === 'GET' && path === '/api/admin/classes/blocked.json') return res(200, { data: { blocked: [
        { id: 'blk_a', reason: 'E2E block 1019' }, { id: 'blk_b', reason: 'Private event' },
      ] } })
      if (init.method === 'GET' && path === '/api/admin/settings.json') return res(200, { data: { settings: {
        updatedAt: 's1', cafeWeekly: [], cafeSpecialDays: [],
        closures: [{ id: 'c1', from: '2026-12-25', to: '2026-12-25', name: 'Christmas' }, { id: 'c2', from: '2027-03-01', to: '2027-03-01', name: 'E2E closure 1019' }],
      } } })
      return res(200, { data: {} })
    })
    const admin = new PreviewClient({ fetch })
    const { done, failed } = await cleanUpLeftovers({ admin }, () => undefined)
    expect(failed).toEqual([])
    expect(done).toHaveLength(4)
    const posts = calls.filter((c) => c.body)
    expect(posts).toEqual([
      { path: '/api/admin/classes/classes.json', body: { action: 'cancel', id: 'cls_a', expectedUpdatedAt: 'u1' } },
      { path: '/api/admin/classes/library.json', body: { action: 'archive', id: 'lib_a' } },
      { path: '/api/admin/classes/blocked.json', body: { action: 'remove', id: 'blk_a' } },
      { path: '/api/admin/settings.json', body: { cafeWeekly: [], cafeSpecialDays: [], closures: [{ id: 'c1', from: '2026-12-25', to: '2026-12-25', name: 'Christmas' }], expectedUpdatedAt: 's1' } },
    ])
  })
})
