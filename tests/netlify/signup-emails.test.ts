import { describe, it, expect, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import { run, withinSendingHours, config } from '../../netlify/functions/signup-emails'

const SITE = 'https://ourhometownstudio.com'
const SECRET = 'a-secret-only-the-site-holds'
// 10:00 AM Central on a Saturday.
const MORNING = new Date('2026-10-10T15:00:00.000Z').getTime()

const answer = (data: Record<string, unknown>, ok = true, status = 200) =>
  ({ ok, status, json: async () => ({ data }) }) as any

describe('the schedule', () => {
  it('runs every half hour', () => {
    expect(config.schedule).toBe('*/30 * * * *')
  })

  it('sends between 8 in the morning and 8 at night, studio time', () => {
    expect(withinSendingHours(new Date('2026-10-10T13:00:00.000Z'))).toBe(true) // 8:00 AM CDT
    expect(withinSendingHours(new Date('2026-10-11T00:59:00.000Z'))).toBe(true) // 7:59 PM CDT
    expect(withinSendingHours(new Date('2026-10-10T12:59:00.000Z'))).toBe(false) // 7:59 AM CDT
    expect(withinSendingHours(new Date('2026-10-11T01:00:00.000Z'))).toBe(false) // 8:00 PM CDT
    // After the clocks change, the same rule in winter time.
    expect(withinSendingHours(new Date('2026-12-05T14:00:00.000Z'))).toBe(true) // 8:00 AM CST
    expect(withinSendingHours(new Date('2026-12-05T13:59:00.000Z'))).toBe(false) // 7:59 AM CST
  })
})

describe('the run', () => {
  it('asks the site once, with the key made from the secret', async () => {
    const ask = vi.fn().mockResolvedValue(answer({ sent: 0, left: 0 }))
    const outcome = await run(SITE, SECRET, () => MORNING, ask)
    expect(ask).toHaveBeenCalledTimes(1)
    const [url, init] = ask.mock.calls[0]
    expect(url).toBe('https://ourhometownstudio.com/api/jobs/signup-emails.json')
    expect(init.method).toBe('POST')
    expect(init.headers['x-job-key']).toBe(createHmac('sha256', SECRET).update('job:signup-emails').digest('hex'))
    expect(outcome).toEqual({ calls: 1, sent: 0, reason: 'done' })
  })

  it('makes the same key the site checks for', async () => {
    process.env.LOOKUP_SIGNING_SECRET = SECRET
    const { jobKey } = await import('@pages/api/jobs/signup-emails.json')
    const ask = vi.fn().mockResolvedValue(answer({ sent: 0, left: 0 }))
    await run(SITE, SECRET, () => MORNING, ask)
    expect(ask.mock.calls[0][1].headers['x-job-key']).toBe(jobKey(SECRET))
    delete process.env.LOOKUP_SIGNING_SECRET
  })

  it('goes round again while people are left and emails are going', async () => {
    const ask = vi
      .fn()
      .mockResolvedValueOnce(answer({ sent: 5, left: 7 }))
      .mockResolvedValueOnce(answer({ sent: 5, left: 2 }))
      .mockResolvedValueOnce(answer({ sent: 2, left: 0 }))
    const outcome = await run(SITE, SECRET, () => MORNING, ask)
    expect(outcome).toEqual({ calls: 3, sent: 12, reason: 'done' })
  })

  it('stops when a round sends nothing, even with people left', async () => {
    const ask = vi.fn().mockResolvedValue(answer({ sent: 0, left: 4 }))
    expect((await run(SITE, SECRET, () => MORNING, ask)).calls).toBe(1)
  })

  it('stops when the site answers with an error', async () => {
    const ask = vi.fn().mockResolvedValue(answer({}, false, 503))
    expect(await run(SITE, SECRET, () => MORNING, ask)).toEqual({ calls: 1, sent: 0, reason: 'site answered 503' })
  })

  it('stops before its time runs out, and leaves the rest for the next run', async () => {
    let clock = MORNING
    const ask = vi.fn().mockImplementation(async () => {
      clock += 7_000
      return answer({ sent: 5, left: 100 })
    })
    const outcome = await run(SITE, SECRET, () => clock, ask)
    expect(outcome.calls).toBe(3)
    expect(outcome.reason).toBe('out of time, more next run')
  })

  it('stays quiet at night', async () => {
    const ask = vi.fn()
    const night = new Date('2026-10-11T04:00:00.000Z').getTime() // 11 PM CDT
    expect(await run(SITE, SECRET, () => night, ask)).toEqual({ calls: 0, sent: 0, reason: 'outside sending hours' })
    expect(ask).not.toHaveBeenCalled()
  })

  it('does nothing without a site address or a secret', async () => {
    const ask = vi.fn()
    expect((await run(undefined, SECRET, () => MORNING, ask)).reason).toBe('not configured')
    expect((await run(SITE, undefined, () => MORNING, ask)).reason).toBe('not configured')
    expect(ask).not.toHaveBeenCalled()
  })

  it('says so when booking is closed', async () => {
    const ask = vi.fn().mockResolvedValue(answer({ bookingOpen: false, sent: 0, left: 0 }))
    expect((await run(SITE, SECRET, () => MORNING, ask)).reason).toBe('booking closed')
  })
})
