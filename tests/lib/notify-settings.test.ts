// @vitest-environment node
// More › Notifications (G5): who gets which owner alert and report.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { searchMock, audit } = vi.hoisted(() => ({ searchMock: vi.fn(), audit: [] as any[] }))
vi.mock('@providers/square/client', () => ({ createSquareClient: () => ({ teamMembers: { search: searchMock } }) }))
vi.mock('@lib/audit', () => ({ recordAudit: vi.fn(async (e: any) => { audit.push(e) }) }))
const site = vi.hoisted(() => ({ context: 'dev' as string }))
vi.mock('@lib/deploy-context', () => ({ deployContext: () => site.context }))

import * as route from '@pages/api/admin/notify.json'
import { adminCookie } from '@lib/admin-auth'
import { _resetAdminPasscodeForTests } from '@lib/admin-passcode'
import { alertOwners } from '@lib/owner-alert'
import { _resetNotifyForTests, emailsFor, NOTIFY_MESSAGES, notifyView, recipientsFor, saveNotify } from '@lib/notify-settings'
import { _resetStaffListForTests, addPerson, editPerson, setWorking, staffListForOwners } from '@lib/staff-directory'

const TEAM = [
  { id: 'TM1', givenName: 'Kaden', familyName: 'Goodell', status: 'ACTIVE', isOwner: true, emailAddress: 'kaden@example.com', phoneNumber: '+14025550101' },
  { id: 'TM4', givenName: 'Catherine', familyName: 'Goodell', status: 'ACTIVE', isOwner: false, emailAddress: 'cat@example.com', phoneNumber: '+12565550104' },
  { id: 'TM2', givenName: 'Jessica', familyName: 'Lane', status: 'ACTIVE', isOwner: false, emailAddress: 'jess@example.com', phoneNumber: '+12565550102' },
]
const BY = { id: 'owner-catherine', name: 'Catherine' }
const ALL = (ids: string[]) => ({ 'owner-texts': ids, 'booking-alerts': ids, 'warnings-email': ids, 'tax-report': ids, archive: ids })

