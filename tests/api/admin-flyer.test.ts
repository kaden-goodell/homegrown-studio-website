// @vitest-environment node
// /admin/flyer/<date> (G9): owners print a special day's flyer from the saved settings, QR made here.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { rmSync } from 'node:fs'
import * as route from '@pages/admin/flyer/[date]'
import { adminCookie } from '@lib/admin-auth'
import { getSettingsView, resetStudioDaysCache, saveStudioSettings } from '@lib/studio-settings'

const cookie = () => adminCookie().split(';')[0]
async function open(date: string, signedIn = true) {
  const request = new Request(`https://x.test/admin/flyer/${date}`, { headers: signedIn ? { cookie: cookie() } : {} })
  const res: Response = await (route as any).GET({ request, params: { date }, url: new URL(request.url) })
  return { status: res.status, location: res.headers.get('Location'), type: res.headers.get('Content-Type'), html: res.status === 302 ? '' : await res.text() }
}

beforeEach(() => {
  vi.stubEnv('ADMIN_PASSCODE', 'owner-secret')
  rmSync(`${process.env.BLOB_STORE_FS_DIR}/studio-settings`, { recursive: true, force: true })
  resetStudioDaysCache()
})
afterEach(() => vi.unstubAllEnvs())

describe('/admin/flyer/<date>', () => {
  it('owners only: anyone else goes to the sign-in', async () => {
    expect(await open('2026-11-07', false)).toMatchObject({ status: 302, location: '/admin' })
  })

  it('a special day announced on /admin: its headline, date, hours, the regular hours, and a QR code to Craft Café', async () => {
    const v = await getSettingsView()
    await saveStudioSettings({
      ...v,
      cafeSpecialDays: [...v.cafeSpecialDays, { date: '2026-12-12', opens: '10:00', closes: '16:00', name: 'Holiday market', announce: { headline: 'Holiday Market Day', daysBefore: 14 } }],
    }, { expectedUpdatedAt: v.updatedAt, by: { id: 'owner-catherine', name: 'Catherine' } })
    const r = await open('2026-12-12')
    expect(r.status).toBe(200)
    expect(r.type).toMatch(/text\/html/)
    expect(r.html).toContain('✦ Holiday Market Day ✦')
    expect(r.html).toContain('Saturday, December 12')
    expect(r.html).toContain('<strong>10 AM – 4 PM</strong>')
    expect(r.html).toContain('Regular Craft Café hours are Saturdays 9 AM – 1 PM.')
    expect(r.html).toMatch(/<svg[^>]*>[\s\S]*<path/) // the QR code, drawn here
    expect(r.html).toContain('ourhometownstudio.com/craft-cafe')
    expect(r.html).toContain('onclick="window.print()"')
    expect(r.html).not.toMatch(/api\.qrserver|chart\.googleapis/)
  })

  it('a special day without an announcement uses its name; the config’s grand opening works before any save', async () => {
    expect((await open('2026-11-07')).html).toContain('✦ Grand Opening Day ✦')
    const v = await getSettingsView()
    await saveStudioSettings({ ...v, cafeSpecialDays: [{ date: '2026-12-19', opens: '09:00', closes: '12:00', name: 'Cookie swap' }] }, { expectedUpdatedAt: v.updatedAt, by: { id: 'owner-catherine', name: 'Catherine' } })
    expect((await open('2026-12-19')).html).toContain('✦ Cookie swap ✦')
  })

  it('no special day, or not a date: a plain page with the way back', async () => {
    const none = await open('2026-12-25')
    expect(none.status).toBe(404)
    expect(none.html).toContain('No special day on that date')
    expect(none.html).toContain('href="/admin#more-hours"')
    expect((await open('soon')).status).toBe(404)
  })
})
