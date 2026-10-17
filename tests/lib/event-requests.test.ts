import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSend = vi.fn()
vi.mock('@lib/email', () => ({ sendEmail: (...a: any[]) => mockSend(...a) }))

import {
  checkRequest, saveRequest, listRequests, getRequest, getRequestPhoto, setRequestStatus,
  ownerEmailText, ownerText, emailOwners, emailCustomer, clock12, MAX_GUESTS, type EventRequest,
} from '@lib/event-requests'
import { MAX_PHOTO_BYTES } from '@lib/form-photos'
import { goodBody, PHOTO, NOW } from '../fixtures/event-request'

beforeEach(() => { vi.clearAllMocks(); mockSend.mockResolvedValue({ sent: true }) })

const ok = (body: any) => {
  const c = checkRequest(body, NOW)
  if (!c.ok) throw new Error(`refused: ${c.field} ${c.error}`)
  return c
}

describe('checkRequest', () => {
  it('accepts a full request and keeps every answer', () => {
    const c = ok(goodBody())
    expect(c.photos).toHaveLength(1)
    expect(c.value.event).toMatchObject({ kind: 'team', date: '2026-11-21', backupDate: '2026-11-22', flexible: true, startTime: '14:00', guests: 18 })
    expect(c.value.where).toMatchObject({ place: 'yours', address: '100 Main St, Huntsville, AL', tables: 'yes', sink: 'no' })
    expect(c.value.extras).toEqual({ food: 'studio', drinks: 'guest', dessert: 'none', decor: '', tableware: 'studio', favors: '' })
    expect(c.value.budget).toBe('500-1000')
  })

  it('needs only the date, guests, where, and name, email and phone', () => {
    const c = ok({ event: { date: '2026-11-21', guests: 10 }, where: { place: 'studio' }, about: { name: 'A', email: 'a@b.co', phone: '2565550100' } })
    expect(c.value.extras.food).toBe('')
    expect(c.photos).toEqual([])
  })

  it('takes a rough guest count typed with words around it', () => {
    expect(ok(goodBody({ event: { ...goodBody().event, guests: 'about 25' } })).value.event.guests).toBe(25)
    expect(ok(goodBody({ event: { ...goodBody().event, guests: '20 to 25' } })).value.event.guests).toBe(20)
  })

  for (const [why, body, field] of [
    ['no date', goodBody({ event: { ...goodBody().event, date: '' } }), 'date'],
    ['not a real day', goodBody({ event: { ...goodBody().event, date: '2026-02-30' } }), 'date'],
    ['a date already gone', goodBody({ event: { ...goodBody().event, date: '2026-10-16' } }), 'date'],
    ['no guests', goodBody({ event: { ...goodBody().event, guests: '' } }), 'guests'],
    ['zero guests', goodBody({ event: { ...goodBody().event, guests: '0' } }), 'guests'],
    ['too many guests', goodBody({ event: { ...goodBody().event, guests: String(MAX_GUESTS + 1) } }), 'guests'],
    ['no place', goodBody({ where: { ...goodBody().where, place: '' } }), 'place'],
    ['at their place without an address', goodBody({ where: { ...goodBody().where, address: ' ' } }), 'address'],
    ['no name', goodBody({ about: { ...goodBody().about, name: '' } }), 'name'],
    ['bad email', goodBody({ about: { ...goodBody().about, email: 'dana@' } }), 'email'],
    ['short phone', goodBody({ about: { ...goodBody().about, phone: '555-0142' } }), 'phone'],
    ['five photos', goodBody({ photos: Array(5).fill(PHOTO) }), 'photos'],
    ['not an image', goodBody({ photos: ['data:text/html;base64,PGgxPg=='] }), 'photos'],
    ['too big a photo', goodBody({ photos: [`data:image/jpeg;base64,${Buffer.alloc(MAX_PHOTO_BYTES + 1).toString('base64')}`] }), 'photos'],
  ] as const) {
    it(`refuses ${why}, pointing at ${field}`, () => {
      const c = checkRequest(body, NOW)
      expect(c.ok).toBe(false)
      if (!c.ok) expect(c.field).toBe(field)
    })
  }

  it('today is fine (the studio calendar, not UTC)', () => {
    // 11 PM Central on Sat 17 Oct is already Sun 18 Oct in UTC.
    const late = new Date('2026-10-18T04:00:00Z')
    expect(checkRequest(goodBody({ event: { ...goodBody().event, date: '2026-10-17' } }), late).ok).toBe(true)
  })

  it('drops answers that only make sense for another choice', () => {
    const studio = ok(goodBody({ where: { ...goodBody().where, place: 'studio' } }))
    expect(studio.value.where).toEqual({ place: 'studio', address: '', setting: '', tables: '', sink: '', setupFrom: '', access: '' })
    const adults = ok(goodBody({ event: { ...goodBody().event, crafters: 'adults', youngest: '6' } }))
    expect(adults.value.event.youngest).toBe('')
    const notOther = ok(goodBody({ event: { ...goodBody().event, kind: 'team', kindOther: 'Gala' } }))
    expect(notOther.value.event.kindOther).toBe('')
  })

  it('ignores unknown choices, a bad time, and a past backup date rather than refusing', () => {
    const c = ok(goodBody({
      event: { ...goodBody().event, kind: 'rave', startTime: '25:00', backupDate: '2026-01-01' },
      extras: { food: 'free', drinks: 'guest' },
      budget: 'a million',
    }))
    expect(c.value.event).toMatchObject({ kind: '', startTime: '', backupDate: '' })
    expect(c.value.extras.food).toBe('')
    expect(c.value.extras.drinks).toBe('guest')
    expect(c.value.budget).toBe('')
  })
})

