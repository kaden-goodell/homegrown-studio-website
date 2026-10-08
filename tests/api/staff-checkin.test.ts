import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CheckinState } from '@lib/checkin-store'

// --- Module mocks (hoisted), same style as tests/api/kit-staff.test.ts ---
let authed: { id: string; name: string; role: 'owner' | 'crew' } | null = { id: 't', name: 'Test', role: 'crew' }
const mockAudit = vi.fn()
vi.mock('@lib/audit', () => ({ recordAudit: (...a: any[]) => mockAudit(...a) }))
vi.mock('@lib/staff-auth', () => ({ staffAuthorized: () => authed, byOf: (m: any) => ({ id: m.id, name: m.name }) }))

const mockGetEvent = vi.fn()
vi.mock('@lib/events', async (importOriginal) => {
  const actual: any = await importOriginal()
  return { ...actual, getEvent: (...a: any[]) => mockGetEvent(...a) }
})

const mockGetWaiverRecord = vi.fn()
vi.mock('@lib/waiver-store', async (importOriginal) => {
  const actual: any = await importOriginal()
  return { ...actual, getWaiverRecord: (...a: any[]) => mockGetWaiverRecord(...a) }
})

const mockGetRsvp = vi.fn()
const mockLatest = vi.fn()
vi.mock('@lib/rsvp-store', () => ({ getRsvp: (...a: any[]) => mockGetRsvp(...a), getLatestPickupForWaiver: (...a: any[]) => mockLatest(...a) }))

const mockSendQuoText = vi.fn()
vi.mock('@lib/quo', async (importOriginal) => {
  const actual: any = await importOriginal()
  return { ...actual, sendQuoText: (...a: any[]) => mockSendQuoText(...a) }
})

// mutateCheckin applies the callback to a shared in-memory state and returns
// it, so the endpoint's mutations are observable on `state` afterward.
let state: CheckinState
const mockMutate = vi.fn(async (_eventKey: string, _recordId: string, fn: (s: CheckinState) => void | Promise<void>) => {
  await fn(state)
  return state
})
vi.mock('@lib/checkin-store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@lib/checkin-store')>()),
  mutateCheckin: (...a: any[]) => (mockMutate as any)(...a),
}))

function emptyState(): CheckinState {
  return {
    expected: null,
    days: {},
    pickedUpBy: null,
    confirmedPickup: [],
    notAuthorized: '',
    pickupCodeHash: null,
    codeAttempts: 0,
    lockedAt: null,
    releasedTo: {},
    events: [],
    pickupSeeded: false,
  }
}

function ctx(body: any) {
  const request = new Request('http://localhost/api/staff/checkin.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { request } as any
}

const singleDayEvent = { kind: 'party', id: 'party-1', title: 'Party', startIso: '2026-09-05T14:00:00.000Z', days: ['2026-09-05'], dropOff: false }

// HOM-214 fixtures — a drop-off event and a household with an authorized
// pickup chip, a may-NOT-collect note, and a phone to text.
const dropOffEvent = { kind: 'workshop', id: 'ws-1', title: 'Summer Camp', startIso: '2026-09-05T14:00:00.000Z', days: ['2026-09-05'], dropOff: true }
function dropOffWaiver(overrides: Record<string, any> = {}) {
  return {
    id: 'wvr_1',
    adult: { firstName: 'Jamie', lastName: 'Rivera', email: 'jamie@x.com', phone: '2565550199', dob: '1990-01-01', allergies: '' },
    minors: [{ name: 'Kiddo Rivera', dob: '2018-01-01', allergies: '', medications: '' }],
    authorizedPickup: [{ name: 'Grandma Rivera', phone: '2565550100' }],
    notAuthorized: 'Rick Smith',
    ...overrides,
  }
}
const dropOffPost = (body: any) => post({ kind: 'workshop', id: 'ws-1', recordId: 'wvr_1', day: '2026-09-05', ...body })

let POST: any
function post(body: any) {
  return POST(ctx(body))
}
beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  authed = { id: 't', name: 'Test', role: 'crew' }
  state = emptyState()
  mockGetEvent.mockResolvedValue(singleDayEvent) // non-drop-off party — no pickup code involved
  mockGetWaiverRecord.mockResolvedValue(null)
  mockGetRsvp.mockResolvedValue(null)
  mockLatest.mockReset().mockResolvedValue(null)
  mockSendQuoText.mockReset()
  mockSendQuoText.mockResolvedValue(undefined)
  POST = (await import('@pages/api/staff/checkin.json')).POST
})

