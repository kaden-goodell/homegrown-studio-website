// tests/api/shop-magnet-photo.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { POST } from '../../src/pages/api/shop/magnet-photo.json'
import { getPhoto } from '@lib/magnet-orders'

const DRAFT = '0f8fad5b-d9cb-469f-a165-70867728950e'
const jpegUrl = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9, 9]).toString('base64')}`
let ip = 0
const call = (body: unknown) => POST({
  clientAddress: `198.51.100.${++ip}`,
  request: new Request('https://ourhometownstudio.com/api/shop/magnet-photo.json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
} as any)

beforeEach(() => { process.env.BLOB_STORE_FS_DIR = mkdtempSync(join(tmpdir(), 'mag-api-')) })

describe('POST /api/shop/magnet-photo.json', () => {
  it('saves a JPEG and returns its id', async () => {
    const res = await call({ draftId: DRAFT, image: jpegUrl })
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(await getPhoto(DRAFT, data.photoId)).not.toBeNull()
  })
  it('refuses a bad draft id', async () => {
    expect((await call({ draftId: 'nope', image: jpegUrl })).status).toBe(400)
  })
  it('refuses something that is not a JPEG', async () => {
    const png = `data:image/jpeg;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64')}`
    expect((await call({ draftId: DRAFT, image: png })).status).toBe(400)
  })
  it('refuses a photo over 400 KB', async () => {
    const big = `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(400_001)]).toString('base64')}`
    expect((await call({ draftId: DRAFT, image: big })).status).toBe(413)
  })
})
