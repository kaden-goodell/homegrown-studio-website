// @vitest-environment node
/**
 * "Need to move or cancel?" on the host page (final customer review I4; D2:
 * parties stay request-only): the request is saved on the party, the owners
 * get one text, it waits in To decide, and nothing about the party changes.
 * Real party store (temp dir); texts are fakes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const alertOwners = vi.hoisted(() => vi.fn(async () => ({ attempted: 1, sent: 1 })))
vi.mock('@lib/owner-alert', () => ({ alertOwners }))
vi.mock('@lib/rate-limit', () => ({ rateLimited: () => false }))

import { createPartyRecord, getPartyRecord, type PartyRecord } from '@lib/party-store'
import { POST } from '@pages/api/party/change-request.json'
import { GET as roster } from '@pages/api/party/roster.json'
import { listToDecide, decide } from '@lib/classes/to-decide'

const NOW = new Date('2026-11-02T15:00:00.000Z')
let n = 0
async function party(over: Partial<PartyRecord> = {}): Promise<PartyRecord> {
  const id = `pty_chg${String(++n).padStart(13, '0')}`
  const rec: PartyRecord = {
    bookingId: id, hostToken: 'host-key', craftName: 'Suncatchers', startIso: '2026-11-21T20:00:00.000Z', durationMinutes: 90,
    hostName: 'Stefanie Justice', hostEmail: 'stef@example.com', hostPhone: '2565550100', guestCount: 10, title: null, dropOff: false,
    createdAt: NOW.toISOString(), source: 'ours', status: 'booked', endIso: '2026-11-21T21:30:00.000Z', payToken: 'pay-key', calendarSeq: 0,
    items: [{ id: 'itm_1', kind: 'package', refId: 'pkg_whole', label: 'Whole studio', qty: 1, cents: 30000, chargeId: 'chg_1' } as any], charges: [], refunds: [], ...over,
  }
  await createPartyRecord(rec)
  return rec
}
const ask = async (b: Record<string, unknown>) => {
  const res = await POST({ request: new Request('http://localhost/api/party/change-request.json', { method: 'POST', body: JSON.stringify(b) }), clientAddress: '10.1.1.1' } as any)
  return { status: res.status, json: await res.json() }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  alertOwners.mockClear()
})
afterEach(() => vi.useRealTimers())

describe('party move/cancel requests (request-only)', () => {
  it('saves the request, texts the owners once, shows in To decide, and changes nothing else', async () => {
    const p = await party()
    const res = await ask({ bookingId: p.bookingId, key: 'host-key', want: 'cancel', note: 'Family emergency' })
    expect(res.status).toBe(200)
    const rec = (await getPartyRecord(p.bookingId))!
    expect(rec.changeRequests).toEqual([{ at: NOW.toISOString(), want: 'cancel', note: 'Family emergency', told: true }])
    expect(rec.status).toBe('booked')
    expect(rec.startIso).toBe(p.startIso)
    expect(alertOwners).toHaveBeenCalledTimes(1)
    expect(String((alertOwners.mock.calls[0] as unknown[])[0])).toMatch(/Stefanie Justice asked to cancel their party on .+“Family emergency”\. Open \/admin › To decide/)

    // A double tap is one request, one text.
    await ask({ bookingId: p.bookingId, key: 'host-key', want: 'cancel', note: 'Family emergency' })
    expect((await getPartyRecord(p.bookingId))!.changeRequests).toHaveLength(1)
    expect(alertOwners).toHaveBeenCalledTimes(1)

    const { items } = await listToDecide(NOW)
    const item = items.find((i) => i.kind === 'party-change-request' && i.detail.partyId === p.bookingId)!
    expect(item).toMatchObject({ title: 'Host asked to cancel', hint: 'Call or text them, sort it out from the party, then tap Done' })
    expect(item.head).toMatch(/^Stefanie asked to cancel their party on .+, 19 days before it\. Their note: “Family emergency”$/)
    await decide(item.id, 'sorted', {}, { id: 'cat', name: 'Catherine' })
    const after = await listToDecide(NOW)
    expect(after.items.find((i) => i.id === item.id)?.done).toBe('Done')
  })

  it('a wrong key, a cancelled or past party, or no choice is refused plainly', async () => {
    const p = await party()
    expect((await ask({ bookingId: p.bookingId, key: 'nope', want: 'move' })).status).toBe(404)
    expect((await ask({ bookingId: p.bookingId, key: 'host-key' })).json.error).toBe('Choose whether you want to move it, cancel it or something else.')
    expect((await ask({ bookingId: p.bookingId, key: 'host-key', want: 'other', note: '' })).json.error).toBe('Tell us a little about what you need.')
    const gone = await party({ status: 'cancelled' })
    expect((await ask({ bookingId: gone.bookingId, key: 'host-key', want: 'move' })).status).toBe(409)
    expect(alertOwners).not.toHaveBeenCalled()
  })

  it('the host page gets the policy line and the last request', async () => {
    const p = await party()
    await ask({ bookingId: p.bookingId, key: 'host-key', want: 'move', note: '' })
    const res = await roster({ url: new URL(`http://localhost/api/party/roster.json?party=${p.bookingId}&key=host-key`) } as any)
    const { party: shown } = (await res.json()).data
    expect(shown.refundLine).toMatch(/^Full refund until /)
    expect(shown.changeRequest).toEqual({ at: NOW.toISOString(), want: 'move' })
    expect(shown.canAskToChange).toBe(true)
  })
})
