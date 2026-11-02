import { describe, it, expect } from 'vitest'
import { staffingReply, STORE_DOWN } from '@lib/staffing/http'
import { StaffingError, StaleError } from '@lib/staffing/errors'
import { NO_TEST_STORE, TestSiteStoreError } from '@lib/classes/test-site-guard'

const run = async (fn: () => Promise<any>) => {
  const res = await staffingReply(fn)
  return { status: res.status, body: await res.json() }
}

describe('staffingReply', () => {
  it('data and an optional warning', async () => {
    expect(await run(async () => ({ data: { a: 1 }, warning: 'Saved. The text didn’t go.' }))).toEqual({ status: 200, body: { data: { a: 1 }, warning: 'Saved. The text didn’t go.' } })
  })
  it('stale → 409 with what is saved now', async () => {
    expect(await run(async () => { throw new StaleError('Someone else just changed it.', { x: 1 }) })).toEqual({ status: 409, body: { error: 'Someone else just changed it.', stale: true, current: { x: 1 } } })
  })
  it('a staffing refusal keeps its status and sentence', async () => {
    expect(await run(async () => { throw new StaffingError(403, 'No.') })).toEqual({ status: 403, body: { error: 'No.' } })
  })
  it('R41: a test site with no store of its own gets the plain sentence, not a 500 (I5)', async () => {
    expect(await run(async () => { throw new TestSiteStoreError() })).toEqual({ status: 503, body: { error: NO_TEST_STORE } })
  })
  it('anything else is a 503 with no internals', async () => {
    expect(await run(async () => { throw new Error('blob ECONNRESET at 10.0.0.1') })).toEqual({ status: 503, body: { error: STORE_DOWN } })
  })
})
