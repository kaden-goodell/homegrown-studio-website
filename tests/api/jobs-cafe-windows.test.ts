// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mocks = vi.hoisted(() => ({ get: vi.fn(), upsert: vi.fn(), email: vi.fn(), context: 'production' as string }))
vi.mock('@lib/email', () => ({ sendEmail: mocks.email }))
vi.mock('@lib/deploy-context', () => ({ deployContext: () => mocks.context }))
vi.mock('@lib/settings-effects', async (orig) => ({
  ...(await orig<typeof import('@lib/settings-effects')>()),
  cafeSquareDeps: () => ({ client: { catalog: { object: { get: mocks.get, upsert: mocks.upsert } } }, itemId: 'CAFE', sandbox: false }),
}))

import * as route from '@pages/api/jobs/cafe-windows.json'
import { rollCafeWindows } from '@lib/cafe-roll'
import { cafeWritesAllowed } from '@lib/settings-effects'
import { resetStudioDaysCache } from '@lib/studio-settings'
import { windowsFor } from '@lib/cafe-windows'
import { CONFIG_STUDIO_DAYS } from '@config/studio-days'
import { rmSync } from 'node:fs'

const NOW = new Date('2026-11-01T06:15:00Z')
const item = (programDates: string) => ({ object: { id: 'CAFE', itemData: { name: 'Craft Café' }, customAttributeValues: { programDates: { stringValue: programDates } } } })

beforeEach(() => {
  rmSync(`${process.env.BLOB_STORE_FS_DIR}/class-alerts`, { recursive: true, force: true })
  resetStudioDaysCache()
  mocks.context = 'production'
  mocks.get.mockReset().mockResolvedValue(item('old'))
  mocks.upsert.mockReset().mockImplementation(async (r: any) => ({ catalogObject: r.object }))
  mocks.email.mockReset().mockResolvedValue({ sent: true })
  vi.stubEnv('LOOKUP_SIGNING_SECRET', 'job-secret')
})
afterEach(() => vi.unstubAllEnvs())

describe('nightly Craft Café roll-forward (R38)', () => {
  it('writes the next windows from the saved settings when Square’s differ', async () => {
    const r = await rollCafeWindows(NOW)
    expect(r.status).toBe('updated')
    expect(mocks.upsert.mock.calls[0][0].object.customAttributeValues.programDates.stringValue).toBe(windowsFor(CONFIG_STUDIO_DAYS, '2026-11-01'))
  })
  it('writes nothing when Square already has them', async () => {
    mocks.get.mockResolvedValue(item(windowsFor(CONFIG_STUDIO_DAYS, '2026-11-01')))
    expect((await rollCafeWindows(NOW)).status).toBe('unchanged')
    expect(mocks.upsert).not.toHaveBeenCalled()
  })
  it('a failure emails the owners once; a good night clears it so the next failure emails again', async () => {
    mocks.upsert.mockRejectedValue(new Error('Square down'))
    expect(await rollCafeWindows(NOW)).toMatchObject({ status: 'failed', emailed: true })
    expect(await rollCafeWindows(NOW)).toMatchObject({ status: 'failed', emailed: false })
    expect(mocks.email).toHaveBeenCalledTimes(1)
    expect(mocks.email.mock.calls[0][0].subject).toBe('⚠ Craft Café hours didn’t update in Square')
    mocks.upsert.mockImplementation(async (r: any) => ({ catalogObject: r.object }))
    expect((await rollCafeWindows(NOW)).status).toBe('updated')
    mocks.upsert.mockRejectedValue(new Error('Square down'))
    expect((await rollCafeWindows(NOW)).emailed).toBe(true)
  })
  it('R39: never from local dev or a preview (unless CAFE_WINDOWS_WRITE=1)', async () => {
    for (const c of ['dev', 'branch-deploy', 'deploy-preview', 'unknown']) {
      mocks.context = c
      expect(cafeWritesAllowed()).toBe(false)
      expect((await rollCafeWindows(NOW)).status).toBe('not-live')
    }
    expect(mocks.get).not.toHaveBeenCalled()
    vi.stubEnv('CAFE_WINDOWS_WRITE', '1')
    expect(cafeWritesAllowed()).toBe(true)
  })
  it('the job route needs the job key', async () => {
    const call = (key?: string) => route.POST({ request: new Request('https://x.test/api/jobs/cafe-windows.json', { method: 'POST', headers: key ? { 'x-job-key': key } : {} }) } as any)
    expect((await call()).status).toBe(401)
    expect((await call('nope')).status).toBe(401)
    const ok = await call(route.cafeWindowsJobKey('job-secret'))
    expect(ok.status).toBe(200)
    expect((await ok.json()).data.status).toBe('updated')
  })
})