describe('POST /api/staff/checkin.json', () => {
  it('rejects an unauthenticated caller', async () => {
    authed = null
    const res = await POST(ctx({ party: 'party-1', recordId: 'rec-1', action: 'checkin', personIds: ['adult'] }))
    expect(res.status).toBe(401)
    expect(mockMutate).not.toHaveBeenCalled()
  })

  it('stamps the appended event with the signed-in staffer', async () => {
    const res = await POST(ctx({ party: 'party-1', recordId: 'rec-1', action: 'checkin', personIds: ['adult'] }))
    expect(res.status).toBe(200)
    const last = state.events.at(-1)!
    expect(last.action).toBe('checkin')
    expect(last.by).toEqual({ id: 't', name: 'Test' })
    expect(mockAudit).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'checkin.here', by: expect.objectContaining({ id: expect.any(String), role: expect.stringMatching(/^(owner|crew)$/) }), target: expect.objectContaining({ kind: 'household', id: 'rec-1' }) }))
  })

  it('accepts { kind, id } as well as the legacy { party } alias', async () => {
    const res = await POST(ctx({ kind: 'party', id: 'party-1', recordId: 'rec-1', action: 'checkin', personIds: ['adult'] }))
    expect(res.status).toBe(200)
    expect(state.events.at(-1)!.action).toBe('checkin')
  })

  it('rejects a request missing kind/id and party', async () => {
    const res = await POST(ctx({ recordId: 'rec-1', action: 'checkin', personIds: ['adult'] }))
    expect(res.status).toBe(400)
    expect(mockMutate).not.toHaveBeenCalled()
  })

  it('records attendance under the event day and returns it in the response', async () => {
    const res = await POST(ctx({ party: 'party-1', recordId: 'rec-1', action: 'checkin', personIds: ['adult'] }))
    const json = await res.json()
    expect(json.data.day).toBe('2026-09-05')
    expect(state.days['2026-09-05'].presence.adult.inAt).toBeTruthy()
    expect(json.data.checkin.days['2026-09-05'].presence.adult).toBeTruthy()
  })

  it('a multi-day event: checking in on day 1 does not affect day 2', async () => {
    mockGetEvent.mockResolvedValue({ ...singleDayEvent, days: ['2026-09-05', '2026-09-06'] })
    await POST(ctx({ party: 'party-1', recordId: 'rec-1', action: 'checkin', personIds: ['adult'], day: '2026-09-05' }))
    await POST(ctx({ party: 'party-1', recordId: 'rec-1', action: 'checkin', personIds: ['child:0'], day: '2026-09-06' }))
    expect(state.days['2026-09-05'].presence.adult).toBeTruthy()
    expect(state.days['2026-09-05'].presence['child:0']).toBeUndefined()
    expect(state.days['2026-09-06'].presence['child:0']).toBeTruthy()
    expect(state.days['2026-09-06'].presence.adult).toBeUndefined()
  })

  it('a multi-day drop-off event: the pickup code persists across days and is only retired on the last day with no child present', async () => {
    mockGetEvent.mockResolvedValue({ ...singleDayEvent, dropOff: true, days: ['2026-09-05', '2026-09-06'] })
    mockGetWaiverRecord.mockResolvedValue(dropOffWaiver())

    // Day 1: check a child in — issues a code.
    const r1 = await POST(ctx({ party: 'party-1', recordId: 'rec-1', action: 'checkin', personIds: ['child:0'], day: '2026-09-05' }))
    const j1 = await r1.json()
    expect(j1.data.oneTimeCode).toBeTruthy()
    expect(state.pickupCodeHash).toBeTruthy()

    // Day 1: pick the child up at end of day — NOT the last day, code survives.
    // Collector is a known chip (Grandma Rivera), so no ID-check is needed.
    await POST(ctx({ party: 'party-1', recordId: 'rec-1', action: 'pickup', personIds: ['child:0'], code: j1.data.oneTimeCode, collectedBy: 'Grandma Rivera', day: '2026-09-05' }))
    expect(state.pickupCodeHash).toBeTruthy()

    // Day 2: check the same child in again with the SAME code (no reissue needed).
    await POST(ctx({ party: 'party-1', recordId: 'rec-1', action: 'checkin', personIds: ['child:0'], day: '2026-09-06' }))
    // Day 2: pick up — this IS the last day and no child remains anywhere else on this day → retire.
    await POST(ctx({ party: 'party-1', recordId: 'rec-1', action: 'pickup', personIds: ['child:0'], code: j1.data.oneTimeCode, collectedBy: 'Grandma Rivera', day: '2026-09-06' }))
    expect(state.pickupCodeHash).toBeNull()
  })
})

// ─── HOM-214: SMS codes, authorized chips, ID checkbox, override, lockout ────

