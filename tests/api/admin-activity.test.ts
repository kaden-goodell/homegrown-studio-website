// @vitest-environment node
/**
 * DV19 / final crew review I7: the audit log is owners-only. Crew's old
 * /api/staff/audit.json is gone; owners read it as Activity in /admin.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const list = vi.hoisted(() => ({ fn: vi.fn() }))
vi.mock('@lib/audit', () => ({ listAudit: (...a: unknown[]) => list.fn(...a) }))

import { GET } from '@pages/api/admin/activity.json'
import { adminCookie } from '@lib/admin-auth'

const call = (qs = '', signedIn = true) => {
  const url = new URL(`https://x.test/api/admin/activity.json${qs}`)
  return GET({ request: new Request(url, { headers: signedIn ? { cookie: adminCookie().split(';')[0] } : {} }), url } as any)
}
const now = new Date().toISOString()
const ENTRIES = [
  { id: 'au_1', at: now, by: { id: 'sam', name: 'Sam', role: 'crew' }, action: 'class-refund', target: { kind: 'class', id: 'c', label: 'Pottery Sat' }, details: { cents: 8500, reason: 'no-show' } },
  { id: 'au_2', at: now, by: { id: 'jo', name: 'Jo', role: 'crew' }, action: 'checkin.here', target: { kind: 'event', id: 'e', label: 'Candles' } },
  { id: 'au_3', at: now, by: { id: 'cat', name: 'Catherine', role: 'owner' }, action: 'gift-card.minted', target: { kind: 'gift-card', id: 'g', label: 'Megan' }, details: { amountCents: 2500, forWhom: 'Megan' } },
]

beforeEach(() => { vi.stubEnv('ADMIN_PASSCODE', 'owner-secret'); list.fn.mockReset().mockResolvedValue(ENTRIES) })
afterEach(() => vi.unstubAllEnvs())

describe('/api/admin/activity.json', () => {
  it('owners only', async () => {
    expect((await call('', false)).status).toBe(401)
    expect(list.fn).not.toHaveBeenCalled()
  })
  it('crew can no longer read the audit log at /api/staff/audit.json', () => {
    expect(existsSync(resolve(__dirname, '../../src/pages/api/staff/audit.json.ts'))).toBe(false)
  })
  it('plain words, everyone in the period, newest first; filters by person, area and crew', async () => {
    const all = await (await call()).json()
    expect(all.data.rows.map((r: any) => r.what)).toEqual([
      'Refunded $85.00 on Pottery Sat: “no-show”', 'Checkin here: Candles', 'Made a $25.00 gift card for Megan',
    ])
    expect(all.data.people.map((p: any) => p.name)).toEqual(['Catherine', 'Jo', 'Sam'])
    expect(all.data.days).toBe(7)
    expect((await (await call('?area=money')).json()).data.rows.map((r: any) => r.id)).toEqual(['au_1', 'au_3'])
    expect((await (await call('?area=door')).json()).data.rows.map((r: any) => r.id)).toEqual(['au_2'])
    expect((await (await call('?by=sam')).json()).data.rows.map((r: any) => r.id)).toEqual(['au_1'])
    expect((await (await call('?crew=1&area=money')).json()).data.rows.map((r: any) => r.id)).toEqual(['au_1'])
  })
  it('looks back 1, 7, 30 or 90 days (anything else: 7)', async () => {
    await call('?days=30')
    const since30 = list.fn.mock.calls[0][0].since
    expect(since30).toBe(new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10))
    expect((await (await call('?days=5')).json()).data.days).toBe(7)
  })
  it('503 when the log can’t be read', async () => {
    list.fn.mockRejectedValue(new Error('down'))
    expect((await call()).status).toBe(503)
  })
})
