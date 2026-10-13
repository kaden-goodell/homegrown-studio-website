import { describe, it, expect, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import { run } from '../../netlify/functions/guest-seats-background'

const ok = () => new Response('{}', { status: 200 })

describe('guest-seats background function', () => {
  it('asks the site for seats 2..N in order, with the job key', async () => {
    const ask = vi.fn(async () => ok())
    expect(await run('https://ourhometownstudio.com/', 's3cret', { ticket: 'T', seats: 4 }, ask as any)).toEqual({ added: 3, reason: 'done' })
    const calls = ask.mock.calls as any[]
    expect(calls.map((c) => JSON.parse(c[1].body).seat)).toEqual([2, 3, 4])
    expect(calls[0][0]).toBe('https://ourhometownstudio.com/api/jobs/guest-seat.json')
    expect(calls[0][1].headers['x-job-key']).toBe(createHmac('sha256', 's3cret').update('job:guest-seats').digest('hex'))
    expect(JSON.parse(calls[0][1].body).ticket).toBe('T')
  })
  it('stops at a seat the site refused (the site has already texted the owners)', async () => {
    const ask = vi.fn().mockResolvedValueOnce(ok()).mockResolvedValueOnce(new Response('{}', { status: 409 }))
    expect(await run('https://x.test', 's', { ticket: 'T', seats: 4 }, ask as any)).toEqual({ added: 1, reason: 'seat 3: site answered 409' })
    expect(ask).toHaveBeenCalledTimes(2)
  })
  it('tries a seat once more when the site gives no answer', async () => {
    const ask = vi.fn().mockRejectedValueOnce(new Error('reset')).mockResolvedValue(ok())
    expect(await run('https://x.test', 's', { ticket: 'T', seats: 2 }, ask as any)).toEqual({ added: 1, reason: 'done' })
    expect(ask).toHaveBeenCalledTimes(2)
  })
  it('gives up on a seat after two failed tries', async () => {
    const ask = vi.fn(async () => new Response('', { status: 502 }))
    expect(await run('https://x.test', 's', { ticket: 'T', seats: 3 }, ask as any)).toEqual({ added: 0, reason: 'seat 2: no answer' })
    expect(ask).toHaveBeenCalledTimes(2)
  })
  it('does nothing without its settings or with bad input', async () => {
    const ask = vi.fn()
    expect((await run(undefined, 's', { ticket: 'T', seats: 2 }, ask as any)).reason).toBe('not configured')
    expect((await run('https://x.test', undefined, { ticket: 'T', seats: 2 }, ask as any)).reason).toBe('not configured')
    for (const input of [{ seats: 2 }, { ticket: 'T', seats: 1 }, { ticket: 'T', seats: 'x' }, { ticket: 'T', seats: 99 }]) {
      expect((await run('https://x.test', 's', input, ask as any)).reason).toBe('bad input')
    }
    expect(ask).not.toHaveBeenCalled()
  })
})
