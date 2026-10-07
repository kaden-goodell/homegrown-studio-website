// tests/scripts/square-tab-schedule.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(process.cwd(), 'scripts/square-tab-schedule.js'), 'utf8')
const START = '2026-10-18T18:00:00.000Z'

function load(fetchImpl: (...a: any[]) => any, cookie = '_js_csrf=tok123; other=1') {
  const root: any = { fetch: vi.fn(fetchImpl), location: { origin: 'https://ourhometownstudio.com' }, document: { cookie } }
  new Function('window', source)(root)
  return root
}
const answer = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) })
const body = (over: Record<string, unknown> = {}) => ({ class_schedule: { start_at: START, duration_minutes: 120, total_capacity: 25, ...over } })

afterEach(() => vi.useRealTimers())

describe('checkStudio (run in a signed-in studio tab)', () => {
  it('asks the studio’s conflicts endpoint, same-origin', async () => {
    const root = load(async () => answer(200, { data: { ok: true, message: 'No booked party in the way.' } }))
    const c = await root.HometownSchedule.checkStudio({ start: START, minutes: 120 })
    expect(root.fetch.mock.calls[0][0]).toBe(
      'https://ourhometownstudio.com/api/staff/conflicts.json?kind=workshop&start=2026-10-18T18%3A00%3A00.000Z&minutes=120',
    )
    expect(root.fetch.mock.calls[0][1]).toMatchObject({ credentials: 'same-origin' })
    expect(c).toMatchObject({ ok: true, start: START, minutes: 120 })
  })

  it('is not ok when the check itself fails', async () => {
    const root = load(async () => answer(503, { error: 'Couldn’t read party bookings. Don’t schedule until this check passes.' }))
    const c = await root.HometownSchedule.checkStudio({ start: START, minutes: 120 })
    expect(c.ok).toBe(false)
    expect(c.message).toMatch(/Don’t schedule/)
  })
})

