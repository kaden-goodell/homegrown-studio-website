import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { GET } from '@pages/api/admin/preview-messages.json'
import { adminCookie } from '@lib/admin-auth'
import { recordMuted } from '@lib/preview-outbound'

const req = (cookie?: string) => new Request('https://x.test/api/admin/preview-messages.json', { headers: cookie ? { cookie } : {} })
const signedIn = () => adminCookie().split(';')[0]

beforeEach(() => { vi.stubEnv('ADMIN_PASSCODE', 'owner-secret') })
afterEach(() => { vi.unstubAllEnvs() })

describe('GET /api/admin/preview-messages.json', () => {
  it('owners only', async () => {
    expect((await GET({ request: req() } as any)).status).toBe(401)
  })
  it('on the sandbox preview: muted, with what it would have sent', async () => {
    vi.stubEnv('STORE_NAMESPACE', 'preview')
    vi.stubEnv('SQUARE_ENVIRONMENT', 'sandbox')
    vi.stubEnv('CONTEXT', 'branch-deploy')
    await recordMuted({ kind: 'text', to: '+12565550123', body: 'See you at 4' })
    const r = await GET({ request: req(signedIn()) } as any)
    expect(r.status).toBe(200)
    const { data } = await r.json()
    expect(data.muted).toBe(true)
    expect(data.messages[0]).toMatchObject({ kind: 'text', to: '+12565550123', firstLine: 'See you at 4' })
  })
  it('in production: not muted, and lists nothing', async () => {
    vi.stubEnv('STORE_NAMESPACE', '')
    vi.stubEnv('SQUARE_ENVIRONMENT', 'production')
    vi.stubEnv('CONTEXT', 'production')
    const { data } = await (await GET({ request: req(signedIn()) } as any)).json()
    expect(data).toEqual({ muted: false, messages: [] })
  })
})