describe('POST /api/staff/checkin.json — pickup completion (HOM-214)', () => {
  it('checkin of a child on a drop-off event issues a code, texts it, logs code-sent with by', async () => {
    mockGetEvent.mockResolvedValue(dropOffEvent)
    mockGetWaiverRecord.mockResolvedValue(dropOffWaiver())

    const res = await dropOffPost({ action: 'checkin', personIds: ['child:0'] })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.oneTimeCode).toMatch(/^\d{4}$/)

    expect(mockSendQuoText).toHaveBeenCalledTimes(1)
    expect(mockSendQuoText).toHaveBeenCalledWith(expect.objectContaining({ to: '2565550199' }))

    const actions = state.events.map((e) => e.action)
    expect(actions).toEqual(['checkin', 'code-sent'])
    expect(state.events.find((e) => e.action === 'checkin')!.by).toEqual({ id: 't', name: 'Test' })
    expect(state.events.find((e) => e.action === 'code-sent')!.by).toEqual({ id: 't', name: 'Test' })
    // The plaintext code is never persisted in the log.
    expect(JSON.stringify(state.events)).not.toContain(json.data.oneTimeCode)
  })

  it('pickup needs the code only for children on drop-off events', async () => {
    mockGetEvent.mockResolvedValue(dropOffEvent)
    mockGetWaiverRecord.mockResolvedValue(dropOffWaiver())
    state.days['2026-09-05'] = { presence: { adult: { inAt: '2026-09-05T14:00:00.000Z', outAt: null } } }

    const res = await dropOffPost({ action: 'pickup', personIds: ['adult'] })
    expect(res.status).toBe(200)
    expect(state.days['2026-09-05'].presence.adult.outAt).toBeTruthy()
  })

  it('wrong code increments attempts; 5th locks (423); locked ignores correct code', async () => {
    mockGetEvent.mockResolvedValue(dropOffEvent)
    mockGetWaiverRecord.mockResolvedValue(dropOffWaiver())

    const ci = await dropOffPost({ action: 'checkin', personIds: ['child:0'] })
    const realCode = (await ci.json()).data.oneTimeCode
    const wrongCode = realCode === '1111' ? '2222' : '1111'

    let res
    for (let i = 1; i <= 4; i++) {
      res = await dropOffPost({ action: 'pickup', personIds: ['child:0'], code: wrongCode, collectedBy: 'Grandma Rivera' })
      expect(res.status).toBe(400)
      expect(state.codeAttempts).toBe(i)
    }

    res = await dropOffPost({ action: 'pickup', personIds: ['child:0'], code: wrongCode, collectedBy: 'Grandma Rivera' })
    expect(res.status).toBe(423)
    expect(state.lockedAt).toBeTruthy()
    expect(state.events.at(-1)!.action).toBe('locked')

    // Locked ignores even the correct code.
    res = await dropOffPost({ action: 'pickup', personIds: ['child:0'], code: realCode, collectedBy: 'Grandma Rivera' })
    expect(res.status).toBe(423)
    expect(state.days['2026-09-05'].presence['child:0'].outAt).toBeFalsy()
  })

  it('collectedBy must be a chip or the signer unless idChecked', async () => {
    mockGetEvent.mockResolvedValue(dropOffEvent)
    mockGetWaiverRecord.mockResolvedValue(dropOffWaiver())
    const ci = await dropOffPost({ action: 'checkin', personIds: ['child:0'] })
    const code = (await ci.json()).data.oneTimeCode

    let res = await dropOffPost({ action: 'pickup', personIds: ['child:0'], code, collectedBy: 'Stranger', idChecked: false })
    expect(res.status).toBe(400)
    const j = await res.json()
    expect(j.error).toBe("Not on the list — tick 'I checked their photo ID' or use Override.")
    expect(state.days['2026-09-05'].presence['child:0'].outAt).toBeFalsy()

    res = await dropOffPost({ action: 'pickup', personIds: ['child:0'], code, collectedBy: 'Stranger', idChecked: true })
    expect(res.status).toBe(200)
    expect(state.days['2026-09-05'].presence['child:0'].outAt).toBeTruthy()
  })

  it('may-not-collect name is refused on pickup and override', async () => {
    mockGetEvent.mockResolvedValue(dropOffEvent)
    mockGetWaiverRecord.mockResolvedValue(dropOffWaiver())
    const ci = await dropOffPost({ action: 'checkin', personIds: ['child:0'] })
    const code = (await ci.json()).data.oneTimeCode

    let res = await dropOffPost({ action: 'pickup', personIds: ['child:0'], code, collectedBy: 'rick smith', idChecked: true })
    expect(res.status).toBe(400)
    expect(state.events.at(-1)!.action).toBe('pickup-denied')
    expect(state.events.at(-1)!.reason).toBe('not-authorized')

    res = await dropOffPost({ action: 'pickup-override', personIds: ['child:0'], collectedBy: 'rick smith', reason: 'parent-present', idChecked: true })
    expect(res.status).toBe(400)
    expect(state.days['2026-09-05'].presence['child:0'].outAt).toBeFalsy()
  })

  it('override releases without a code, clears the lock, logs reason + by', async () => {
    mockGetEvent.mockResolvedValue(dropOffEvent)
    mockGetWaiverRecord.mockResolvedValue(dropOffWaiver())
    await dropOffPost({ action: 'checkin', personIds: ['child:0'] })
    state.codeAttempts = 4
    state.lockedAt = new Date().toISOString()

    const res = await dropOffPost({ action: 'pickup-override', personIds: ['child:0'], collectedBy: 'Grandma Rivera', reason: 'called-parent', idChecked: false })
    expect(res.status).toBe(200)
    expect(state.lockedAt).toBeNull()
    expect(state.codeAttempts).toBe(0)
    expect(state.days['2026-09-05'].presence['child:0'].outAt).toBeTruthy()

    const ev = state.events.find((e) => e.action === 'pickup-override')!
    expect(ev.reason).toBe('called-parent')
    expect(ev.by).toEqual({ id: 't', name: 'Test' })
  })

  it('release texts the parent and records releasedTo per person and per day', async () => {
    mockGetEvent.mockResolvedValue(dropOffEvent)
    mockGetWaiverRecord.mockResolvedValue(dropOffWaiver())
    const ci = await dropOffPost({ action: 'checkin', personIds: ['child:0'] })
    const code = (await ci.json()).data.oneTimeCode
    mockSendQuoText.mockClear()

    const res = await dropOffPost({ action: 'pickup', personIds: ['child:0'], code, collectedBy: 'Grandma Rivera', idChecked: false })
    expect(res.status).toBe(200)
    expect(state.releasedTo['child:0']).toEqual({ name: 'Grandma Rivera', at: expect.any(String), day: '2026-09-05' })

    expect(mockSendQuoText).toHaveBeenCalledTimes(1)
    expect(mockSendQuoText).toHaveBeenCalledWith(expect.objectContaining({ to: '2565550199' }))
  })

  it('SMS failure does not fail check-in; response.smsFailed=true', async () => {
    mockGetEvent.mockResolvedValue(dropOffEvent)
    mockGetWaiverRecord.mockResolvedValue(dropOffWaiver())
    mockSendQuoText.mockRejectedValueOnce(new Error('Quo down'))

    const res = await dropOffPost({ action: 'checkin', personIds: ['child:0'] })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.smsFailed).toBe(true)
    expect(json.data.oneTimeCode).toMatch(/^\d{4}$/)
  })

  it('reissue-code requires a reason', async () => {
    mockGetEvent.mockResolvedValue(dropOffEvent)
    mockGetWaiverRecord.mockResolvedValue(dropOffWaiver())

    const res = await dropOffPost({ action: 'reissue-code' })
    expect(res.status).toBe(400)

    const res2 = await dropOffPost({ action: 'reissue-code', reason: 'Parent didn’t get the text' })
    expect(res2.status).toBe(200)
    const json2 = await res2.json()
    expect(json2.data.oneTimeCode).toMatch(/^\d{4}$/)
    expect(state.events.find((e) => e.action === 'reissue-code')!.reason).toBe('Parent didn’t get the text')
  })

  it('every event carries by', async () => {
    mockGetEvent.mockResolvedValue(dropOffEvent)
    mockGetWaiverRecord.mockResolvedValue(dropOffWaiver())
    await dropOffPost({ action: 'checkin', personIds: ['child:0'] })
    await dropOffPost({ action: 'reissue-code', reason: 'Other' })
    for (const ev of state.events) expect(ev.by).toEqual({ id: 't', name: 'Test' })
  })
})