describe('scheduleInSquare (run in the signed-in Square tab)', () => {
  const clear = () => ({ ok: true, message: 'No booked party in the way.', start: START, minutes: 120, checkedAt: Date.now() })

  it('refuses without a passing check, and says why', async () => {
    const root = load(async () => answer(200, {}))
    const r = await root.HometownSchedule.scheduleInSquare({ clearance: { ok: false, message: 'This class would overlap a booked party' }, body: body() })
    expect(r).toEqual({ done: false, message: 'This class would overlap a booked party' })
    expect(root.fetch).not.toHaveBeenCalled()
  })

  it('refuses a check older than 10 minutes', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-06T15:00:00Z') })
    const clearance = clear()
    vi.setSystemTime(new Date('2026-10-06T15:11:00Z'))
    const root = load(async () => answer(200, {}))
    expect((await root.HometownSchedule.scheduleInSquare({ clearance, body: body() })).done).toBe(false)
    expect(root.fetch).not.toHaveBeenCalled()
  })

  it('refuses when the class differs from what was checked', async () => {
    const root = load(async () => answer(200, {}))
    const r = await root.HometownSchedule.scheduleInSquare({ clearance: clear(), body: body({ duration_minutes: 180 }) })
    expect(r.done).toBe(false)
    expect(r.message).toMatch(/different start or length/)
  })

  it('creates the class with the tab’s CSRF token once cleared', async () => {
    const root = load(async () => answer(200, { class_schedule: { id: 'clssch_new' } }))
    const r = await root.HometownSchedule.scheduleInSquare({ clearance: clear(), body: body() })
    expect(r).toMatchObject({ done: true, scheduleId: 'clssch_new' })
    const [url, init] = root.fetch.mock.calls[0]
    expect(url).toBe('/appointments/api/class-schedules')
    expect(init).toMatchObject({ method: 'POST', credentials: 'include' })
    expect(init.headers['x-csrf-token']).toBe('tok123')
  })

  it('after a create, says how to save the class’s capacity (the snippet can’t reach the studio’s store)', async () => {
    const root = load(async () => answer(200, { class_schedule: { id: 'clssch_new' } }))
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const r = await root.HometownSchedule.scheduleInSquare({ clearance: clear(), body: body() })
    const line = 'Now run: npx tsx scripts/set-event.ts --workshop clssch_new --capacity 25'
    expect(r.message).toContain(line)
    expect(log).toHaveBeenCalledWith(line)
    log.mockRestore()
  })

  const mover = (bookings: unknown[] | null) => async (_u: string, init: any) =>
    init.method === 'GET'
      ? bookings === null ? answer(500, {}) : answer(200, { class_schedule: { id: 'clssch_1', class_bookings: bookings } })
      : answer(200, { class_schedule: { id: 'clssch_1' } })
  const methods = (root: any) => root.fetch.mock.calls.map((c: any[]) => c[1].method)

  it('moves a class with PUT, dropping the empty resource_id Square 404s on', async () => {
    const root = load(mover([]))
    const r = await root.HometownSchedule.scheduleInSquare({ clearance: clear(), body: body({ resource_id: '' }), method: 'PUT', scheduleId: 'clssch_1' })
    expect(r.done).toBe(true)
    expect(methods(root)).toEqual(['GET', 'PUT'])
    const [url, init] = root.fetch.mock.calls[1]
    expect(url).toBe('/appointments/api/class-schedules/clssch_1')
    expect(JSON.parse(init.body).class_schedule).not.toHaveProperty('resource_id')
  })

  it('does not move a class it cannot read', async () => {
    const root = load(mover(null))
    const r = await root.HometownSchedule.scheduleInSquare({ clearance: clear(), body: body(), method: 'PUT', scheduleId: 'clssch_1' })
    expect(r.done).toBe(false)
    expect(r.message).toMatch(/not moving it/)
    expect(methods(root)).toEqual(['GET'])
  })

  it('does not move a class whose bookings Square left out (fails closed)', async () => {
    for (const cs of [{ id: 'clssch_1' }, { id: 'clssch_1', class_bookings: null }, { id: 'clssch_1', class_bookings: { count: 0 } }]) {
      const root = load(async (_u: string, init: any) => (init.method === 'GET' ? answer(200, { class_schedule: cs }) : answer(200, { class_schedule: { id: 'clssch_1' } })))
      const r = await root.HometownSchedule.scheduleInSquare({ clearance: clear(), body: body(), method: 'PUT', scheduleId: 'clssch_1' })
      expect(r).toEqual({ done: false, message: 'Couldn’t read this class’s bookings — not moving it.' })
      expect(methods(root)).toEqual(['GET'])
    }
  })

  it('does not move a class that has bookings', async () => {
    const root = load(mover([{ id: 'b1' }, { id: 'b2' }]))
    const r = await root.HometownSchedule.scheduleInSquare({ clearance: clear(), body: body(), method: 'PUT', scheduleId: 'clssch_1' })
    expect(r.done).toBe(false)
    expect(r.message).toMatch(/2 bookings/)
    expect(methods(root)).toEqual(['GET'])
  })

  it('refuses a clearance with no checkedAt or one from the future', async () => {
    const root = load(async () => answer(200, {}))
    const { checkedAt, ...noStamp } = clear()
    expect((await root.HometownSchedule.scheduleInSquare({ clearance: noStamp, body: body() })).done).toBe(false)
    expect((await root.HometownSchedule.scheduleInSquare({ clearance: { ...clear(), checkedAt: Date.now() + 60_000 }, body: body() })).done).toBe(false)
    expect(root.fetch).not.toHaveBeenCalled()
  })

  it('allows a 9 minute old check and refuses an 11 minute old one', async () => {
    const root = load(async () => answer(200, { class_schedule: { id: 'x' } }))
    expect((await root.HometownSchedule.scheduleInSquare({ clearance: { ...clear(), checkedAt: Date.now() - 9 * 60_000 }, body: body() })).done).toBe(true)
    expect((await root.HometownSchedule.scheduleInSquare({ clearance: { ...clear(), checkedAt: Date.now() - 11 * 60_000 }, body: body() })).done).toBe(false)
  })

  it('is single-use: a second call with the same clearance is refused without a fetch', async () => {
    const root = load(async () => answer(200, { class_schedule: { id: 'x' } }))
    const clearance = clear()
    expect((await root.HometownSchedule.scheduleInSquare({ clearance, body: body() })).done).toBe(true)
    const r = await root.HometownSchedule.scheduleInSquare({ clearance, body: body() })
    expect(r.done).toBe(false)
    expect(root.fetch).toHaveBeenCalledTimes(1)
  })
})
