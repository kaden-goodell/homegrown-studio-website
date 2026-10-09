import { describe, it, expect, vi, afterEach } from 'vitest'
import { cookieFromCurl, csrfFromCookie, checkSession } from '@lib/square-dashboard'

const COOKIE = 'L=abc; _js_csrf=tok123; _savt=xyz'

describe('cookieFromCurl', () => {
  it('reads -b from a Chrome "Copy as cURL"', () => {
    expect(cookieFromCurl(`curl 'https://app.squareup.com/x' \\\n  -H 'accept: */*' \\\n  -b '${COOKIE}' \\\n  -H 'x-csrf-token: tok123'`)).toBe(COOKIE)
  })
  it('reads a cookie header', () => {
    expect(cookieFromCurl(`curl "https://app.squareup.com/x" -H "Cookie: ${COOKIE}"`)).toBe(COOKIE)
  })
  it('accepts a bare cookie string', () => {
    expect(cookieFromCurl(COOKIE)).toBe(COOKIE)
  })
  it('refuses text with no csrf token', () => {
    expect(cookieFromCurl("curl 'https://x' -b 'a=1; b=2'")).toBeNull()
    expect(cookieFromCurl('hello')).toBeNull()
  })
})

describe('csrfFromCookie', () => {
  it('finds _js_csrf anywhere in the cookie', () => {
    expect(csrfFromCookie(COOKIE)).toBe('tok123')
    expect(csrfFromCookie('a=1')).toBeNull()
  })
})

describe('checkSession', () => {
  afterEach(() => vi.unstubAllGlobals())
  const stub = (status: number) => {
    const f = vi.fn(async () => new Response('{}', { status }))
    vi.stubGlobal('fetch', f)
    return f
  }
  it('connected on 200, sending the session and csrf header', async () => {
    const f = stub(200)
    expect(await checkSession('clssch_a', COOKIE)).toEqual({ state: 'connected' })
    const [url, init] = f.mock.calls[0] as any
    expect(url).toBe('https://app.squareup.com/appointments/api/class-schedules/clssch_a')
    expect(init.headers.cookie).toBe(COOKIE)
    expect(init.headers['x-csrf-token']).toBe('tok123')
  })
  it('expired on 401/403', async () => {
    stub(401)
    expect(await checkSession('clssch_a', COOKIE)).toEqual({ state: 'expired', status: 401 })
  })
  it('error on a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    expect(await checkSession('clssch_a', COOKIE)).toEqual({ state: 'error', detail: 'offline' })
  })
})
