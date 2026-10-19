// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const fake = vi.hoisted(() => {
  const data = new Map<string, { value: string; etag: string }>()
  let n = 0
  const state = { down: false, names: [] as string[] }
  const store = {
    async get(key: string) { if (state.down) throw new Error('blobs down'); return data.get(key)?.value ?? null },
    async set(key: string, value: string) { data.set(key, { value, etag: `e${++n}` }) },
    async getWithMeta(key: string) {
      if (state.down) throw new Error('blobs down')
      const hit = data.get(key)
      return { value: hit?.value ?? null, etag: hit?.etag ?? null }
    },
    async setIfMatch(key: string, value: string, etag: string | null, exists: boolean) {
      if (state.down) throw new Error('blobs down')
      const cur = data.get(key)
      if (!exists ? cur : cur?.etag !== etag) return false
      data.set(key, { value, etag: `e${++n}` })
      return true
    },
    async list() { return [...data.keys()] },
  }
  return { data, state, store }
})
vi.mock('@lib/blob-store', () => ({ makeKvStore: (name: string) => { fake.state.names.push(name); return fake.store } }))

import { recordPartyPayment, partyForPayment } from '@lib/parties/party-payments'

beforeEach(() => { fake.data.clear(); fake.state.down = false })

describe('party payments index', () => {
  it('is the kv store "party-payments", key pay-<paymentId>', async () => {
    expect(fake.state.names).toContain('party-payments')
    await recordPartyPayment('PAY1', 'pty_a', 'chg_a')
    expect(JSON.parse(fake.data.get('pay-PAY1')!.value)).toEqual({ partyId: 'pty_a', chargeId: 'chg_a' })
  })

  it('finds the party for a payment; unknown → null', async () => {
    await recordPartyPayment('PAY1', 'pty_a', 'chg_a')
    expect(await partyForPayment('PAY1')).toEqual({ partyId: 'pty_a', chargeId: 'chg_a' })
    expect(await partyForPayment('PAY2')).toBeNull()
  })

  it('is create-only: the same party again is fine, another party is refused and the first stays', async () => {
    expect(await recordPartyPayment('PAY1', 'pty_a', 'chg_a')).toEqual({ kind: 'created', entry: { partyId: 'pty_a', chargeId: 'chg_a' } })
    expect(await recordPartyPayment('PAY1', 'pty_a', 'chg_a')).toEqual({ kind: 'exists', entry: { partyId: 'pty_a', chargeId: 'chg_a' } })
    expect(await recordPartyPayment('PAY1', 'pty_b', 'chg_b')).toEqual({ kind: 'refused', entry: { partyId: 'pty_a', chargeId: 'chg_a' } })
    expect(await partyForPayment('PAY1')).toEqual({ partyId: 'pty_a', chargeId: 'chg_a' })
  })

  it('a read failure throws (never "not a party")', async () => {
    fake.state.down = true
    await expect(partyForPayment('PAY1')).rejects.toThrow()
    await expect(recordPartyPayment('PAY1', 'pty_a', 'chg_a')).rejects.toThrow()
  })
})
