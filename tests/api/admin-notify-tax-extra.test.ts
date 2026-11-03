// @vitest-environment node
// More › Notifications › "Also send the monthly tax split to" (final review I7): validated, audited, owners told.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({ audit: [] as any[], told: [] as any[], site: 'dev' }))
vi.mock('@lib/audit', () => ({ recordAudit: vi.fn(async (e: any) => { h.audit.push(e) }) }))
vi.mock('@lib/deploy-context', () => ({ deployContext: () => h.site }))
vi.mock('@lib/owner-notice', async (orig) => ({ ...(await orig<any>()), tellOwners: vi.fn(async (x: any) => { h.told.push(x); return { emails: 2, texts: 2 } }) }))

import * as route from '@pages/api/admin/notify.json'
import { adminCookie } from '@lib/admin-auth'
import { _resetAdminPasscodeForTests } from '@lib/admin-passcode'
import { _resetNotifyForTests } from '@lib/notify-settings'
import { saveTaxExtra } from '@lib/tax-extra'

async function call(method: 'GET' | 'POST', body?: unknown) {
  const request = new Request('https://x.test/api/admin/notify.json', {
    method, headers: { 'Content-Type': 'application/json', 'X-Admin-Who': 'Catherine', cookie: adminCookie().split(';')[0] },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const res = await (method === 'GET' ? route.GET : route.POST)({ request } as any)
  return { status: res.status, body: await res.json() }
}

beforeEach(async () => {
  h.site = 'dev'
  vi.stubEnv('ADMIN_PASSCODE', 'owner-secret')
  await _resetAdminPasscodeForTests()
  await _resetNotifyForTests()
  await saveTaxExtra('', { id: 'o', name: 'x' })
  h.audit.length = 0
  h.told.length = 0
})
afterEach(() => vi.unstubAllEnvs())

describe('Also send the monthly tax split to', () => {
  it('saves a checked address that starts a day later, audits it and tells every owner; GET shows it', async () => {
    const r = await call('POST', { action: 'tax-extra', email: ' Chris@CPA.example ' })
    expect(r.status).toBe(200)
    expect(r.body.data).toMatchObject({ changed: true, taxExtra: { email: 'chris@cpa.example', startsAt: expect.any(String) } })
    expect(h.audit).toEqual([expect.objectContaining({ action: 'notify.tax-extra', details: { from: 'nobody', to: 'chris@cpa.example' } })])
    expect(h.told[0].line).toMatch(/said it was Catherine set the monthly tax split to also go to chris@cpa\.example/)
    expect((await call('GET')).body.data.taxExtra.email).toBe('chris@cpa.example')
    // The same again: nothing changes, nobody is told twice.
    expect((await call('POST', { action: 'tax-extra', email: 'chris@cpa.example' })).body.data.changed).toBe(false)
    expect(h.told).toHaveLength(1)
    const off = await call('POST', { action: 'tax-extra', email: '' })
    expect(off.body.data.taxExtra).toEqual({ email: '', startsAt: null })
    expect(h.told[1].line).toMatch(/stopped sending the monthly tax split to chris@cpa\.example/)
  })

  it('refuses a bad address or two at once; a test site can’t change it', async () => {
    expect(await call('POST', { action: 'tax-extra', email: 'chris@' })).toMatchObject({ status: 400, body: { field: 'taxExtra' } })
    expect((await call('POST', { action: 'tax-extra', email: 'a@b.co, c@d.co' })).status).toBe(400)
    h.site = 'deploy-preview'
    expect((await call('POST', { action: 'tax-extra', email: 'a@b.co' })).status).toBe(503)
    expect(h.audit).toHaveLength(0)
  })
})
