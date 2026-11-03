import { describe, it, expect, vi } from 'vitest'

// Review M1 (3 Nov): the crew's calendar never shows a host's name, so the payload doesn't carry it either.
vi.mock('@lib/staff-auth', () => ({ staffAuthorized: async () => ({ id: 'c1', name: 'Crew', role: 'crew' }) }))
vi.mock('@lib/classes/class-store', () => ({ listClasses: async () => [] }))
vi.mock('@lib/party-store', () => ({ getPartyRecord: async () => null }))
vi.mock('@lib/classes/studio-schedule', () => ({
  busyBetween: async () => [
    { kind: 'party', id: 'pty_1', label: 'Paige’s party · Pots', startIso: '2031-05-06T19:00:00.000Z', endIso: '2031-05-06T21:00:00.000Z', hostName: 'Paige Testparent' },
    { kind: 'party', id: 'sq_2', label: 'Party', startIso: '2031-05-07T19:00:00.000Z', endIso: '2031-05-07T21:00:00.000Z', hostName: 'Stefanie Justice' },
  ],
}))

describe('GET /api/staff/calendar.json', () => {
  it('sends each party with its label but without the host’s name', async () => {
    const { GET } = await import('@pages/api/staff/calendar.json')
    const request = new Request('https://x.test/api/staff/calendar.json?from=2031-05-05T05:00:00.000Z&to=2031-05-12T04:59:59.999Z')
    const res: Response = await GET({ request, url: new URL(request.url) } as any)
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('Paige’s party · Pots')
    expect(body).not.toContain('Testparent')
    expect(body).not.toContain('Justice')
    expect(body).not.toContain('hostName')
  })
})
