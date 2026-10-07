import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockListWorkshops = vi.fn()
vi.mock('@config/providers', () => ({ providers: { workshop: { listWorkshops: (...a: any[]) => mockListWorkshops(...a) } } }))
const mockGetEventMeta = vi.fn()
vi.mock('@lib/event-meta', () => ({ getEventMeta: (...a: any[]) => mockGetEventMeta(...a) }))

import { GET } from '@pages/api/workshops.json'
import { forgetAll } from '@lib/short-memory'

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