describe('storage', () => {
  it('saves, lists newest first, reads back its photo, and moves along', async () => {
    const a = ok(goodBody())
    const first = await saveRequest(a.value, a.photos, new Date('2026-10-17T10:00:00Z'))
    const second = await saveRequest(a.value, [], new Date('2026-10-17T11:00:00Z'))
    expect(first).toMatchObject({ status: 'new', photos: 1 })
    const ids = (await listRequests()).map((r) => r.id)
    expect(ids.indexOf(second.id)).toBeLessThan(ids.indexOf(first.id))
    expect((await getRequestPhoto(first.id, 0))?.toString()).toBe('fake-jpeg-bytes')
    expect(await getRequestPhoto(first.id, 1)).toBeNull()
    const moved = await setRequestStatus(first.id, 'quoted')
    expect(moved?.status).toBe('quoted')
    expect((await getRequest(first.id))?.status).toBe('quoted')
  })

  it('refuses ids that are not ours and statuses that do not exist', async () => {
    expect(await getRequest('../secrets')).toBeNull()
    expect(await getRequestPhoto('../secrets', 0)).toBeNull()
    const a = ok(goodBody())
    const saved = await saveRequest(a.value, [])
    expect(await setRequestStatus(saved.id, 'done' as any)).toBeNull()
  })
})

describe('words for the owners', () => {
  const req = (over: Partial<EventRequest> = {}): EventRequest => {
    const c = ok(goodBody())
    return { ...c.value, id: '2026-10-17-abcdef12', at: NOW.toISOString(), status: 'new', photos: 1, ...over }
  }

  it('clock12', () => {
    expect(clock12('14:00')).toBe('2:00 PM')
    expect(clock12('00:30')).toBe('12:30 AM')
    expect(clock12('12:05')).toBe('12:05 PM')
    expect(clock12('')).toBe('')
  })

  it('the text says who, what, when, how many and where', () => {
    expect(ownerText(req(), 'https://ourhometownstudio.com/admin')).toBe(
      'New private event request: Dana Planner, team building, Sat Nov 21 at 2:00 PM, 18 guests, at their place. Details in your email and at ourhometownstudio.com/admin.',
    )
    const plain = req({ event: { ...req().event, kind: '', startTime: '', guests: 1 }, where: { ...req().where, place: 'studio' } })
    expect(ownerText(plain, 'https://x.test/admin')).toBe('New private event request: Dana Planner, Sat Nov 21, 1 guest, at the studio. Details in your email and at x.test/admin.')
  })

  it('the email lists every answer and leaves blanks out', () => {
    const text = ownerEmailText(req(), 'https://x.test/admin')
    for (const line of ['Dana Planner', 'Rocket Co', 'Team building', 'Sat Nov 21 at 2:00 PM', 'Sun Nov 22', 'At your place', '100 Main St', 'Something custom', 'Blue and gold', 'Food\n  Please provide', 'Drinks\n  I’ll bring it', 'Cake or dessert\n  Not needed', 'One peanut allergy', '$500 to $1,000', 'Facebook', '1 inspiration photo attached.', 'All requests: https://x.test/admin']) {
      expect(text).toContain(line)
    }
    expect(text).not.toContain('Decorations')
    expect(ownerEmailText(req({ photos: 0 }), 'https://x.test/admin')).not.toContain('photo')
  })

  it('emails each owner with the photos attached, and the customer a short "got it"', async () => {
    expect(await emailOwners(req(), [Buffer.from('jpg')], 'https://x.test/admin')).toBe(true)
    const owner = mockSend.mock.calls[0][0]
    expect(owner.subject).toBe('Private event: Dana Planner, Sat Nov 21 at 2:00 PM')
    expect(owner.attachments).toHaveLength(1)
    mockSend.mockClear()
    expect(await emailCustomer(req())).toBe(true)
    const mail = mockSend.mock.calls[0][0]
    expect(mail.to).toBe('dana@example.com')
    expect(mail.text).toContain('Hi Dana,')
    expect(mail.text).toContain('We’ll be in touch.')
  })

  it('a failed send is reported, not thrown', async () => {
    mockSend.mockRejectedValue(new Error('down'))
    expect(await emailOwners(req(), [], 'https://x.test/admin')).toBe(false)
    expect(await emailCustomer(req())).toBe(false)
  })
})
