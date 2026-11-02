// tests/scripts/sandbox-e2e-parties.test.ts — the party scenarios (24–40) and their helpers, against a fake preview (no network).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { chicagoToUtcIso, Cleanup, Halt, onStop, StoppedError, parseArgs, pick, PREVIEW_ORIGIN, PreviewClient, runScenarios, SlotAllocator, SquareSandbox, weekdayOf, type RateGate } from '../../scripts/lib/sandbox-e2e/core'
import { CLEANUP_PLAN } from '../../scripts/lib/sandbox-e2e/scenarios'
import {
  clashLabel, cleanUpPartyLeftovers, icsUtc, switchOffByTest, linkParts, NO_CRAFT, noHoursWeekdays, parseIcs, PARTY_CLEANUP_PLAN, partyDayPool, partyIdOf, partyScenarios,
  POOL_FIRST_OFFSET, POOL_SIZE, settingsInput, testAddOns, testIds, testPackage, testStarts, withoutTestSetup, withTestSetup, type PartyCtx,
} from '../../scripts/lib/sandbox-e2e/party-scenarios'
import { ALL_SCENARIOS, finishRun, main } from '../../scripts/sandbox-e2e'
import { idFor } from '@lib/booking-core/ids'
import { buildIcs, partyCalendarIds } from '@lib/party-share'
import { configPartySettings, validatePartySettings } from '@lib/parties/party-times'
import { payLinkUrl } from '@lib/parties/payment-link'

const HOST = new URL(PREVIEW_ORIGIN).host
const SQ = 'connect.squareupsandbox.com'

