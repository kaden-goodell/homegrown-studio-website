import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockListWorkshops = vi.fn()
vi.mock('@config/providers', () => ({ providers: { workshop: { listWorkshops: (...a: any[]) => mockListWorkshops(...a) } } }))
const mockGetEventMeta = vi.fn()
vi.mock('@lib/event-meta', () => ({ getEventMeta: (...a: any[]) => mockGetEventMeta(...a) }))

import { GET } from '@pages/api/workshops.json'
import { forgetAll } from '@lib/short-memory'
import * as classStore from '@lib/classes/class-store'
import { createClass } from '@lib/classes/class-store'
import { defaultRules } from '@lib/classes/validate'

const PAILS = { id: 'pumpkin-color', label: 'Pumpkin color', choices: ['Light Pink', 'Light Blue', 'Black', 'Lavender'] }
const workshop = (scheduleId: string, startAt: string) => ({
  id: `inst-${scheduleId}`, scheduleId, name: scheduleId, description: '', descriptionHtml: '', startAt, durationMinutes: 120,
  priceCents: 2500, priceCurrency: 'USD', availableCapacity: 10, staffName: '', teamMemberId: '',
})

async function list() {
  const res = await GET({ request: new Request('http://localhost/api/workshops.json') } as any)
  return (await res.json()).workshops
}

beforeEach(() => {
  forgetAll()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-17T19:00:00.000Z')) // Sat 2 PM CDT
  mockListWorkshops.mockResolvedValue([workshop('clssch_pails', '2026-10-18T18:00:00.000Z'), workshop('clssch_kinu', '2026-10-24T00:00:00.000Z')])
  mockGetEventMeta.mockImplementation(async (_kind: string, id: string) =>
    id === 'clssch_pails' ? { options: [PAILS], signupCutoffHours: null } : null,
  )
})
afterEach(() => vi.useRealTimers())

describe('GET /api/workshops.json — questions and cutoff', () => {
  it('says, from the server’s clock, which classes have closed sign-ups', async () => {
    const [pails, kinu] = await list()
    expect(pails).toMatchObject({ options: [PAILS], signupClosesAt: '2026-10-17T18:00:00.000Z', signupClosed: true })
    expect(kinu).toMatchObject({ options: [], signupClosesAt: '2026-10-24T00:00:00.000Z', signupClosed: false })
  })

  it('reads settings by class schedule id', async () => {
    await list()
    expect(mockGetEventMeta).toHaveBeenCalledWith('workshop', 'clssch_pails')
  })

  it('still lists a class whose settings could not be read', async () => {
    mockGetEventMeta.mockRejectedValue(new Error('blobs down'))
    const [pails] = await list()
    expect(pails).toMatchObject({ name: 'clssch_pails', options: [] })
  })

  it('says why, when settings could not be read', async () => {
    mockGetEventMeta.mockRejectedValue(new Error('blobs down'))
    const res = await GET({ request: new Request('http://localhost/api/workshops.json') } as any)
    const json = await res.json()
    expect(json.incomplete).toBe(true)
    expect(json.settingsErrors[0]).toEqual({ scheduleId: 'clssch_pails', error: 'blobs down' })
  })

  it('never lets the edge cache a list built without a class’s settings', async () => {
    mockGetEventMeta.mockImplementation(async (_kind: string, id: string) => {
      if (id === 'clssch_pails') throw new Error('blobs down')
      return null
    })
    const res = await GET({ request: new Request('http://localhost/api/workshops.json') } as any)
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('lets a healthy list be cached', async () => {
    const res = await GET({ request: new Request('http://localhost/api/workshops.json') } as any)
    expect(res.headers.get('Cache-Control')).not.toContain('no-store')
  })
})

describe('GET /api/workshops.json — ticket types', () => {
  it('lists each ticket with its real price, the first at the class price', async () => {
    mockGetEventMeta.mockImplementation(async (_kind: string, id: string) =>
      id === 'clssch_kinu' ? { options: [], signupCutoffHours: null, tickets: [{ id: 'adult', label: 'Adult', priceCents: null, min: 1 }, { id: 'kid', label: 'Kid', priceCents: 1500, min: 1 }] } : null,
    )
    const [pails, kinu] = await list()
    expect(pails.tickets).toBeUndefined()
    expect(kinu.tickets).toEqual([
      { id: 'adult', label: 'Adult', priceCents: 2500, min: 1 },
      { id: 'kid', label: 'Kid', priceCents: 1500, min: 1 },
    ])
  })
})

describe('GET /api/workshops.json — our own classes', () => {
  const by = { id: 'k', name: 'Kaden' }
  const content = (name: string, rules: Partial<import('@lib/classes/types').ClassRules> = {}) => ({
    name, description: 'Paint.', imageUrl: null, instructor: null,
    rules: { ...defaultRules(), ...rules },
    ticketTypes: [{ id: 'person', label: 'Person' }],
    passes: [{ id: 'all', label: 'Full', covers: { kind: 'all' as const } }],
    prices: { all: { person: 3000 } }, questions: [], addOns: [], defaultCapacity: 12, defaultMinutes: 90,
  })
  const at = (start: string) => [{ id: `ses_${start.slice(8, 10)}${start.slice(11, 13)}`, startIso: start, endIso: new Date(Date.parse(start) + 90 * 60_000).toISOString(), capacity: 12 }]

  it('lists open and closed classes with the Square ones, by first session; never drafts, cancelled or link-only', async () => {
    const open = await createClass({ content: content('Ours open'), sessions: at('2026-10-20T18:00:00.000Z'), status: 'open', by })
    const closed = await createClass({ content: content('Ours closed'), sessions: at('2026-10-19T18:00:00.000Z'), status: 'closed', by })
    await createClass({ content: content('Draft'), sessions: at('2026-10-21T18:00:00.000Z'), status: 'draft', by })
    await createClass({ content: content('Cancelled'), sessions: at('2026-10-22T18:00:00.000Z'), status: 'cancelled', by })
    await createClass({ content: content('Link only', { linkOnly: true }), sessions: at('2026-10-23T18:00:00.000Z'), status: 'open', by })
    const all = await list()
    expect(all.map((w: any) => w.name)).toEqual(['clssch_pails', 'Ours closed', 'Ours open', 'clssch_kinu'])
    const ours = all.find((w: any) => w.id === open.id)
    expect(ours).toMatchObject({ price: 3000, remainingSeats: 12, signupClosed: false, own: { classId: open.id } })
    expect(ours.own.sessions[0]).toMatchObject({ left: 12, closed: false })
    expect(all.find((w: any) => w.id === closed.id)).toMatchObject({ signupClosed: true, remainingSeats: null })
  })

  it('still lists Square classes when ours can’t be read, and never caches that list', async () => {
    const spy = vi.spyOn(classStore, 'listClasses').mockRejectedValueOnce(new Error('blobs down'))
    const res = await GET({ request: new Request('http://localhost/api/workshops.json') } as any)
    const json = await res.json()
    expect(json.workshops.map((w: any) => w.name)).toEqual(['clssch_pails', 'clssch_kinu'])
    expect(json.incomplete).toBe(true)
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    spy.mockRestore()
  })
})
