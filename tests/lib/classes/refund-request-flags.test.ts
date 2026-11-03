// @vitest-environment node
/**
 * Final concurrency review I-3: "who won" flags set inside a CAS update
 * callback must be reset on every try. Before: the first try set the flag,
 * its write lost (the webhook finished the same request meanwhile), the retry
 * saw "done"/"emailed" and left it — but the flag stayed true, so both the
 * webhook and the request's own finish sent the refund email.
 *
 * The store double enforces CAS: a write with a stale etag loses. `racer`
 * lets a test slip a competing write in between one caller's read and write.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mem = vi.hoisted(() => {
  const data = new Map<string, { value: string; v: number }>()
  const state = { racer: null as null | (() => void) }
  return { data, state }
})

vi.mock('@lib/blob-store', () => ({
  makeKvStore: () => ({
    async get(k: string) { return mem.data.get(k)?.value ?? null },
    async set(k: string, v: string) { const cur = mem.data.get(k); mem.data.set(k, { value: v, v: (cur?.v ?? 0) + 1 }) },
    async getWithMeta(k: string) { const cur = mem.data.get(k); return { value: cur?.value ?? null, etag: cur ? String(cur.v) : null } },
    async setIfMatch(k: string, v: string, etag: string | null) {
      const race = mem.state.racer
      if (race) { mem.state.racer = null; race() }
      const cur = mem.data.get(k)
      if ((cur ? String(cur.v) : null) !== etag) return false
      mem.data.set(k, { value: v, v: (cur?.v ?? 0) + 1 })
      return true
    },
    async list() { return [...mem.data.keys()] },
  }),
}))

import {
  claimRequestEmail, createRefundRequest, listRefundRequests, markRequestDone, type SavedRefundRequest,
} from '@lib/classes/refund-requests'

function req(id: string): SavedRefundRequest {
  const at = new Date().toISOString()
  return {
    id, inputHash: 'h', classId: 'cls1', bookingId: 'bk1', paymentId: 'pay1', kind: 'custom', freeSeat: false, reason: '',
    by: { id: 'o', name: 'Owner' }, role: 'owner', lines: [{ id: 'l1', cents: 1000 }], totalCents: 1000, prior: 0, rawKey: 'k',
    failures: 0, idempotencyKey: 'key', status: 'sent', squareRefundId: 'r1', answered: false, createdAt: at, updatedAt: at,
  }
}

/** Another writer finishing the same request between our read and our write. */
function otherWriter(fn: (r: SavedRefundRequest) => SavedRefundRequest) {
  mem.state.racer = () => {
    const [k, cur] = [...mem.data.entries()][0]
    const list = JSON.parse(cur.value) as SavedRefundRequest[]
    mem.data.set(k, { value: JSON.stringify(list.map(fn)), v: cur.v + 1 })
  }
}

describe('refund request flags under a lost CAS try (I-3)', () => {
  beforeEach(() => { mem.data.clear(); mem.state.racer = null })

  it('markRequestDone: only the write that landed reports it flipped', async () => {
    await createRefundRequest(req('rq1'))
    otherWriter((r) => ({ ...r, status: 'done', doneAt: new Date().toISOString() }))
    expect(await markRequestDone('cls1', 'bk1', 'rq1', 'r1')).toBe(false)
    // and a plain first finish still flips
    await createRefundRequest({ ...req('rq2') })
    expect(await markRequestDone('cls1', 'bk1', 'rq2', 'r1')).toBe(true)
  })

  it('claimRequestEmail: the webhook and the request’s own finish never both send', async () => {
    await createRefundRequest(req('rq1'))
    otherWriter((r) => ({ ...r, emailedAt: new Date().toISOString() }))
    expect(await claimRequestEmail('cls1', 'bk1', 'rq1')).toBe(false)
    expect((await listRefundRequests('cls1', 'bk1'))[0].emailedAt).toBeTruthy()
  })

  it('a lost try is retried (not given up) and then wins when nothing else changed it', async () => {
    await createRefundRequest(req('rq1'))
    // the competitor only touches an unrelated field: our retry still claims the email
    otherWriter((r) => ({ ...r, answered: true }))
    expect(await claimRequestEmail('cls1', 'bk1', 'rq1')).toBe(true)
  })
})