async function call(method: 'GET' | 'POST', body?: unknown, cookie: string | null = adminCookie().split(';')[0]) {
  const request = new Request('https://x.test/api/admin/notify.json', {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Admin-Who': 'Catherine', ...(cookie ? { cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const res = await (method === 'GET' ? route.GET : route.POST)({ request } as any)
  return { status: res.status, body: await res.json() }
}

beforeEach(async () => {
  site.context = 'dev'
  vi.stubEnv('ADMIN_PASSCODE', 'owner-secret')
  vi.stubEnv('OWNER_ALERT_NUMBERS', '+14029802907, +12565550000')
  vi.stubEnv('ARCHIVE_TO', '')
  await _resetAdminPasscodeForTests()
  await _resetNotifyForTests()
  await _resetStaffListForTests()
  searchMock.mockReset()
  searchMock.mockResolvedValue({ teamMembers: TEAM })
  audit.length = 0
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('until an owner saves Notifications: the site setup, exactly as before', () => {
  it('owner emails, alert phones; the tax split and the archive go to BOTH owners (stopgap)', async () => {
    expect(await emailsFor('warnings-email')).toBe('kaden@ourhometownstudio.com, catherine@ourhometownstudio.com')
    expect(await emailsFor('booking-alerts')).toBe('kaden@ourhometownstudio.com, catherine@ourhometownstudio.com')
    expect(await emailsFor('tax-report')).toBe('kaden@ourhometownstudio.com, catherine@ourhometownstudio.com')
    expect(await emailsFor('archive')).toBe('kaden@ourhometownstudio.com, catherine@ourhometownstudio.com')
    expect(await recipientsFor('owner-texts', 'text')).toEqual(['+14029802907', '+12565550000'])
    vi.stubEnv('ARCHIVE_TO', 'records@example.com')
    expect(await emailsFor('archive')).toBe('records@example.com')
    expect(searchMock).not.toHaveBeenCalled() // never starts the staff list from Square
  })
})

describe('saved on the screen: each row goes to the picked owners’ staff list email and mobile', () => {
  beforeEach(async () => { await staffListForOwners() }) // the list starts (Kaden and Catherine are owners)

  it('picks per row; the site setup is only the fallback', async () => {
    const rows = { ...ALL(['TM1', 'TM4']), 'tax-report': ['TM4'], 'owner-texts': ['TM4'] }
    const saved = await saveNotify(rows, BY, null)
    expect(saved.changed).toEqual(['owner-texts', 'booking-alerts', 'warnings-email', 'tax-report', 'archive'])
    expect(await emailsFor('tax-report')).toBe('cat@example.com')
    expect(await emailsFor('archive')).toBe('kaden@example.com, cat@example.com')
    expect(await recipientsFor('owner-texts', 'text')).toEqual(['+12565550104'])
    expect(await recipientsFor('booking-alerts', 'text')).toEqual(['+14025550101', '+12565550104'])
    // Crew are never picked.
    await expect(saveNotify({ ...rows, archive: ['TM2'] }, BY, saved.updatedAt)).rejects.toThrow(NOTIFY_MESSAGES.notOwner)
  })

  it('removing an owner: their rows fall to whoever is left; when all picked owners left, every owner', async () => {
    const dana = await addPerson({ givenName: 'Dana', familyName: 'Reyes', role: 'owner', phone: '256-555-0123', email: 'dana@example.com' }, BY)
    await saveNotify({ ...ALL(['TM1', 'TM4']), 'tax-report': ['TM1', dana.id], archive: [dana.id] }, BY, null)
    // M1: a brand-new owner's address waits a day for the records archive (the site setup gets it meanwhile, and the screen says when it starts).
    expect(await emailsFor('archive')).toBe('kaden@ourhometownstudio.com, catherine@ourhometownstudio.com')
    expect((await notifyView()).rows.find((r) => r.row === 'archive')!.held).toEqual([{ name: 'Dana', until: expect.any(String) }])
    expect(await emailsFor('tax-report')).toBe('kaden@example.com, dana@example.com') // only the archive waits
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 24 * 3600_000 + 60_000)
    expect(await emailsFor('archive')).toBe('dana@example.com')
    expect((await notifyView()).rows.find((r) => r.row === 'archive')!.held).toEqual([])
    vi.useRealTimers()
    await setWorking(dana.id, false, BY)
    expect(await emailsFor('tax-report')).toBe('kaden@example.com')
    expect(await emailsFor('archive')).toBe('kaden@example.com, cat@example.com')
  })

  it('M1: an owner’s changed email waits a day for the archive; a phone change or a crew edit doesn’t', async () => {
    await saveNotify(ALL(['TM1', 'TM4']), BY, null)
    expect(await emailsFor('archive')).toBe('kaden@example.com, cat@example.com')
    const cat = (await staffListForOwners()).people.find((x) => x.id === 'TM4')!
    const moved = await editPerson('TM4', { givenName: 'Catherine', familyName: 'Goodell', role: 'owner', phone: '+12565550104', email: 'new-cat@example.com' }, BY, (cat as any).updatedAt)
    expect(await emailsFor('archive')).toBe('kaden@example.com')
    expect(await emailsFor('warnings-email')).toBe('kaden@example.com, new-cat@example.com')
    await editPerson('TM4', { givenName: 'Catherine', familyName: 'Goodell', role: 'owner', phone: '+12565550199', email: 'new-cat@example.com' }, BY, moved.updatedAt)
    expect(((await staffListForOwners()).people.find((x) => x.id === 'TM4') as any).contactSince).toBe(moved.contactSince)
  })

  it('an owner with no mobile: texts fall back to the site’s numbers; an email row with nobody to email is refused', async () => {
    const people = (await staffListForOwners()).people
    for (const id of ['TM1', 'TM4']) {
      const p = people.find((x) => x.id === id)!
      await editPerson(id, { givenName: p.givenName, familyName: p.familyName, role: 'owner', phone: '', email: id === 'TM4' ? '' : p.email ?? '' }, BY, (p as any).updatedAt)
    }
    await expect(saveNotify({ ...ALL(['TM1', 'TM4']), 'tax-report': ['TM4'] }, BY, null)).rejects.toThrow(NOTIFY_MESSAGES.noEmail('tax-report'))
    await saveNotify(ALL(['TM1', 'TM4']), BY, null)
    expect(await recipientsFor('owner-texts', 'text')).toEqual(['+14029802907', '+12565550000'])
    expect(await emailsFor('warnings-email')).toBe('kaden@example.com')
  })

  it('refuses an empty row and a save from an older screen', async () => {
    await expect(saveNotify({ ...ALL(['TM1']), archive: [] }, BY, null)).rejects.toThrow(NOTIFY_MESSAGES.pickSomeone('archive'))
    const first = await saveNotify(ALL(['TM1']), BY, null)
    await expect(saveNotify(ALL(['TM4']), BY, null)).rejects.toThrow(NOTIFY_MESSAGES.stale)
    expect((await saveNotify(ALL(['TM4']), BY, first.updatedAt)).changed).toHaveLength(5)
  })

  it('the screen view: who is picked, where it goes and whether that is set here or the site setup (phones as the last four)', async () => {
    let v = await notifyView()
    expect(v.saved).toBe(false)
    expect(v.rows.find((r) => r.row === 'owner-texts')).toMatchObject({ picked: ['TM1', 'TM4'], goesTo: { text: ['…2907', '…0000'] }, from: { text: 'setup' } })
    await saveNotify(ALL(['TM4']), BY, null)
    v = await notifyView()
    expect(v).toMatchObject({ saved: true, by: 'Catherine', noList: false })
    expect(v.rows.find((r) => r.row === 'booking-alerts')).toMatchObject({ picked: ['TM4'], goesTo: { text: ['…0104'], email: ['cat@example.com'] }, from: { text: 'screen', email: 'screen' } })
  })

  it('alertOwners texts the picked owners (Quo mocked)', async () => {
    vi.stubEnv('QUO_API_KEY', 'k')
    vi.stubEnv('QUO_FROM_NUMBER', '+12564641710')
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await saveNotify({ ...ALL(['TM1', 'TM4']), 'owner-texts': ['TM4'], 'booking-alerts': ['TM1'] }, BY, null)
    expect(await alertOwners('Something needs you')).toEqual({ attempted: 1, sent: 1 })
    expect(JSON.parse((fetchMock.mock.calls[0] as any)[1].body).to).toEqual(['+12565550104'])
    await alertOwners('New booking', 'booking-alerts')
    expect(JSON.parse((fetchMock.mock.calls[1] as any)[1].body).to).toEqual(['+14025550101'])
  })
})

describe('/api/admin/notify.json', () => {
  it('owners only; GET the view; POST saves, audits which rows (never contact details); R41 refuses', async () => {
    expect((await call('GET', undefined, null)).status).toBe(401)
    expect((await call('POST', { rows: ALL(['TM1']) }, null)).status).toBe(401)
    const before = await call('GET')
    expect(before.body.data).toMatchObject({ noList: true, readOnly: false })
    expect((await call('POST', { rows: ALL(['TM1']), expectedUpdatedAt: null })).body).toEqual({ error: NOTIFY_MESSAGES.noList })
    await staffListForOwners()
    const saved = await call('POST', { rows: { ...ALL(['TM1', 'TM4']), 'tax-report': ['TM4'] }, expectedUpdatedAt: null })
    expect(saved.status).toBe(200)
    expect(audit).toEqual([expect.objectContaining({ action: 'notify.saved', details: { changed: expect.stringContaining('Monthly tax split') } })])
    expect(JSON.stringify(audit)).not.toContain('@example.com')
    expect((await call('POST', { rows: ALL(['TM1']), expectedUpdatedAt: null })).body).toMatchObject({ stale: true })
    site.context = 'deploy-preview'
    expect((await call('GET')).body.data.readOnly).toBe(true)
    expect((await call('POST', { rows: ALL(['TM1']), expectedUpdatedAt: saved.body.data.updatedAt })).status).toBe(503)
  })
})
