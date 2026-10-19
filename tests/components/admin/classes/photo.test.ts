import { describe, it, expect, vi, afterEach } from 'vitest'
import { cropRect, sendPhoto } from '@components/admin/classes/photo'
import { onAdminSignedOut, setAdminWho } from '@components/admin/classes/api'

afterEach(() => { vi.unstubAllGlobals(); onAdminSignedOut(null); setAdminWho('') })

describe('class photos', () => {
  it('crops to the card’s 4 by 3 and caps the long side', () => {
    expect(cropRect(4000, 3000)).toMatchObject({ sw: 4000, sh: 3000, dw: 1600, dh: 1200 })
    expect(cropRect(1000, 2000)).toMatchObject({ sx: 0, sy: 625, sw: 1000, sh: 750 })
  })

  it('M6: an upload that comes back 401 sends the page back to sign-in, and says who is uploading', async () => {
    const signedOut = vi.fn()
    onAdminSignedOut(signedOut)
    setAdminWho('Catherine')
    const f = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({ error: 'Sign in first.' }) }))
    vi.stubGlobal('fetch', f)
    expect(await sendPhoto(new Blob(['x'], { type: 'image/jpeg' }))).toEqual({ error: 'Sign in first.' })
    expect(signedOut).toHaveBeenCalled()
    expect((f.mock.calls[0] as any)[1].headers['X-Admin-Who']).toBe('Catherine')
  })
})