// ─── HOM-214 fix round 1 ──────────────────────────────────────────────────

describe('POST /api/staff/checkin.json — pickup completion, fix round 1', () => {
  it('Critical 1: fuzzyMatchesNotAuthorized survives internal whitespace', async () => {
    mockGetEvent.mockResolvedValue(dropOffEvent)
    mockGetWaiverRecord.mockResolvedValue(dropOffWaiver({ notAuthorized: 'Rick Smith' }))
    const ci = await dropOffPost({ action: 'checkin', personIds: ['child:0'] })
    const code = (await ci.json()).data.oneTimeCode

    // Doubled internal space.
    let res = await dropOffPost({ action: 'pickup', personIds: ['child:0'], code, collectedBy: 'Rick  Smith', idChecked: true })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('That name is on the may-NOT-collect list. Do not release. Call the parent.')
    expect(state.days['2026-09-05'].presence['child:0'].outAt).toBeFalsy()

    // Trailing tab.
    res = await dropOffPost({ action: 'pickup', personIds: ['child:0'], code, collectedBy: 'Rick Smith\t', idChecked: true })
    expect(res.status).toBe(400)
    expect(state.days['2026-09-05'].presence['child:0'].outAt).toBeFalsy()
  })

  it('Critical 1: fuzzyMatchesNotAuthorized ignores punctuation-only differences', async () => {
    mockGetEvent.mockResolvedValue(dropOffEvent)
    mockGetWaiverRecord.mockResolvedValue(dropOffWaiver({ notAuthorized: 'R Smith' }))
    const ci = await dropOffPost({ action: 'checkin', personIds: ['child:0'] })
    const code = (await ci.json()).data.oneTimeCode

    // "R. Smith" vs "R Smith" — punctuation-only difference.
    const res = await dropOffPost({ action: 'pickup', personIds: ['child:0'], code, collectedBy: 'R. Smith', idChecked: true })
    expect(res.status).toBe(400)
    expect(state.days['2026-09-05'].presence['child:0'].outAt).toBeFalsy()
  })

  it('Critical 1: also refuses on pickup-override, not just pickup', async () => {
    mockGetEvent.mockResolvedValue(dropOffEvent)
    mockGetWaiverRecord.mockResolvedValue(dropOffWaiver({ notAuthorized: 'Rick Smith' }))
    await dropOffPost({ action: 'checkin', personIds: ['child:0'] })

    const res = await dropOffPost({ action: 'pickup-override', personIds: ['child:0'], collectedBy: 'Rick  Smith', reason: 'parent-present', idChecked: true })
    expect(res.status).toBe(400)
    expect(state.days['2026-09-05'].presence['child:0'].outAt).toBeFalsy()
  })

  it('Important 3: an empty collectedBy cannot release a child, even with idChecked:true', async () => {
    mockGetEvent.mockResolvedValue(dropOffEvent)
    mockGetWaiverRecord.mockResolvedValue(dropOffWaiver())
    const ci = await dropOffPost({ action: 'checkin', personIds: ['child:0'] })
    const code = (await ci.json()).data.oneTimeCode

    const res = await dropOffPost({ action: 'pickup', personIds: ['child:0'], code, collectedBy: '', idChecked: true })
    expect(res.status).toBe(400)
    const j = await res.json()
    expect(j.error).toBe('Who’s collecting? Pick a name or type one.')
    expect(state.days['2026-09-05'].presence['child:0'].outAt).toBeFalsy()
    expect(state.releasedTo['child:0']).toBeUndefined()
  })

  it('Important 4: a wrong-code / locked denial response carries the live checkin state', async () => {
    mockGetEvent.mockResolvedValue(dropOffEvent)
    mockGetWaiverRecord.mockResolvedValue(dropOffWaiver())
    const ci = await dropOffPost({ action: 'checkin', personIds: ['child:0'] })
    const realCode = (await ci.json()).data.oneTimeCode
    const wrongCode = realCode === '1111' ? '2222' : '1111'

    let res = await dropOffPost({ action: 'pickup', personIds: ['child:0'], code: wrongCode, collectedBy: 'Grandma Rivera' })
    let json = await res.json()
    expect(res.status).toBe(400)
    expect(json.checkin.codeAttempts).toBe(1)
    expect(json.checkin.locked).toBe(false)

    for (let i = 0; i < 3; i++) {
      await dropOffPost({ action: 'pickup', personIds: ['child:0'], code: wrongCode, collectedBy: 'Grandma Rivera' })
    }
    res = await dropOffPost({ action: 'pickup', personIds: ['child:0'], code: wrongCode, collectedBy: 'Grandma Rivera' })
    json = await res.json()
    expect(res.status).toBe(423)
    expect(json.checkin.codeAttempts).toBe(5)
    expect(json.checkin.locked).toBe(true)
  })

  it("pickup-override with reason 'other' requires reasonText of at least 5 characters", async () => {
    mockGetEvent.mockResolvedValue(dropOffEvent)
    mockGetWaiverRecord.mockResolvedValue(dropOffWaiver())
    await dropOffPost({ action: 'checkin', personIds: ['child:0'] })

    let res = await dropOffPost({ action: 'pickup-override', personIds: ['child:0'], collectedBy: 'Grandma Rivera', reason: 'other', reasonText: 'hi' })
    expect(res.status).toBe(400)
    expect(state.days['2026-09-05'].presence['child:0'].outAt).toBeFalsy()

    res = await dropOffPost({ action: 'pickup-override', personIds: ['child:0'], collectedBy: 'Grandma Rivera', reason: 'other', reasonText: 'left a voicemail' })
    expect(res.status).toBe(200)
    expect(state.days['2026-09-05'].presence['child:0'].outAt).toBeTruthy()
  })

  it('pickup-override with a missing collectedBy is refused', async () => {
    mockGetEvent.mockResolvedValue(dropOffEvent)
    mockGetWaiverRecord.mockResolvedValue(dropOffWaiver())
    await dropOffPost({ action: 'checkin', personIds: ['child:0'] })

    const res = await dropOffPost({ action: 'pickup-override', personIds: ['child:0'], collectedBy: '', reason: 'parent-present' })
    expect(res.status).toBe(400)
    expect(state.days['2026-09-05'].presence['child:0'].outAt).toBeFalsy()
  })
})

