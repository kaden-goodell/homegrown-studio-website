// tests/scripts/sandbox-e2e-staffing.test.ts — the staffing scenarios (41–48) against a fake preview (no network).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { PREVIEW_ORIGIN, PreviewClient, runScenarios, SlotAllocator, type RateGate } from '../../scripts/lib/sandbox-e2e/core'
import { scenarios } from '../../scripts/lib/sandbox-e2e/scenarios'
import { feedPath, icsTime, NO_CREW, parseIcs, staffingScenarios, type StaffingCtx } from '../../scripts/lib/sandbox-e2e/staffing-scenarios'
import { ALL_SCENARIOS, main } from '../../scripts/sandbox-e2e'
import { buildFeed } from '@lib/staffing/ics-feed'

const HOST = new URL(PREVIEW_ORIGIN).host

function res(status: number, body: unknown, headers: Record<string, string> = {}, text?: string): Response {
  return new Response(text ?? JSON.stringify(body), { status, headers: { 'Content-Type': text ? 'text/calendar' : 'application/json', ...headers } })
}

/** A tiny in-memory preview: classes, staffing rows, crew views, calendar links. */
function fakePreview(opts: { withCrew?: boolean } = {}) {
  const team = [
    ...(opts.withCrew === false ? [] : [{ id: 'TMC', name: 'E2E', role: 'crew' }]),
    { id: 'TMK', name: 'Kaden', role: 'owner' },
  ]
  const classes = new Map<string, any>()
  const entries = new Map<string, { needed: number | null; assigned: { staffId: string; name: string }[]; asks: { staffId: string; note: string }[]; sequence: number; seenStart: string | null; seenCancelled: boolean }>()
  const avail = new Map<string, any>()
  const feeds = new Map<string, { staffId: string | null; owner: string | null; live: boolean }>()
  const calls: { method: string; path: string; body: any; headers: Record<string, string> }[] = []
  let n = 0

  const sessionOf = (key: string) => {
    for (const c of classes.values()) for (const s of c.sessions) if (`ses:${s.id}` === key) return { c, s }
    return null
  }
  const entry = (key: string) => {
    if (!entries.has(key)) entries.set(key, { needed: null, assigned: [], asks: [], sequence: 0, seenStart: null, seenCancelled: false })
    return entries.get(key)!
  }
  const eventOf = (key: string) => {
    const f = sessionOf(key)!
    return { key, kind: 'class', title: f.c.content.name, startIso: f.s.startIso, endIso: f.s.endIso, status: f.c.status === 'cancelled' ? 'cancelled' : 'on' }
  }
  /** what a feed read remembers: SEQUENCE up when the time moved or it was cancelled */
  const seen = (key: string) => {
    const e = entry(key), ev = eventOf(key)
    const cancelled = ev.status !== 'on'
    if (e.seenStart && (e.seenStart !== ev.startIso || e.seenCancelled !== cancelled)) e.sequence++
    e.seenStart = ev.startIso
    e.seenCancelled = cancelled
  }
  const rowOf = (key: string) => {
    const e = entry(key)
    const needed = e.needed ?? 1
    const on = e.assigned.length
    return {
      event: eventOf(key), entry: { ...e }, needed,
      state: needed <= 0 ? 'staffed' : on === 0 ? 'none' : on < needed ? 'short' : 'staffed',
      people: team.map((p) => ({ staffId: p.id, name: p.name, asked: e.asks.some((a) => a.staffId === p.id), askNote: e.asks.find((a) => a.staffId === p.id)?.note ?? '', assigned: e.assigned.some((a) => a.staffId === p.id) })),
    }
  }
  const allKeys = () => [...classes.values()].flatMap((c) => c.sessions.map((s: any) => `ses:${s.id}`))
  const ics = (keys: string[]) => buildFeed(keys.map((k) => {
    seen(k)
    const ev = eventOf(k)
    return { uid: `${k}@ourhometownstudio.com`, sequence: entry(k).sequence, startIso: ev.startIso, endIso: ev.endIso, summary: `${ev.status === 'on' ? '' : 'Cancelled · '}${ev.title}`, description: entry(k).assigned.map((a) => a.name).join(', '), status: ev.status === 'on' ? 'CONFIRMED' : 'CANCELLED', url: null }
  }) as any, { name: 'Feed', now: new Date() })

  const fetch = vi.fn(async (url: string, init: any = {}) => {
    const u = new URL(url)
    expect(u.host).toBe(HOST)
    const body = init.body ? JSON.parse(init.body) : null
    const headers = (init.headers ?? {}) as Record<string, string>
    const method = init.method ?? 'GET'
    calls.push({ method, path: u.pathname, body, headers })
    const me = /hg_staff=(\w+)/.exec(headers.Cookie ?? '')?.[1] ?? null
    const p = u.pathname

    if (p === '/api/staff/login.json' && method === 'POST') return res(200, { data: { staff: team } })
    if (p === '/api/staff/login.json' && method === 'DELETE') return res(200, { data: {} }, { 'Set-Cookie': 'hg_staff=; Max-Age=0; Path=/' })
    if (p === '/api/staff/pick.json') return res(200, { data: {} }, { 'Set-Cookie': `hg_staff=${body.staffId}; Path=/` })

    if (p === '/api/admin/classes/classes.json' && body.action === 'create') {
      const id = `cls_${++n}`
      const cls = { id, libraryId: null, status: 'open', updatedAt: `u${n}`, content: body.content, sessions: body.sessions.map((s: any, i: number) => ({ ...s, id: `${id}_s${i}` })), square: { itemId: 'ITEM' } }
      classes.set(id, cls)
      return res(200, { data: { class: cls } })
    }
    if (p === '/api/admin/classes/classes.json' && body.action === 'update') {
      const c = classes.get(body.id)
      c.sessions = body.sessions
      c.updatedAt = `u${++n}`
      return res(200, { data: { class: c } })
    }
    if (p === '/api/admin/classes/classes.json' && body.action === 'cancel') { classes.get(body.id).status = 'cancelled'; return res(200, { data: { class: classes.get(body.id), booked: [] } }) }
    if (p === '/api/admin/classes/bookings.json') return res(200, { data: { class: classes.get(u.searchParams.get('id')!), bookings: [], seatsTaken: {} } })

    if (p === '/api/staff/shifts.json' && method === 'GET') {
      if (!me) return res(401, { error: 'Sign in first.' })
      const a = avail.get(me) ?? { staffId: me, weekly: {}, dates: {}, updatedAt: null }
      const mine = allKeys().filter((k) => entry(k).assigned.some((x) => x.staffId === me)).map(rowOf)
      return res(200, { data: { me: { id: me, name: team.find((t) => t.id === me)!.name }, availability: a, mine, open: [], feed: { has: false } } })
    }
    if (p === '/api/staff/shifts.json' && method === 'POST') {
      if (['assign', 'unassign', 'needed'].includes(body.action)) return res(403, { error: 'Only an owner can put people on a class or party. Ask Catherine or Kaden.' })
      if (body.action === 'availability') {
        const cur = avail.get(me!) ?? { updatedAt: null }
        if ((cur.updatedAt ?? null) !== (body.expectedUpdatedAt ?? null)) return res(409, { error: 'stale', current: cur })
        avail.set(me!, { staffId: me, weekly: body.weekly, dates: body.dates, updatedAt: `a${++n}` })
        return res(200, { data: { availability: avail.get(me!) } })
      }
      const e = entry(body.key)
      e.asks = e.asks.filter((a) => a.staffId !== me)
      if (body.action === 'ask') e.asks.push({ staffId: me!, note: body.note })
      return res(200, { data: { key: body.key, asked: body.action === 'ask' } })
    }
    if (p === '/api/staff/warnings.json') return res(200, { data: { warnings: [{ code: 'party-gap', line: 'Sat · something else' }] } })
    if (p === '/api/staff/feed.json') {
      for (const f of feeds.values()) if (f.staffId === me) f.live = false
      if (method === 'DELETE') return res(200, { data: { stopped: true } })
      const tok = `T${++n}`.padEnd(43, 'x')
      feeds.set(tok, { staffId: me, owner: null, live: true })
      return res(200, { data: { https: `${PREVIEW_ORIGIN}/api/calendar/feed/${tok}.ics`, webcal: `webcal://${HOST}/api/calendar/feed/${tok}.ics` } })
    }
    if (p === '/api/admin/feed.json') {
      if (method === 'DELETE' && body?.staffId) { for (const f of feeds.values()) if (f.staffId === body.staffId) f.live = false; return res(200, { data: { stopped: true } }) }
      for (const f of feeds.values()) if (f.owner) f.live = false
      if (method === 'DELETE') return res(200, { data: { stopped: true } })
      const tok = `O${++n}`.padEnd(43, 'x')
      feeds.set(tok, { staffId: null, owner: headers['X-Admin-Who'], live: true })
      return res(200, { data: { https: `${PREVIEW_ORIGIN}/api/calendar/feed/${tok}.ics` } })
    }
    if (p.startsWith('/api/calendar/feed/')) {
      const f = feeds.get(p.slice('/api/calendar/feed/'.length, -4))
      if (!f || !f.live) return res(404, null, {}, 'Not found')
      const keys = f.owner ? allKeys() : allKeys().filter((k) => entry(k).assigned.some((a) => a.staffId === f.staffId))
      return res(200, null, {}, ics(keys))
    }
    if (p === '/api/admin/staffing.json' && method === 'GET') return res(200, { data: { row: rowOf(u.searchParams.get('key')!) } })
    if (p === '/api/admin/staffing.json' && method === 'POST') {
      const e = entry(body.key)
      if (body.action === 'needed') { e.needed = body.needed; return res(200, { data: { row: rowOf(body.key) } }) }
      const person = team.find((t) => t.id === body.staffId)!
      e.assigned = e.assigned.filter((a) => a.staffId !== person.id)
      if (body.action === 'assign') { e.assigned.push({ staffId: person.id, name: person.name }); e.asks = e.asks.filter((a) => a.staffId !== person.id); seen(body.key) }
      return res(200, { data: { row: rowOf(body.key) } })
    }
    return res(500, { error: `fake: no ${method} ${p}` })
  })
  return { fetch, calls, entries, avail, feeds }
}

