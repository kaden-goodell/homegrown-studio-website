/**
 * Review (16 Nov 2026): every /api/admin, /api/staff and /api/jobs handler,
 * called with no sign-in cookie and no job key, answers 401/403 and does
 * nothing. A route that is public on purpose is listed below with why.
 */
import { describe, it, expect, vi } from 'vitest'

// Nothing must reach Square, email or texts if a route did forget its check.
vi.mock('@config/providers', () => ({ providers: new Proxy({}, { get: () => new Proxy({}, { get: () => () => { throw new Error('a route reached Square without signing in') } }) }) }))
vi.mock('@lib/quo', () => ({ sendQuoText: async () => { throw new Error('a route texted without signing in') }, quoConfigured: () => false }))
vi.mock('@lib/email', async (orig) => {
  const real = await orig<Record<string, unknown>>()
  return Object.fromEntries(Object.keys(real).map((k) => [k, typeof real[k] === 'function' ? async () => { throw new Error('a route emailed without signing in') } : real[k]]))
})

const ROUTES = import.meta.glob(['/src/pages/api/admin/**/*.ts', '/src/pages/api/staff/**/*.ts', '/src/pages/api/jobs/**/*.ts'])

/** Public on purpose: route → methods, and why. */
const PUBLIC: Record<string, { methods: string[]; why: string }> = {
  '/src/pages/api/admin/login.json.ts': { methods: ['POST', 'GET', 'DELETE'], why: 'signing in (rate-limited, passcode checked)' },
  '/src/pages/api/admin/recover.json.ts': { methods: ['POST', 'GET'], why: 'the emailed one-time recovery link' },
  '/src/pages/api/staff/login.json.ts': { methods: ['POST', 'GET', 'DELETE'], why: 'signing in' },
  '/src/pages/api/admin/classes/photo.json.ts': { methods: ['GET'], why: 'class photos shown on the public class pages, by a 24-character random id (upload is POST, signed in)' },
  '/src/pages/api/staff/pick.json.ts': { methods: ['POST', 'GET'], why: 'choosing who you are after the passcode (cookie-checked inside)' },
}
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

function ctx(file: string, method: string) {
  const path = file.replace('/src/pages', '').replace(/\.ts$/, '').replace(/\[([^\]]+)\]/g, 'x')
  const url = new URL(`https://ourhometownstudio.com${path}?id=x&classId=cls_x&day=2026-12-01`)
  const request = new Request(url, { method, headers: { 'content-type': 'application/json' }, ...(method === 'GET' ? {} : { body: '{}' }) })
  const params = new Proxy({}, { get: () => 'x' })
  const cookies = { get: () => undefined, set: () => undefined, delete: () => undefined, has: () => false }
  return { request, url, params, cookies, clientAddress: '198.51.100.7', locals: {}, redirect: (to: string, s = 302) => new Response(null, { status: s, headers: { location: to } }) }
}

describe('every owner, staff and job route needs signing in', () => {
  const files = Object.keys(ROUTES).sort()
  it('finds the routes', () => expect(files.length).toBeGreaterThan(50))
  for (const file of files) {
    it(file.replace('/src/pages', ''), async () => {
      const mod: any = await ROUTES[file]()
      const open = PUBLIC[file]?.methods ?? []
      for (const m of METHODS) {
        if (typeof mod[m] !== 'function' || open.includes(m)) continue
        let res: Response
        try {
          res = await mod[m](ctx(file, m))
        } catch (err) {
          throw new Error(`${m} ${file} threw instead of refusing: ${err instanceof Error ? err.message : String(err)}`)
        }
        expect([401, 403], `${m} ${file} answered ${res.status} with no sign-in`).toContain(res.status)
      }
    })
  }
})