// ─── HOM-214 fix round 1 addendum (findings 5–9) ──────────────────────────

describe('POST /api/staff/checkin.json — pickup completion, fix round 1 addendum', () => {
  it('finding 5: a failed code text logs code-sent with note "send failed"', async () => {
    mockGetEvent.mockResolvedValue(dropOffEvent)
    mockGetWaiverRecord.mockResolvedValue(dropOffWaiver())
    mockSendQuoText.mockRejectedValueOnce(new Error('Quo down'))

    const res = await dropOffPost({ action: 'checkin', personIds: ['child:0'] })
    expect(res.status).toBe(200)
    const codeSent = state.events.find((e) => e.action === 'code-sent')!
    expect(codeSent.note).toBe('send failed')
  })

  it('finding 5: a successful code text logs code-sent with no failure note', async () => {
    mockGetEvent.mockResolvedValue(dropOffEvent)
    mockGetWaiverRecord.mockResolvedValue(dropOffWaiver())

    await dropOffPost({ action: 'checkin', personIds: ['child:0'] })
    const codeSent = state.events.find((e) => e.action === 'code-sent')!
    expect(codeSent.note).toBeUndefined()
  })

  it('finding 6: a Reset (undo-checkin) that clears an active lock logs unlocked', async () => {
    mockGetEvent.mockResolvedValue(dropOffEvent)
    mockGetWaiverRecord.mockResolvedValue(dropOffWaiver())
    await dropOffPost({ action: 'checkin', personIds: ['child:0'] })
    state.lockedAt = new Date().toISOString()
    state.codeAttempts = 5

    const res = await dropOffPost({ action: 'undo-checkin' })
    expect(res.status).toBe(200)
    expect(state.lockedAt).toBeNull()
    const unlocked = state.events.find((e) => e.action === 'unlocked')!
    expect(unlocked.note).toBe('reset via undo-checkin')
  })

  it('finding 6: undo-checkin logs no unlocked event when there was no lock to clear', async () => {
    mockGetEvent.mockResolvedValue(dropOffEvent)
    mockGetWaiverRecord.mockResolvedValue(dropOffWaiver())
    await dropOffPost({ action: 'checkin', personIds: ['child:0'] })

    const res = await dropOffPost({ action: 'undo-checkin' })
    expect(res.status).toBe(200)
    expect(state.events.some((e) => e.action === 'unlocked')).toBe(false)
  })

  it('finding 7: set-pickup logs the before → after names', async () => {
    mockGetEvent.mockResolvedValue(dropOffEvent)
    mockGetWaiverRecord.mockResolvedValue(dropOffWaiver())
    await dropOffPost({ action: 'checkin', personIds: ['child:0'] }) // seeds confirmedPickup = [Grandma Rivera]

    const res = await dropOffPost({
      action: 'set-pickup',
      confirmedPickup: [{ name: 'Grandma Rivera', phone: '2565550100' }, { name: 'Uncle Joe', phone: '' }],
    })
    expect(res.status).toBe(200)
    const ev = state.events.find((e) => e.action === 'set-pickup')!
    expect(ev.note).toBe('Grandma Rivera → Grandma Rivera, Uncle Joe')
  })

  it('finding 7: set-pickup logs "(none)" when the list is cleared to empty', async () => {
    mockGetEvent.mockResolvedValue(dropOffEvent)
    mockGetWaiverRecord.mockResolvedValue(dropOffWaiver())
    await dropOffPost({ action: 'checkin', personIds: ['child:0'] })

    const res = await dropOffPost({ action: 'set-pickup', confirmedPickup: [] })
    expect(res.status).toBe(200)
    const ev = state.events.find((e) => e.action === 'set-pickup')!
    expect(ev.note).toBe('Grandma Rivera → (none)')
  })

  it('finding 8: a legitimate name is not refused just because it is a substring of the may-not-collect name', async () => {
    mockGetEvent.mockResolvedValue(dropOffEvent)
    mockGetWaiverRecord.mockResolvedValue(dropOffWaiver({ notAuthorized: 'Patrick Smith' }))
    const ci = await dropOffPost({ action: 'checkin', personIds: ['child:0'] })
    const code = (await ci.json()).data.oneTimeCode

    const res = await dropOffPost({ action: 'pickup', personIds: ['child:0'], code, collectedBy: 'Rick', idChecked: true })
    expect(res.status).toBe(200)
  })

  it('finding 8: "rick smith" still matches "Rick  Smith" (whitespace-only difference)', async () => {
    mockGetEvent.mockResolvedValue(dropOffEvent)
    mockGetWaiverRecord.mockResolvedValue(dropOffWaiver({ notAuthorized: 'Rick  Smith' }))
    const ci = await dropOffPost({ action: 'checkin', personIds: ['child:0'] })
    const code = (await ci.json()).data.oneTimeCode

    const res = await dropOffPost({ action: 'pickup', personIds: ['child:0'], code, collectedBy: 'rick smith', idChecked: true })
    expect(res.status).toBe(400)
  })

  it('finding 8: "R Smith" still matches "R. Smith" (punctuation-only difference)', async () => {
    mockGetEvent.mockResolvedValue(dropOffEvent)
    mockGetWaiverRecord.mockResolvedValue(dropOffWaiver({ notAuthorized: 'R. Smith' }))
    const ci = await dropOffPost({ action: 'checkin', personIds: ['child:0'] })
    const code = (await ci.json()).data.oneTimeCode

    const res = await dropOffPost({ action: 'pickup', personIds: ['child:0'], code, collectedBy: 'R Smith', idChecked: true })
    expect(res.status).toBe(400)
  })

  it('finding 8: a bare surname on the may-not-collect line still refuses a full matching name', async () => {
    mockGetEvent.mockResolvedValue(dropOffEvent)
    mockGetWaiverRecord.mockResolvedValue(dropOffWaiver({ notAuthorized: 'Smith' }))
    const ci = await dropOffPost({ action: 'checkin', personIds: ['child:0'] })
    const code = (await ci.json()).data.oneTimeCode

    const res = await dropOffPost({ action: 'pickup', personIds: ['child:0'], code, collectedBy: 'Rick Smith', idChecked: true })
    expect(res.status).toBe(400)
    expect(state.days['2026-09-05'].presence['child:0'].outAt).toBeFalsy()
  })

  it('finding 9: releasing an adult with no collectedBy writes no releasedTo entry', async () => {
    mockGetEvent.mockResolvedValue(dropOffEvent)
    mockGetWaiverRecord.mockResolvedValue(dropOffWaiver())
    state.days['2026-09-05'] = { presence: { adult: { inAt: '2026-09-05T14:00:00.000Z', outAt: null } } }

    const res = await dropOffPost({ action: 'pickup', personIds: ['adult'] })
    expect(res.status).toBe(200)
    expect(state.releasedTo.adult).toBeUndefined()
  })
})

