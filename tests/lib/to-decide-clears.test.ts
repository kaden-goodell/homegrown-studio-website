// @vitest-environment node
/**
 * Fix round 1, Important 3: once an owner decides something in /admin › To
 * decide, it stops showing on /staff's warnings, in the daily email and in the
 * minimum-to-run alerts. Real stores; Square and email are fakes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({ classes: [] as any[], email: vi.fn(), alert: vi.fn() }))
vi.mock('@config/providers', () => ({
  providers: { workshop: { listAllWorkshops: async () => [], listWorkshops: async () => [] }, booking: { listBookings: async () => [] } },
}))
vi.mock('@lib/classes/class-store', () => ({
  listClasses: async () => m.classes,
  getClass: async (id: string) => m.classes.find((c) => c.id === id) ?? null,
}))
vi.mock('@lib/classes/square-api', () => ({ squareSettings: () => ({}), squareFetch: async () => { throw new Error('no Square here') } }))
vi.mock('@lib/audit', () => ({ recordAudit: vi.fn(async () => undefined) }))
vi.mock('@lib/email', () => ({ sendEmail: m.email, sendRefundEmail: vi.fn(async () => ({ sent: true })) }))
vi.mock('@lib/owner-alert', () => ({ alertOwners: m.alert }))
vi.mock('@lib/square-dashboard', () => ({ loadSessionRecord: async () => ({ cookie: 'x', savedAt: '2026-10-01T00:00:00Z' }), checkSession: async () => ({ state: 'connected' }) }))

import { makeKvStore } from '@lib/blob-store'
import { listWarnings } from '@lib/warnings'
import { decide, listToDecide } from '@lib/classes/to-decide'
import { runMinimumToRunAlerts } from '@lib/classes/minimum-to-run'
import { POST as dailyWarnings, dailyWarningsJobKey } from '@pages/api/jobs/daily-warnings.json'
import { defaultRules } from '@lib/classes/validate'

const NOW = new Date('2026-10-21T15:00:00Z') // Wed; decide-by Thu 5 PM
const BY = { id: 'owner-catherine', name: 'Catherine' }
const cls = {
  id: 'cls_short', libraryId: null, libraryVersion: null, status: 'open',
  content: { name: 'Needlepoint 101', description: '', imageUrl: null, instructor: null, rules: { ...defaultRules(), minimumToRun: { count: 6, decideByIso: '2026-10-22T22:00:00.000Z' } },
    ticketTypes: [{ id: 'person', label: 'Person' }], passes: [{ id: 'all', label: 'Full', covers: { kind: 'all' } }], prices: { all: { person: 3000 } }, questions: [], addOns: [], defaultCapacity: 8, defaultMinutes: 120 },
  sessions: [{ id: 'ses_1', startIso: '2026-10-24T23:00:00.000Z', endIso: '2026-10-25T01:00:00.000Z', capacity: 8 }],
  square: { itemId: null, variations: {} }, createdAt: '', updatedAt: '', by: BY, history: [],
}
const window = { from: '2026-10-21', to: '2026-11-30' }
const codes = async () => (await listWarnings(window, { now: NOW })).map((w) => w.code).sort()

beforeEach(async () => {
  m.classes = [cls]
  m.email.mockReset().mockResolvedValue({ sent: true })
  m.alert.mockReset().mockResolvedValue({ attempted: 1, sent: 1 })
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  process.env.LOOKUP_SIGNING_SECRET = 'job-secret'
  await makeKvStore('unmatched-pos', 'unmatched-pos').set('unmatched-ORD1-LI1', JSON.stringify({ orderId: 'ORD1', lineUid: 'LI1', name: 'Gift wrap', qty: 1, at: '2026-10-20T16:00:00.000Z' }))
})

describe('a decision in To decide clears it everywhere', () => {
  it('Not for a class and Keep it running leave /staff warnings, the daily email and the minimum alerts', async () => {
    expect(await codes()).toEqual(['below-minimum', 'pos-unmatched'])
    const emailText = async () => {
      m.email.mockClear()
      await dailyWarnings({ request: new Request('https://x.test/api/jobs/daily-warnings.json', { method: 'POST', headers: { 'x-job-key': dailyWarningsJobKey('job-secret') } }) } as any)
      return m.email.mock.calls.map((c) => c[0].text).join('\n')
    }
    expect(await emailText()).toMatch(/Gift wrap/)

    const items = (await listToDecide(NOW)).items.filter((i) => !i.done)
    await decide(items.find((i) => i.kind === 'pos-unmatched')!.id, 'dismiss', {}, BY, NOW)
    await decide(items.find((i) => i.kind === 'below-minimum')!.id, 'keep-running', {}, BY, NOW)

    expect(await codes()).toEqual([])
    m.alert.mockClear()
    expect(await emailText()).toBe('')
    expect((await runMinimumToRunAlerts(NOW)).alerted).toEqual([])
    expect(m.alert).not.toHaveBeenCalled()
  })

  it('Keep it running stops the minimum-to-run texts and emails', async () => {
    const other = { ...cls, id: 'cls_short2', content: { ...cls.content, name: 'Punch Needle' } }
    m.classes = [other]
    const item = (await listToDecide(NOW)).items.find((i) => i.kind === 'below-minimum' && i.classId === 'cls_short2' && !i.done)!
    await decide(item.id, 'keep-running', {}, BY, NOW)
    const run = await runMinimumToRunAlerts(NOW)
    expect(run.alerted).toEqual([])
    expect(run.already).toBe(0)
    expect(m.alert).not.toHaveBeenCalled()
  })
})
