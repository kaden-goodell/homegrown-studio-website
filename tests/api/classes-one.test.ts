import { describe, it, expect } from 'vitest'
import { GET } from '@pages/api/classes/[id].json'
import { createClass } from '@lib/classes/class-store'
import { defaultRules } from '@lib/classes/validate'
import type { ClassRules, ClassStatus } from '@lib/classes/types'

const by = { id: 'k', name: 'Kaden' }
const make = (status: ClassStatus, rules: Partial<ClassRules> = {}) => createClass({
  status, by,
  content: {
    name: 'Clay', description: '', imageUrl: null, instructor: null, rules: { ...defaultRules(), ...rules },
    ticketTypes: [{ id: 'person', label: 'Person' }], passes: [{ id: 'all', label: 'Full', covers: { kind: 'all' } }],
    prices: { all: { person: 2000 } }, questions: [], addOns: [], defaultCapacity: 8, defaultMinutes: 90,
  },
  sessions: [{ id: 'ses_1', startIso: '2030-01-05T18:00:00.000Z', endIso: '2030-01-05T19:30:00.000Z', capacity: 8 }],
})
const get = (id: string) => GET({ params: { id } } as any) as Promise<Response>

describe('GET /api/classes/[id].json', () => {
  it('answers a link-only class with fresh seat counts, never cached', async () => {
    const c = await make('open', { linkOnly: true })
    const res = await get(c.id)
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    const { workshop } = await res.json()
    expect(workshop.own).toMatchObject({ classId: c.id, sessions: [{ id: 'ses_1', left: 8 }] })
  })
  it('404 for drafts, cancelled and unknown classes', async () => {
    expect((await get((await make('draft')).id)).status).toBe(404)
    expect((await get((await make('cancelled')).id)).status).toBe(404)
    expect((await get('cls_nothere1')).status).toBe(404)
    expect((await get('../etc')).status).toBe(404)
  })
})