// ─── Final fix wave ───────────────────────────────────────────────────────

describe('POST /api/staff/checkin.json — unresolvable event (C1)', () => {
  it('refuses a pickup outright when the event cannot be resolved — never falls back to dropOff=false', async () => {
    mockGetEvent.mockResolvedValue(null)
    mockGetWaiverRecord.mockResolvedValue(dropOffWaiver())
    state.days['2026-09-05'] = { presence: { 'child:0': { inAt: '2026-09-05T14:00:00.000Z', outAt: null } } }

    const res = await dropOffPost({ action: 'pickup', personIds: ['child:0'] })
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Couldn’t confirm this event — refresh the roster and try again.')
    // The child is still on-site and nothing was written.
    expect(state.days['2026-09-05'].presence['child:0'].outAt).toBeNull()
    expect(state.events).toHaveLength(0)
    expect(mockMutate).not.toHaveBeenCalled()
  })

  it('refuses every other action too, before any mutation', async () => {
    mockGetEvent.mockResolvedValue(null)
    for (const action of ['checkin', 'undo-checkin', 'pickup-override', 'undo-pickup', 'reissue-code', 'set-pickup']) {
      const res = await dropOffPost({ action, personIds: ['child:0'], reason: 'called-parent', collectedBy: 'X' })
      expect(res.status).toBe(404)
    }
    expect(mockMutate).not.toHaveBeenCalled()
  })
})