function res(status: number, body: unknown, text?: string): Response {
  return new Response(text ?? JSON.stringify(body), { status, headers: { 'Content-Type': text ? 'text/calendar' : 'application/json' } })
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('the party scenarios', () => {
  it('are 24..40, each with a title and a plan; with the class, staffing and extras scenarios they run 1..67 in order', () => {
    expect(partyScenarios.map((s) => s.id)).toEqual(Array.from({ length: 17 }, (_, i) => 24 + i))
    for (const s of partyScenarios) {
      expect(s.title.length).toBeGreaterThan(5)
      expect(s.title.length).toBeLessThanOrEqual(60)
      expect(s.plan.length).toBeGreaterThan(0)
    }
    expect(ALL_SCENARIOS.map((s) => s.id)).toEqual(Array.from({ length: 67 }, (_, i) => i + 1))
  })

  it('--only takes a range', () => {
    expect(parseArgs(['--only', '24-40']).only).toEqual(Array.from({ length: 17 }, (_, i) => 24 + i))
    expect(parseArgs(['--only', '2,24-26']).only).toEqual([2, 24, 25, 26])
    expect(() => parseArgs(['--only', '40-24'])).toThrow(/--only takes/)
    expect(pick(ALL_SCENARIOS, [24, 40]).map((s) => s.id)).toEqual([24, 40])
  })

  it('--dry-run lists 1–23, 24–40, 41–48 and 49–67 with their plans, touching no network', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    expect(await main(['--dry-run'], {})).toBe(0)
    expect(fetch).not.toHaveBeenCalled()
    const out = log.mock.calls.flat().join('\n')
    for (let id = 1; id <= 67; id++) expect(out).toContain(`[${id}] `)
    expect(out).toContain('Would run 67 scenarios')
    expect(out).toContain('$1, Only with the link')
    expect(out).toMatch(/scenarios 11, 22, 40, [0-9, ]+ and the To decide half of 27 would be skipped/)
  })

  it('--cleanup-only --dry-run includes the party leftovers and the Parties setup revert', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    expect(await main(['--cleanup-only', '--dry-run'], {})).toBe(0)
    const out = log.mock.calls.flat().join('\n')
    for (const step of [...CLEANUP_PLAN, ...PARTY_CLEANUP_PLAN]) expect(out).toContain(step)
    expect(out).toMatch(/cancel every booked party .* "E2E "/)
    expect(out).toMatch(/out of Parties setup/)
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('party helpers match the site', () => {
  it('party ids as the site makes them from an attempt id or create key', () => {
    for (const k of ['0b6f3b9e-1111-4c4c-9d9d-123456789abc', 'e2e-abc12345']) expect(partyIdOf(k)).toBe(idFor('pty', k))
  })

  it('the test package and extras pass the site’s own Parties setup checks, and come out again', () => {
    const now = new Date('2026-11-02T15:00:00Z')
    const base = settingsInput(configPartySettings())
    const days = partyDayPool('2026-11-02', 5, {}, base)
    const starts = testStarts(base)
    expect(starts).toEqual(['04:00', '06:30'])
    const withTest = withTestSetup(base, { runTag: '11021500', days, starts })
    const checked = validatePartySettings(withTest, { now })
    expect(checked.packages.find((p) => p.id === testIds('11021500').pkg)).toMatchObject({ priceCents: 100, minutes: 90, who: 'link' })
    expect(checked.addOns.map((a) => a.id)).toEqual(expect.arrayContaining([testIds('11021500').half, testIds('11021500').bags]))
    for (const d of days) expect(checked.times.dates[d]).toEqual(['04:00', '06:30'])
    // the run's cleanup (its own days) and --cleanup-only (any test day) both give back what was there
    expect(withoutTestSetup(withTest, { days })).toEqual(base)
    expect(withoutTestSetup(withTest)).toEqual(base)
    expect(withoutTestSetup(base)).toBeNull()
    // a real dated day (owners' times start 8 AM or later, or none) is never taken
    const real = { ...base, times: { ...base.times, dates: { ...base.times.dates, '2026-12-24': [], '2026-12-26': ['10:00', '14:00'] } } }
    expect(withoutTestSetup(real)).toBeNull()
    // the Square read switch goes back as it was
    expect(withoutTestSetup({ ...withTest, readSquareBookings: false }, { days, readSquareBookings: true })?.readSquareBookings).toBe(true)
  })

  it('a longer package moves the second test start so the day still checks out', () => {
    const base = settingsInput(configPartySettings())
    const long = { ...base, packages: [...base.packages, { ...base.packages[0], id: 'pkg_long', name: 'Long', minutes: 120 }] }
    expect(testStarts(long)).toEqual(['04:00', '07:00'])
  })

  it('test days: 20+ days out, only days with no opening hours, never closed, café or already dated', () => {
    const allowed = noHoursWeekdays()
    expect([...allowed].sort()).toEqual(['Monday', 'Tuesday', 'Wednesday'])
    const studio = { closures: [{ from: '2026-11-23', to: '2026-11-24', name: 'Closed' }], cafeWeekly: [{ weekday: 'Wednesday' }], cafeSpecialDays: [{ date: '2026-11-30' }] }
    const party = { times: { dates: { '2026-12-01': ['14:00'] } } }
    const days = partyDayPool('2026-11-02', 6, studio, party)
    expect(days[0] >= '2026-11-22').toBe(true)
    for (const d of days) {
      expect(['Monday', 'Tuesday']).toContain(weekdayOf(d))
      expect(['2026-11-23', '2026-11-24', '2026-11-30', '2026-12-01']).not.toContain(d)
    }
    expect(new Set(days).size).toBe(6)
    expect(POOL_FIRST_OFFSET).toBeGreaterThanOrEqual(16)
    expect(POOL_SIZE).toBeGreaterThanOrEqual(18)
  })

  it('test days stay inside Parties setup’s notice and booking window, or say plainly what to change', () => {
    const studio = { closures: [], cafeWeekly: [], cafeSpecialDays: [] }
    const days = partyDayPool('2026-11-02', 5, studio, { times: { dates: {}, bookingWindowDays: 90, minLeadDays: 30 } })
    expect(days[0] >= '2026-12-02').toBe(true)
    const wide = partyDayPool('2026-11-02', POOL_SIZE, studio, { times: { dates: {}, bookingWindowDays: 90, minLeadDays: 7 } })
    expect(wide.every((d) => d <= '2027-01-31')).toBe(true)
    expect(() => partyDayPool('2026-11-02', POOL_SIZE, studio, { times: { dates: {}, bookingWindowDays: 40, minLeadDays: 7 } }))
      .toThrow(/booking window \(40 days ahead\).*"Up to \(days ahead\)" to 90/)
  })

  it('a clash refusal names a test party by the last word of its host’s name, as the site does', () => {
    expect(clashLabel('Card')).toBe('the Card party')
    expect(clashLabel('Extra time online')).toBe('the online party')
  })

  it('the bags extra is owners-only, so the preview’s /book never shows it during a run; the half hour stays online for scenario 29', () => {
    const [half, bags] = testAddOns('11021500')
    expect(half.online).toBe(true)
    expect(bags.online).toBe(false)
  })

  it('the Square read switch is turned back on only when a test run turned it off', () => {
    const pkgs = settingsInput(configPartySettings()).packages
    const withE2E = [...pkgs, testPackage('11021500')]
    const off = (history: any[]) => ({ readSquareBookings: false, history })
    expect(switchOffByTest(off([{ before: { readSquareBookings: true, packages: withE2E } }]))).toBe(true)
    // a later unrelated save doesn't hide it
    expect(switchOffByTest(off([{ before: { readSquareBookings: false, packages: pkgs } }, { before: { readSquareBookings: true, packages: withE2E } }]))).toBe(true)
    // an owner turned it off with no test package around: left alone
    expect(switchOffByTest(off([{ before: { readSquareBookings: true, packages: pkgs } }]))).toBe(false)
    expect(switchOffByTest(off([]))).toBe(false)
    expect(switchOffByTest({ readSquareBookings: true, history: [{ before: { readSquareBookings: true, packages: withE2E } }] })).toBe(false)
  })

  it('reads the site’s calendar file and payment link', () => {
    const ics = buildIcs(
      { title: 'A party', startIso: '2026-12-07T10:00:00.000Z', endIso: '2026-12-07T11:30:00.000Z', details: 'x', location: 'y' },
      partyCalendarIds('pty_abc', 2),
    )
    const ev = parseIcs(ics)
    expect(ev.UID).toBe('party-pty_abc@ourhometownstudio.com')
    expect(ev.SEQUENCE).toBe('2')
    expect(ev.DTSTART).toBe(icsUtc('2026-12-07T10:00:00.000Z'))
    const url = payLinkUrl(PREVIEW_ORIGIN, { bookingId: 'pty_abc', payToken: 'tok_1' } as any)
    expect(linkParts(url)).toEqual({ id: 'pty_abc', k: 'tok_1' })
  })
})

describe('finishRun', () => {
  it('runs the run-level undo steps once and says so; nothing to say when there are none', async () => {
    const c = new Cleanup()
    const did: string[] = []
    c.add('put Parties setup back', async () => { did.push('settings') })
    const lines: string[] = []
    const done = await finishRun(c, (l) => lines.push(l))
    expect(done.map((d) => d.ok)).toEqual([true])
    expect(await finishRun(c, (l) => lines.push(l))).toEqual([])
    expect(did).toEqual(['settings'])
    expect(lines.join('\n')).toContain('done: put Parties setup back')
  })

  it('points at --cleanup-only when putting back fails', async () => {
    const c = new Cleanup()
    c.add('put Parties setup back', async () => { throw new Error('stale') })
    const lines: string[] = []
    await finishRun(c, (l) => lines.push(l))
    expect(lines.join('\n')).toContain('NOT done: put Parties setup back (stale)')
    expect(lines.join('\n')).toContain('--cleanup-only')
  })
})

// ── A fake preview + sandbox for the party scenarios ──────────────────────

interface FakeParty { notTold?: { what: string[]; at: string } | null; id: string; status: 'booked' | 'cancelled'; startIso: string; endIso: string; hostName: string; charges: any[]; refunds: any[]; hostToken: string; timeVersion: number }

function fakePreview(opts: { crafts?: boolean; simulate?: boolean } = {}) {
  const calls: { method: string; url: string; body: any }[] = []
  let settings: any = { ...configPartySettings(), updatedAt: '2026-11-01T00:00:00.000Z', history: [] }
  const parties = new Map<string, FakeParty>()
  const orders = new Map<string, any>()
  const payments = new Map<string, any>()
  let n = 0
  const minutesOf = (pkgId?: string) => settings.packages.find((p: any) => p.id === pkgId)?.minutes ?? 90
  const held = () => [...parties.values()].filter((p) => p.status === 'booked')
  const clash = (startIso: string, endIso: string, except?: string) => held().some((p) => p.id !== except
    && Date.parse(startIso) < Date.parse(p.endIso) + 3_600_000 && Date.parse(p.startIso) < Date.parse(endIso) + 3_600_000)
  const offeredOn = (day: string): string[] => {
    const dated = settings.times.dates[day]
    if (!dated) return []
    return dated.map((hhmm: string) => chicagoToUtcIso(day, hhmm))
  }
  const view = (p: FakeParty) => ({
    bookingId: p.id, status: p.status, legacy: false, startIso: p.startIso, endIso: p.endIso, hostName: p.hostName, charges: p.charges, refunds: p.refunds,
    dueCents: 0, paymentState: p.status === 'cancelled' ? 'cancelled' : 'paid', items: [], holdState: { notHeld: null, freeable: [] }, timeVersion: p.timeVersion, notTold: p.notTold ?? null,
  })
  const fetch = vi.fn(async (url: string, init: any = {}) => {
    const u = new URL(url)
    const body = init.body ? JSON.parse(init.body) : null
    const method = init.method ?? 'GET'
    calls.push({ method, url, body })
    const p = u.pathname
    if (u.host === SQ) {
      if (p === '/v2/bookings') return res(200, { bookings: [] })
      const o = orders.get(p.replace('/v2/orders/', ''))
      if (o) return res(200, { order: o })
      const pay = payments.get(p.replace('/v2/payments/', ''))
      if (pay) return res(200, { payment: pay })
      return res(404, { errors: [{ code: 'NOT_FOUND' }] })
    }
    if (p === '/api/party/service-info.json') {
      const pkg = u.searchParams.get('package')
      return res(200, { data: {
        crafts: opts.crafts === false ? [] : [{ id: 'CRAFT1', name: 'Sandbox Keychain Bar' }],
        facts: { packages: settings.packages.filter((x: any) => x.who === 'everyone' || x.id === pkg) },
      } })
    }
    if (p === '/api/admin/parties/settings.json' && method === 'GET') return res(200, { data: { settings, legacyRemaining: { count: 0, lastIso: null } } })
    if (p === '/api/admin/parties/settings.json') {
      if ((body.expectedUpdatedAt ?? null) !== settings.updatedAt) return res(409, { error: 'Someone else changed the party settings.', stale: true, current: settings })
      const added = body.packages.filter((x: any) => !settings.packages.some((y: any) => y.id === x.id)).map((x: any) => `Added a package: ${x.name}`)
      const before = settingsInput(settings)
      settings = { ...settingsInput(body), updatedAt: new Date(Date.parse(settings.updatedAt) + 1000).toISOString(), history: [{ changed: added, before }, ...settings.history] }
      return res(200, { data: { settings, changed: added, booked: [] } })
    }
    if (p === '/api/party/available-dates.json') {
      const times: Record<string, any[]> = {}
      for (const day of Object.keys(settings.times.dates)) {
        const open = offeredOn(day).filter((s) => !clash(s, new Date(Date.parse(s) + minutesOf(body.packageId) * 60_000).toISOString()))
        if (open.length) times[day] = open.map((startAt) => ({ startAt }))
      }
      return res(200, { data: { dates: Object.keys(times), times } })
    }
    if (p === '/api/admin/parties/times.json') {
      const day = u.searchParams.get('from')!
      const open = offeredOn(day).filter((s) => !clash(s, new Date(Date.parse(s) + 90 * 60_000).toISOString(), u.searchParams.get('exclude') ?? undefined))
      return res(200, { data: { minutes: 90, offered: offeredOn(day), open } })
    }
    if (p === '/api/party/book.json') {
      const id = partyIdOf(body.attemptId)
      const existing = parties.get(id)
      if (existing) return res(200, { data: { bookingId: id, hostToken: existing.hostToken, totalCharged: 100, replayed: true } })
      const endIso = new Date(Date.parse(body.startTime) + minutesOf(body.packageId) * 60_000).toISOString()
      if (clash(body.startTime, endIso)) return res(409, { error: 'Unable to complete party booking', code: 'slot_taken', detail: 'taken' })
      if (body.paymentToken !== 'cnon:card-nonce-ok') return res(402, { code: 'card_declined' })
      n++
      const pkg = settings.packages.find((x: any) => x.id === body.packageId)
      const orderId = `ord_${n}`, paymentId = `pay_${n}`
      orders.set(orderId, { id: orderId, state: 'COMPLETED', reference_id: id, total_money: { amount: 100 }, total_tax_money: { amount: 0 }, line_items: [{ name: `Party — ${pkg.name}`, note: pkg.id, quantity: '1' }] })
      payments.set(paymentId, { id: paymentId, status: 'COMPLETED', total_money: { amount: 100 }, order_id: orderId })
      parties.set(id, {
        id, status: 'booked', startIso: new Date(body.startTime).toISOString(), endIso, hostName: `${body.customer.firstName} ${body.customer.lastName}`, hostToken: `host_${n}`, timeVersion: 0, refunds: [],
        charges: [{ id: `chg_${n}`, via: 'online', orderId, paymentId, cents: 100, ...(opts.simulate ? { simulated: true } : {}) }],
      })
      return res(200, { data: { bookingId: id, hostToken: `host_${n}`, orderId, totalCharged: 100, ...(opts.simulate ? { simulated: true } : {}) } })
    }
    if (p === '/api/admin/party.json') {
      const party = parties.get(u.searchParams.get('id')!)
      return res(200, { data: { party: party ? view(party) : null, guests: [] } })
    }
    if (p === '/api/admin/parties/actions.json' && body.action === 'cancel') {
      const party = parties.get(body.id)!
      party.status = 'cancelled'
      party.notTold = { what: ['cancelled'], at: '2026-11-02T15:00:00.000Z' }
      return res(200, { data: { party: view(party), message: 'Cancelled. Nothing was refunded.' } })
    }
    if (p === '/api/admin/parties/actions.json' && body.action === 'mark-told') {
      const party = parties.get(body.id)!
      if (body.notToldAt !== party.notTold?.at) return res(409, { error: 'stale' })
      party.notTold = null
      return res(200, { data: { party: view(party) } })
    }
    if (p === '/api/party/invite.ics') {
      const party = parties.get(u.searchParams.get('party')!)!
      return res(200, null, buildIcs({ title: 't', startIso: party.startIso, endIso: party.endIso, details: 'd', location: 'l' }, partyCalendarIds(party.id, party.timeVersion)))
    }
    if (p === '/api/party/balance.json') return res(404, { error: 'not found' })
    return res(404, { error: `fake: no ${method} ${p}` })
  })
  return { calls, fetch, parties, get settings() { return settings } }
}

function fakeCtx(f: ReturnType<typeof fakePreview>, withSquare: boolean): PartyCtx {
  const noWait = { take: async () => undefined } as unknown as RateGate
  return {
    pub: new PreviewClient({ fetch: f.fetch, gate: noWait }),
    admin: new PreviewClient({ fetch: f.fetch }),
    staff: new PreviewClient({ fetch: f.fetch }),
    gate: noWait,
    square: withSquare ? new SquareSandbox('tok-test', f.fetch) : null,
    slots: new SlotAllocator('2027-02-01'),
    runTag: '11021500',
    person: { givenName: 'E2E', familyName: 'Sandbox', email: 'kaden+e2e@ourhometownstudio.com', phone: '(402) 980-2907' },
    settings: { closures: [], cafeWeekly: [{ weekday: 'Saturday' }], cafeSpecialDays: [] },
    runCleanup: new Cleanup(),
    sleep: async () => undefined,
    log: () => undefined,
  }
}

const scenario = (id: number) => partyScenarios.find((s) => s.id === id)!

describe('party scenarios against a fake preview', () => {
  it('24 saves the test setup once, checks it, and the run cleanup takes it all out again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-02T15:00:00Z'))
    try {
      const f = fakePreview()
      const before = settingsInput(f.settings)
      const ctx = fakeCtx(f, true)
      const [r] = await runScenarios([scenario(24)], ctx, { secrets: [] })
      expect(r.detail).toBe('')
      expect(r.outcome).toBe('PASS')
      expect(ctx.party?.days).toHaveLength(POOL_SIZE)
      expect(f.settings.packages.some((p: any) => p.id === testIds('11021500').pkg)).toBe(true)
      const saves = f.calls.filter((c) => c.method === 'POST' && new URL(c.url).pathname === '/api/admin/parties/settings.json')
      expect(saves[0].body.packages.at(-1)).toEqual(testPackage('11021500'))
      expect(saves[0].body.addOns.slice(-2)).toEqual(testAddOns('11021500'))
      // the run's cleanup
      await finishRun(ctx.runCleanup, () => undefined)
      expect(settingsInput(f.settings)).toEqual(before)
      expect(f.calls.every((c) => [HOST, SQ].includes(new URL(c.url).host))).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('25 passes when the record, the times and Square agree, and cancels its party', async () => {
    const f = fakePreview()
    const ctx = fakeCtx(f, true)
    const [r] = await runScenarios([scenario(25)], ctx, { secrets: [] })
    expect(r.detail).toBe('')
    expect(r.outcome).toBe('PASS')
    const booked = f.calls.find((c) => new URL(c.url).pathname === '/api/party/book.json')!.body
    expect(booked.customer.firstName).toBe('E2E')
    expect(booked.customer.lastName).toMatch(/^11021500 /)
    expect(booked.customer.phone).toBe('(402) 980-2907')
    expect(booked.linkPackageId).toBe(testIds('11021500').pkg)
    expect([...f.parties.values()].every((p) => p.status === 'cancelled')).toBe(true)
    // no "Host not told yet" left in To decide for a test party
    expect([...f.parties.values()].every((p) => p.notTold === null)).toBe(true)
    expect(f.calls.filter((c) => c.body?.action === 'mark-told')).toHaveLength(f.parties.size)
    expect(r.cleanup.map((c) => c.label)).toEqual([expect.stringMatching(/^cancel party pty_/)])
  })

  it('25 fails when the preview simulates payments', async () => {
    const [r] = await runScenarios([scenario(25)], fakeCtx(fakePreview({ simulate: true }), true), { secrets: [] })
    expect(r.outcome).toBe('FAIL')
    expect(r.detail).toMatch(/simulated/)
  })

  it('26: one of two at once wins, the other is refused before any charge', async () => {
    const f = fakePreview()
    const [r] = await runScenarios([scenario(26)], fakeCtx(f, false), { secrets: [] })
    expect(r.detail).toBe('')
    expect(r.outcome).toBe('PASS')
    expect(r.notes).toContain('Square side not checked (no SQUARE_SANDBOX_ACCESS_TOKEN)')
  })

  it('with no party craft on the preview every party scenario skips, saying how to fix it, and nothing is saved', async () => {
    const f = fakePreview({ crafts: false })
    const results = await runScenarios([scenario(24), scenario(25)], fakeCtx(f, true), { secrets: [] })
    expect(results.map((x) => x.outcome)).toEqual(['SKIP', 'SKIP'])
    expect(results[0].detail).toBe(NO_CRAFT)
    expect(f.calls.some((c) => c.method === 'POST')).toBe(false)
  })

  it('40 skips without a sandbox token, touching nothing', async () => {
    const f = fakePreview()
    const [r] = await runScenarios([scenario(40)], fakeCtx(f, false), { secrets: [] })
    expect(r.outcome).toBe('SKIP')
    expect(f.fetch).not.toHaveBeenCalled()
  })
})

describe('--cleanup-only for parties', () => {
  it('cancels only "E2E" parties, taps I told them, frees their held times, clears old "Host not told yet", and takes only test bits out of Parties setup', async () => {
    const calls: { path: string; body: any }[] = []
    const base = settingsInput(configPartySettings())
    const withTest = withTestSetup(base, { runTag: '11011200', days: ['2026-12-07'], starts: ['04:00', '06:30'] })
    const parties: Record<string, any> = {
      pty_a: { bookingId: 'pty_a', status: 'booked', legacy: false, startIso: 'x', timeVersion: 0, holdState: { freeable: [] } },
      pty_b: { bookingId: 'pty_b', status: 'cancelled', legacy: false, startIso: '2026-12-08T10:00:00.000Z', timeVersion: 2, holdState: { freeable: [{ startIso: '2026-12-08T10:00:00.000Z' }] } },
    }
    const fetch = vi.fn(async (url: string, init: any = {}) => {
      const u = new URL(url)
      const body = init.body ? JSON.parse(init.body) : null
      calls.push({ path: u.pathname, body })
      if (u.pathname === '/api/admin/classes/calendar.json') return res(200, { data: { items: [
        { kind: 'party', id: 'pty_a', hostName: 'E2E 11011200 Move' },
        { kind: 'party', id: 'pty_b', hostName: 'E2E 11011200 Cancel' },
        { kind: 'party', id: 'pty_real', hostName: 'Stefanie Justice' },
        { kind: 'party', id: 'sqbooking1', hostName: 'E2Ething' },
        { kind: 'class', id: 'cls_1', label: 'E2E class' },
      ] } })
      if (u.pathname === '/api/admin/party.json') {
        const p = parties[u.searchParams.get('id')!]
        return res(200, { data: { party: p } })
      }
      if (u.pathname === '/api/admin/parties/actions.json' && body.action === 'cancel') {
        parties[body.id] = { ...parties[body.id], status: 'cancelled', notTold: { what: ['cancelled'], at: 'n1' } }
        return res(200, { data: {} })
      }
      if (u.pathname === '/api/admin/parties/actions.json' && body.action === 'mark-told') {
        parties[body.id] = { ...parties[body.id], notTold: null }
        return res(200, { data: {} })
      }
      if (u.pathname === '/api/admin/to-decide.json' && !body) return res(200, { data: { items: [
        { id: 'td_old', kind: 'party-not-told', detail: { partyId: 'pty_old', host: 'E2E 10301200 Move' } },
        { id: 'td_real', kind: 'party-not-told', detail: { partyId: 'pty_real', host: 'Stefanie Justice' } },
        { id: 'td_pay', kind: 'party-paid-unclear', detail: { partyId: 'pty_x', host: 'E2E 10301200 Pay' } },
      ] } })
      if (u.pathname === '/api/admin/parties/settings.json' && init.method === 'GET') return res(200, { data: { settings: { ...withTest, updatedAt: 'u1' } } })
      return res(200, { data: {} })
    })
    const admin = new PreviewClient({ fetch })
    const { done, failed } = await cleanUpPartyLeftovers({ admin }, () => undefined, new Date('2026-11-02T15:00:00Z'))
    expect(failed).toEqual([])
    expect(done).toHaveLength(4)
    const posts = calls.filter((c) => c.body)
    expect(posts).toEqual([
      { path: '/api/admin/parties/actions.json', body: { id: 'pty_a', action: 'cancel', note: 'E2E cleanup' } },
      { path: '/api/admin/parties/actions.json', body: { id: 'pty_a', action: 'mark-told', notToldAt: 'n1' } },
      { path: '/api/admin/parties/actions.json', body: { id: 'pty_b', action: 'free-time', startIso: '2026-12-08T10:00:00.000Z', shownStartIso: '2026-12-08T10:00:00.000Z', shownVersion: 2 } },
      { path: '/api/admin/to-decide.json', body: { id: 'td_old', action: 'told' } },
      { path: '/api/admin/parties/settings.json', body: { ...base, expectedUpdatedAt: 'u1' } },
    ])
    expect(calls.filter((c) => c.path === '/api/admin/classes/calendar.json')).toHaveLength(3)
    expect(fetch.mock.calls.every(([u]) => new URL(u as string).host === HOST)).toBe(true)
  })
})

describe('--cleanup-only puts the Square read switch back after a killed run', () => {
  it('turns it back on when a test run turned it off, and leaves an owner’s choice alone', async () => {
    const base = settingsInput(configPartySettings())
    const run = async (history: any[]) => {
      const posts: any[] = []
      const fetch = vi.fn(async (url: string, init: any = {}) => {
        const u = new URL(url)
        const body = init.body ? JSON.parse(init.body) : null
        if (body) posts.push({ path: u.pathname, body })
        if (u.pathname === '/api/admin/parties/settings.json' && init.method === 'GET') {
          return res(200, { data: { settings: { ...base, readSquareBookings: false, updatedAt: 'u1', history } } })
        }
        return res(200, { data: { items: [] } })
      })
      const r = await cleanUpPartyLeftovers({ admin: new PreviewClient({ fetch }) }, () => undefined, new Date('2026-11-02T15:00:00Z'))
      return { ...r, posts }
    }
    const byTest = await run([{ before: { ...base, readSquareBookings: true, packages: [...base.packages, testPackage('11021500')] } }])
    expect(byTest.failed).toEqual([])
    expect(byTest.done.at(-1)).toMatch(/turn the Square read back on/)
    expect(byTest.posts).toEqual([{ path: '/api/admin/parties/settings.json', body: { ...base, readSquareBookings: true, expectedUpdatedAt: 'u1' } }])
    const byOwner = await run([{ before: { ...base, readSquareBookings: true } }])
    expect(byOwner.posts).toEqual([])
  })
})

describe('Ctrl-C halts the running scenario before anything is cleaned up', () => {
  it('the scenario’s next call throws, the stop waits for it, then runs its cleanup and the restore; nothing races', async () => {
    const order: string[] = []
    let release!: () => void
    const inFlight = new Promise<void>((r) => { release = r })
    const fetch = vi.fn(async (url: string) => {
      const path = new URL(url).pathname
      order.push(`fetch ${path}`)
      if (path === '/api/slow') await inFlight
      return res(200, { data: {} })
    })
    const halt = new Halt()
    const client = new PreviewClient({ fetch, halt })
    const pending = { current: null as Cleanup | null, halt }
    const handlers: Record<string, (e?: unknown) => void> = {}
    const proc = { on: (e: string, fn: any) => { handlers[e] = fn }, off: () => undefined }
    let exited: number | null = null
    let scenarioError: unknown = null
    onStop({
      proc, pending, log: () => undefined, secrets: [], exit: (c) => { exited = c },
      signOut: async () => { await client.get('/api/restore'); order.push('restored') },
    })
    const results = runScenarios([{
      id: 39, title: 't', plan: ['p'],
      run: async (_c, scope) => {
        scope.cleanup.add('undo', async () => { await client.get('/api/undo'); order.push('undone') })
        await client.get('/api/slow')
        order.push('slow came back')
        try { await client.get('/api/after-stop') } catch (e) { scenarioError = e; throw e }
      },
    }], null, { secrets: [], pending })
    await vi.waitFor(() => expect(order).toContain('fetch /api/slow'))
    handlers.SIGINT()
    expect(halt.stopped).toBe(true)
    await new Promise((r) => setTimeout(r, 10))
    expect(order).not.toContain('undone') // waits for the call in flight
    release()
    expect(await results).toEqual([]) // the runner stops; the stop handler owns the cleanup
    await (pending as any).stopped
    expect(scenarioError).toBeInstanceOf(StoppedError)
    expect(order).toEqual(['fetch /api/slow', 'slow came back', 'fetch /api/undo', 'undone', 'fetch /api/restore', 'restored'])
    expect(exited).toBe(130)
  })
})