function ctxFor(f: ReturnType<typeof fakePreview>): StaffingCtx {
  const noWait = { take: async () => undefined } as unknown as RateGate
  return {
    pub: new PreviewClient({ fetch: f.fetch, gate: noWait }),
    admin: new PreviewClient({ fetch: f.fetch }),
    staff: Object.assign(new PreviewClient({ fetch: f.fetch }), {}),
    crew: new PreviewClient({ fetch: f.fetch }),
    staffPasscode: 'staff-secret-5678',
    gate: noWait,
    square: null,
    slots: new SlotAllocator('2027-02-01'),
    runTag: '1102',
    person: { givenName: 'E2E', familyName: 'Sandbox', email: 'kaden+e2e@ourhometownstudio.com', phone: '(402) 980-2907' },
    settings: {},
    sleep: async () => undefined,
    log: () => undefined,
  }
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('staffing scenarios: the list', () => {
  it('are 41–48, after the class (1–23) and party (24–40) scenarios', () => {
    expect(staffingScenarios.map((s) => s.id)).toEqual([41, 42, 43, 44, 45, 46, 47, 48])
    const ids = ALL_SCENARIOS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual([...ids].sort((a, b) => a - b))
    expect(ids).toEqual(Array.from({ length: 48 }, (_, i) => i + 1))
    expect(ALL_SCENARIOS.slice(-staffingScenarios.length)).toEqual(staffingScenarios)
    expect(ALL_SCENARIOS.slice(0, scenarios.length)).toEqual(scenarios)
  })

  it('--dry-run lists them with their steps, no network', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    expect(await main(['--dry-run', '--only', '41,42,43,44,45,46,47,48'], {})).toBe(0)
    expect(fetch).not.toHaveBeenCalled()
    const out = log.mock.calls.flat().join('\n')
    for (const s of staffingScenarios) expect(out).toContain(`[${s.id}] ${s.title}`)
    expect(out).toContain('tell off')
  })
})