describe('POST /api/staff/checkin.json — pickup seeding is one-shot (I1)', () => {
  it('clearing an unsafe collector with set-pickup is not undone by the next check-in', async () => {
    mockGetEvent.mockResolvedValue(dropOffEvent)
    mockGetWaiverRecord.mockResolvedValue(dropOffWaiver())

    // First check-in seeds the waiver's pickup people.
    await dropOffPost({ action: 'checkin', personIds: ['child:0'] })
    expect(state.confirmedPickup.map((p) => p.name)).toEqual(['Grandma Rivera'])

    // Staff remove the collector who must not have the child.
    await dropOffPost({ action: 'set-pickup', confirmedPickup: [] })
    expect(state.confirmedPickup).toEqual([])

    // The next check-in (a sibling, or day 2) must NOT re-seed from the waiver.
    await dropOffPost({ action: 'checkin', personIds: ['child:0'] })
    expect(state.confirmedPickup).toEqual([])
  })

  it('a legacy state with no pickupSeeded flag still seeds once, then stops', async () => {
    mockGetEvent.mockResolvedValue(dropOffEvent)
    mockGetWaiverRecord.mockResolvedValue(dropOffWaiver())
    delete (state as any).pickupSeeded

    await dropOffPost({ action: 'checkin', personIds: ['child:0'] })
    expect(state.confirmedPickup.map((p) => p.name)).toEqual(['Grandma Rivera'])
    expect(state.pickupSeeded).toBe(true)

    await dropOffPost({ action: 'set-pickup', confirmedPickup: [] })
    await dropOffPost({ action: 'checkin', personIds: ['child:0'] })
    expect(state.confirmedPickup).toEqual([])
  })
})

