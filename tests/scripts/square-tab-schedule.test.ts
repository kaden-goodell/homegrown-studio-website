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

  it('moves a class with PUT, dropping the empty resource_id Square 404s on', async () => {
    const root = load(async () => answer(200, { class_schedule: { id: 'clssch_1' } }))
    const r = await root.HometownSchedule.scheduleInSquare({ clearance: clear(), body: body({ resource_id: '' }), method: 'PUT', scheduleId: 'clssch_1' })
    expect(r.done).toBe(true)
    const [url, init] = root.fetch.mock.calls[0]
    expect(url).toBe('/appointments/api/class-schedules/clssch_1')
    expect(JSON.parse(init.body).class_schedule).not.toHaveProperty('resource_id')
  })
})
