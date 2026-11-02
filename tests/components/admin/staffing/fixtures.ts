/** Staffing rows as /api/admin/staffing.json sends them, for the /admin staffing screens. */
import { localToUtcISO } from '@lib/party-slots'

export const at = (day: string, hhmm: string) => localToUtcISO(day, hhmm)
const DAY = 86_400_000
/** A studio day n days from now (YYYY-MM-DD, Chicago). */
export const dayIn = (n: number) => new Date(Date.now() + n * DAY).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })

export function person(staffId: string, name: string, over: Record<string, unknown> = {}) {
  return { staffId, name, verdict: 'unknown', asked: false, assigned: false, askNote: '', markNote: '', hours: '', ...over }
}

export function row(over: Record<string, any> = {}) {
  const day = over.day ?? dayIn(3)
  const { day: _d, event, ...rest } = over
  const people = rest.people ?? [person('TM1', 'Kaden'), person('TM2', 'Jessica'), person('TM3', 'Sam')]
  const assigned = people.filter((p: any) => p.assigned)
  const needed = rest.needed ?? 1
  return {
    event: {
      key: 'ses:ses_1', kind: 'class', title: 'Needlepoint 101', startIso: at(day, '10:00'), endIso: at(day, '12:00'),
      status: 'on', openHref: '#class-cls_1', roster: { kind: 'workshop', id: 'cls_1', day }, detail: {}, ...(event ?? {}),
    },
    entry: rest.entry ?? { key: 'ses:ses_1', needed: null, assigned: assigned.map((p: any) => ({ staffId: p.staffId, name: p.name })), asks: [], seen: null, sequence: 0, updatedAt: 'u1', history: [] },
    state: rest.state ?? (assigned.length === 0 ? 'none' : assigned.length < needed ? 'short' : 'staffed'),
    needed,
    people,
    leftTeam: rest.leftTeam ?? [],
  }
}

export const CONTACTS = { TM1: { phone: '+12565550100', email: 'k@example.com' }, TM2: { phone: '+12565550199', email: 'j@example.com' }, TM3: { phone: null, email: null } }

export const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
export const refuse = (status: number, body: unknown) => ({ ok: false, status, json: async () => body })
export const bodies = (f: any, path: string, method = 'POST') => f.mock.calls
  .filter((c: any) => (c[1]?.method ?? 'GET') === method && String(c[0]).split('?')[0] === path)
  .map((c: any) => ({ body: c[1]?.body ? JSON.parse(c[1].body) : undefined, headers: c[1]?.headers as Record<string, string> }))