describe('POST /api/staff/checkin.json — override audit + copy', () => {
  it('M2: a pickup-override that clears a lock logs unlocked with "cleared by override"', async () => {
    mockGetEvent.mockResolvedValue(dropOffEvent)
    mockGetWaiverRecord.mockResolvedValue(dropOffWaiver())
    await dropOffPost({ action: 'checkin', personIds: ['child:0'] })
    state.lockedAt = new Date().toISOString()
    state.codeAttempts = 5

    const res = await dropOffPost({ action: 'pickup-override', personIds: ['child:0'], collectedBy: 'Grandma Rivera', reason: 'parent-present' })
    expect(res.status).toBe(200)
    const unlocked = state.events.find((e) => e.action === 'unlocked')!
    expect(unlocked).toBeTruthy()
    expect(unlocked.note).toBe('cleared by override')
  })

  it('M2: an override with no lock in place logs no unlocked event', async () => {
    mockGetEvent.mockResolvedValue(dropOffEvent)
    mockGetWaiverRecord.mockResolvedValue(dropOffWaiver())
    await dropOffPost({ action: 'checkin', personIds: ['child:0'] })

    const res = await dropOffPost({ action: 'pickup-override', personIds: ['child:0'], collectedBy: 'Grandma Rivera', reason: 'parent-present' })
    expect(res.status).toBe(200)
    expect(state.events.some((e) => e.action === 'unlocked')).toBe(false)
  })

  it('I3: the no-code message names the button that is actually on screen', async () => {
    mockGetEvent.mockResolvedValue(dropOffEvent)
    mockGetWaiverRecord.mockResolvedValue(dropOffWaiver())
    state.days['2026-09-05'] = { presence: { 'child:0': { inAt: '2026-09-05T14:00:00.000Z', outAt: null } } }

    const res = await dropOffPost({ action: 'pickup', personIds: ['child:0'], code: '1234', collectedBy: 'Grandma Rivera', idChecked: true })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('No pickup code has been issued for this family — use "Issue pickup code" first.')
  })
})

describe('non-drop-off events are attendance-only', () => {
  const MSG = "This event isn't drop-off — there's nothing to check out."

  it.each(['pickup', 'undo-pickup', 'pickup-override', 'reissue-code', 'set-pickup'])(
    '%s on a non-drop-off event → 400 and nothing is written',
    async (action) => {
      const res = await POST(ctx({ party: 'party-1', recordId: 'rec-1', action, personIds: ['adult'], collectedBy: 'x', reason: 'parent-present', confirmedPickup: [] }))
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe(MSG)
      expect(mockMutate).not.toHaveBeenCalled()
    },
  )

  it('checkin and undo-checkin still work, and never issue a code', async () => {
    const inRes = await POST(ctx({ party: 'party-1', recordId: 'rec-1', action: 'checkin', personIds: ['adult'] }))
    expect(inRes.status).toBe(200)
    expect((await inRes.json()).data.oneTimeCode).toBeUndefined()
    expect(state.days['2026-09-05'].presence.adult.outAt).toBeNull()
    const undo = await POST(ctx({ party: 'party-1', recordId: 'rec-1', action: 'undo-checkin', personIds: ['adult'] }))
    expect(undo.status).toBe(200)
    expect(state.days['2026-09-05'].presence.adult).toBeUndefined()
  })

  it('drop-off events still take the pickup actions (unchanged)', async () => {
    mockGetEvent.mockResolvedValue(dropOffEvent)
    mockGetWaiverRecord.mockResolvedValue(dropOffWaiver())
    const res = await dropOffPost({ action: 'reissue-code', reason: 'lost' })
    expect(res.status).toBe(200)
    expect((await res.json()).data.oneTimeCode).toMatch(/^\d{4}$/)
  })
})

describe('pickup follows the household (seeding)', () => {
  it('(a) check-in at event B seeds the may-NOT-collect / list from the household\'s other RSVP', async () => {
    mockGetEvent.mockResolvedValue(dropOffEvent)
    mockGetWaiverRecord.mockResolvedValue(dropOffWaiver({ authorizedPickup: [], notAuthorized: '' }))
    mockLatest.mockResolvedValue({ authorizedPickup: [{ name: 'Aunt Sue', phone: '' }], notAuthorized: 'Rick Smith' })
    await dropOffPost({ action: 'checkin', personIds: ['child:0'] })
    expect(state.notAuthorized).toBe('Rick Smith')
    expect(state.confirmedPickup.map((p) => p.name)).toEqual(['Aunt Sue'])
  })

  it('(a) check-in seeds BOTH the rows and the older may-NOT-collect note', async () => {
    mockGetEvent.mockResolvedValue(dropOffEvent)
    mockGetWaiverRecord.mockResolvedValue(dropOffWaiver({ authorizedPickup: [], notAuthorized: 'Rick Smith', signedAt: '2026-01-01T00:00:00.000Z' }))
    mockLatest.mockResolvedValue({ authorizedPickup: [{ name: 'Aunt Sue', phone: '' }], notAuthorized: '', at: '2026-06-01T00:00:00.000Z' })
    await dropOffPost({ action: 'checkin', personIds: ['child:0'] })
    expect(state.notAuthorized).toBe('Rick Smith')
    expect(state.confirmedPickup.map((p) => p.name)).toEqual(['Aunt Sue'])
  })

  it('(c) a newer "None" note seeds no restriction', async () => {
    mockGetEvent.mockResolvedValue(dropOffEvent)
    mockGetWaiverRecord.mockResolvedValue(dropOffWaiver({ authorizedPickup: [], notAuthorized: 'Rick Smith', signedAt: '2026-01-01T00:00:00.000Z' }))
    mockLatest.mockResolvedValue({ authorizedPickup: [], notAuthorized: 'None', at: '2026-06-01T00:00:00.000Z' })
    await dropOffPost({ action: 'checkin', personIds: ['child:0'] })
    expect(state.notAuthorized).toBe('')
  })
})