describe('staffing scenarios: helpers', () => {
  it('parseIcs reads folded lines, UID, start, SEQUENCE and STATUS', () => {
    const text = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:ses:abc@ourhometownstudio.com\r\nDTSTART:20261107T110000Z\r\nSEQUENCE:2\r\nSTATUS:CANCELLED\r\nSUMMARY:Cancelled · A very long \r\n title\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n'
    expect(parseIcs(text)).toEqual([{ uid: 'ses:abc@ourhometownstudio.com', start: '20261107T110000Z', sequence: 2, status: 'CANCELLED', summary: 'Cancelled · A very long title' }])
    expect(icsTime('2026-11-07T11:00:00.000Z')).toBe('20261107T110000Z')
  })

  it('feedPath keeps only the path of a link the site gave (fetched on the preview only)', () => {
    expect(feedPath(`${PREVIEW_ORIGIN}/api/calendar/feed/abc.ics`)).toBe('/api/calendar/feed/abc.ics')
    expect(() => feedPath(`${PREVIEW_ORIGIN}/api/admin/x.json`)).toThrow(/Unexpected calendar link/)
  })
})

describe('staffing scenarios against a fake preview', () => {
  it('every scenario passes, cleans up after itself, and messages nobody (tell: false on every assign)', async () => {
    const f = fakePreview()
    const ctx = ctxFor(f)
    // the owner on /staff (scenario 41 reads their own times)
    await ctx.staff.post('/api/staff/pick.json', { passcode: 'x', staffId: 'TMK' })
    const results = await runScenarios(staffingScenarios, ctx, { secrets: ['staff-secret-5678'] })
    for (const r of results) expect({ id: r.id, outcome: r.outcome, detail: r.detail }).toEqual({ id: r.id, outcome: 'PASS', detail: '' })
    const staffingPosts = f.calls.filter((c) => c.path === '/api/admin/staffing.json' && c.method === 'POST' && ['assign', 'unassign'].includes(c.body.action))
    expect(staffingPosts.length).toBeGreaterThan(8)
    for (const c of staffingPosts) expect(c.body.tell).toBe(false)
    // nobody left on anything, no live calendar link, E2E Crew's times as they were
    for (const e of f.entries.values()) expect(e.assigned).toEqual([])
    expect([...f.feeds.values()].filter((x) => x.live)).toEqual([])
    expect(f.avail.get('TMC')?.weekly ?? {}).toEqual({})
    // every class made is cancelled, named E2E <run> Staffing …, at 5 AM
    const made = f.calls.filter((c) => c.body?.action === 'create').map((c) => c.body.content.name)
    for (const name of made) expect(name).toMatch(/^E2E 1102 Staffing /)
    expect(f.calls.filter((c) => c.body?.action === 'cancel')).toHaveLength(made.length)
    // the owner calls say who is acting
    for (const c of f.calls.filter((x) => x.path === '/api/admin/staffing.json' || x.path === '/api/admin/feed.json')) expect(c.headers['X-Admin-Who']).toBe('Kaden')
    // only the preview
    expect(f.calls.length).toBeGreaterThan(0)
  })

  it('without E2E Crew on the team: each staffing scenario is skipped with how to fix it, nothing made', async () => {
    const f = fakePreview({ withCrew: false })
    const results = await runScenarios(staffingScenarios, ctxFor(f), { secrets: [] })
    expect(results.map((r) => r.outcome)).toEqual(Array(8).fill('SKIP'))
    expect(results[0].detail).toBe(NO_CREW)
    expect(f.calls.filter((c) => c.body?.action === 'create')).toHaveLength(0)
    expect(f.calls.filter((c) => c.path === '/api/staff/login.json')).toHaveLength(1) // asked once
  })

  it('a crew that could assign (the site letting a staff POST through) fails scenario 42', async () => {
    const f = fakePreview()
    const real = f.fetch.getMockImplementation()!
    f.fetch.mockImplementation(async (url: string, init: any = {}) => {
      const body = init.body ? JSON.parse(init.body) : null
      if (new URL(url).pathname === '/api/staff/shifts.json' && body?.action === 'assign') return res(200, { data: {} })
      return real(url, init)
    })
    const [r] = await runScenarios(staffingScenarios.filter((s) => s.id === 42), ctxFor(f), { secrets: [] })
    expect(r.outcome).toBe('FAIL')
    expect(r.detail).toMatch(/Crew assigning: expected HTTP 403/)
  })
})
