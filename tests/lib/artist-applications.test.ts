import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSend = vi.fn()
vi.mock('@lib/email', () => ({ sendEmail: (...a: any[]) => mockSend(...a) }))

import { checkApplication, saveApplication, listApplications, getApplication, getApplicationPhoto, setApplicationStatus, emailOwners, emailArtist, ownerEmailText, MAX_PHOTO_BYTES } from '@lib/artist-applications'

import { goodBody, PHOTO } from '../fixtures/artist-application'

beforeEach(() => { vi.clearAllMocks(); mockSend.mockResolvedValue({ sent: true }) })

describe('checkApplication', () => {
  it('accepts a full application', () => {
    const c = checkApplication(goodBody())
    expect(c.ok).toBe(true)
    if (c.ok) { expect(c.photos).toHaveLength(1); expect(c.value.classIdea.audience).toBe('adults') }
  })
  it('only name, email, phone, the class idea and one photo are required', () => {
    const c = checkApplication({ about: { name: 'A', email: 'a@b.co', phone: '2565550100' }, classIdea: { what: 'x' }, photos: [PHOTO] })
    expect(c.ok).toBe(true)
  })
  for (const [why, body, field] of [
    ['no name', goodBody({ about: { ...goodBody().about, name: ' ' } }), 'name'],
    ['bad email', goodBody({ about: { ...goodBody().about, email: 'lou@' } }), 'email'],
    ['short phone', goodBody({ about: { ...goodBody().about, phone: '555-0100' } }), 'phone'],
    ['no class idea', goodBody({ classIdea: { ...goodBody().classIdea, what: '' } }), 'what'],
    ['no photo', goodBody({ photos: [] }), 'photos'],
    ['seven photos', goodBody({ photos: Array(7).fill(PHOTO) }), 'photos'],
    ['not an image', goodBody({ photos: ['data:text/html;base64,PGgxPg=='] }), 'photos'],
    ['too big a photo', goodBody({ photos: [`data:image/jpeg;base64,${Buffer.alloc(MAX_PHOTO_BYTES + 1).toString('base64')}`] }), 'photos'],
  ] as const) {
    it(`refuses ${why}`, () => {
      const c = checkApplication(body)
      expect(c.ok).toBe(false)
      if (!c.ok) expect(c.field).toBe(field)
    })
  }
  it('throws away unknown choices and trims long text', () => {
    const c = checkApplication(goodBody({ classIdea: { ...goodBody().classIdea, audience: 'aliens', what: 'x'.repeat(5000) }, when: { howOften: 'daily' } }))
    expect(c.ok && c.value.classIdea.audience).toBe('')
    expect(c.ok && c.value.classIdea.what.length).toBe(1500)
    expect(c.ok && c.value.when.howOften).toBe('')
  })
})

describe('saving, listing, status, photos', () => {
  it('saves with its photos, lists newest first, and moves status', async () => {
    const c = checkApplication(goodBody()); if (!c.ok) throw new Error('bad')
    const a = await saveApplication(c.value, c.photos, new Date('2026-10-15T10:00:00Z'))
    const b = await saveApplication(c.value, c.photos, new Date('2026-10-16T10:00:00Z'))
    expect(a.status).toBe('new')
    const list = await listApplications()
    expect(list.findIndex((x) => x.id === b.id)).toBeLessThan(list.findIndex((x) => x.id === a.id))
    expect((await getApplicationPhoto(a.id, 0))?.toString()).toBe('fake-jpeg-bytes')
    expect(await getApplicationPhoto(a.id, 1)).toBeNull()
    expect((await setApplicationStatus(a.id, 'talking'))?.status).toBe('talking')
    expect((await getApplication(a.id))?.status).toBe('talking')
  })
  it('refuses unknown ids and statuses', async () => {
    expect(await getApplication('../../etc')).toBeNull()
    expect(await getApplicationPhoto('nope', 0)).toBeNull()
    expect(await setApplicationStatus('2026-10-15-abcdef12', 'talking')).toBeNull()
    expect(await setApplicationStatus('2026-10-15-abcdef12', 'archived' as any)).toBeNull()
  })
})

describe('emails', () => {
  const app = { id: '2026-10-15-abcdef12', at: '', status: 'new' as const, photos: 1, ...(() => { const c = checkApplication(goodBody()); if (!c.ok) throw 0; return c.value })() }
  it('owners get every answer, blanks left out, with the photos attached', async () => {
    await emailOwners(app, [Buffer.from('jpg')], 'https://x.test/admin')
    expect(mockSend.mock.calls.map((c) => c[0].to).sort()).toEqual(['catherine@ourhometownstudio.com', 'kaden@ourhometownstudio.com'])
    const mail = mockSend.mock.calls[0][0]
    expect(mail.subject).toBe('Teach a class: Lou Maker (Lou Makes)')
    expect(mail.attachments).toEqual([{ filename: 'photo-1.jpg', content: Buffer.from('jpg').toString('base64'), contentType: 'image/jpeg', encoding: 'base64' }])
    const text = ownerEmailText(app, 'https://x.test/admin')
    expect(text).toContain('Class idea\n  Linocut printing')
    expect(text).toContain('How often\n  Monthly')
    expect(text).not.toContain('Website')
  })
  it('the artist gets a short note with no timeline', async () => {
    await emailArtist(app)
    const mail = mockSend.mock.calls[0][0]
    expect(mail.to).toBe('lou@example.com')
    expect(mail.text).toContain('Thanks, we got it. We’ll be in touch.')
    expect(mail.text).not.toMatch(/week|day|soon/i)
  })
})
