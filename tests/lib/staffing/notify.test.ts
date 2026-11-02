// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const sent = vi.hoisted(() => ({ emails: [] as any[], emailOk: true }))
vi.mock('@lib/email', () => ({
  sendShiftEmail: vi.fn(async (m: any) => { sent.emails.push(m); return { sent: sent.emailOk } }),
}))

import { shiftMessage, shiftClock, shiftDay, tellPerson, toldWarning, shiftsLinkFor } from '@lib/staffing/notify'
import { PREVIEW_SMS_TO } from '@lib/preview-outbound'

// Sun Oct 25 2026, 1–3 PM CDT
const klass = { kind: 'class' as const, title: 'Needlepoint 101', detail: {}, startIso: '2026-10-25T18:00:00.000Z', endIso: '2026-10-25T20:00:00.000Z' }
const party = { kind: 'party' as const, title: 'Party · 14 guests', detail: { guests: 14, hostFirst: 'Stefanie' }, startIso: '2026-10-24T19:30:00.000Z', endIso: '2026-10-24T21:30:00.000Z' }
const jessica = { name: 'Jessica', givenName: 'Jessica', email: 'jessica@example.com', phone: '+12565550199' }
/** No colon anywhere except inside a clock time like 1:30. */
const noSentenceColon = (s: string) => expect(s.replace(/\d{1,2}:\d{2}/g, '')).not.toContain(':')

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  sent.emails = []
  sent.emailOk = true
  fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('QUO_API_KEY', 'test-key')
  vi.stubEnv('QUO_FROM_NUMBER', '+12565550100')
  vi.stubEnv('STORE_NAMESPACE', 'preview')
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('the words', () => {
  it('on a class: what, day, times; the staff page without https', () => {
    const m = shiftMessage('on', klass, 'ourhometownstudio.com/staff')
    expect(m.text).toBe("Hometown Studio here. You're on Needlepoint 101, Sun Oct 25, 1 PM to 3 PM. See your shifts at ourhometownstudio.com/staff")
    expect(m.subject).toBe("You're on Needlepoint 101, Sun Oct 25")
    expect(m.lines[0]).toBe("You're on Needlepoint 101, Sun Oct 25, 1 PM to 3 PM.")
    for (const s of [m.text, m.subject, ...m.lines]) noSentenceColon(s)
  })

  it('off a class', () => {
    const m = shiftMessage('off', klass, 'x/staff')
    expect(m.text).toBe("Hometown Studio here. You're no longer on Needlepoint 101, Sun Oct 25. Thanks!")
    for (const s of [m.text, m.subject, ...m.lines]) noSentenceColon(s)
  })

  it('a party never names the host; half hours read 2:30 PM', () => {
    const m = shiftMessage('on', party, 'x/staff')
    expect(m.text).toBe("Hometown Studio here. You're on a party for 14 guests, Sat Oct 24, 2:30 PM to 4:30 PM. See your shifts at x/staff")
    expect(JSON.stringify(m)).not.toMatch(/Stefanie|·/)
    for (const s of [m.text, m.subject, ...m.lines]) noSentenceColon(s)
  })

  it('several days of one class: ONE message listing the days', () => {
    const day = (d: number) => ({ ...klass, startIso: `2026-12-${d}T15:00:00.000Z`, endIso: `2026-12-${d}T18:00:00.000Z` }) // 9 AM to 12 PM CST
    let m = shiftMessage('on', [day(23), day(21), day(22)], 'x/staff')
    expect(m.text).toBe("Hometown Studio here. You're on Needlepoint 101, Mon Dec 21, Tue Dec 22 and Wed Dec 23, 9 AM to 12 PM. See your shifts at x/staff")
    expect(m.subject).toBe("You're on Needlepoint 101, 3 days from Mon Dec 21")
    // different times each day: each day says its own
    m = shiftMessage('on', [day(21), { ...day(22), endIso: '2026-12-22T19:00:00.000Z' }], 'x/staff')
    expect(m.lines[0]).toBe("You're on Needlepoint 101, Mon Dec 21 9 AM to 12 PM and Tue Dec 22 9 AM to 1 PM.")
    m = shiftMessage('off', [day(21), day(22)], 'x/staff')
    expect(m.text).toBe("Hometown Studio here. You're no longer on Needlepoint 101, Mon Dec 21 and Tue Dec 22. Thanks!")
    for (const s of [m.text, m.subject, ...m.lines]) noSentenceColon(s)
  })

  it('clock and day helpers', () => {
    expect(shiftClock('2026-10-25T17:00:00.000Z')).toBe('12 PM')
    expect(shiftClock('2026-10-25T05:00:00.000Z')).toBe('12 AM')
    expect(shiftClock('2026-11-02T00:00:00.000Z')).toBe('6 PM') // Sun Nov 1, after the clocks went back
    expect(shiftDay('2026-11-02T00:00:00.000Z')).toBe('Sun Nov 1')
    expect(shiftsLinkFor('https://kaden-own-booking-system--site.netlify.app')).toEqual({ bare: 'kaden-own-booking-system--site.netlify.app/staff', url: 'https://kaden-own-booking-system--site.netlify.app/staff' })
  })
})

describe('tellPerson', () => {
  it('one email and one text; on a preview the text goes to Kaden only', async () => {
    const r = await tellPerson('on', jessica, klass, 'https://ourhometownstudio.com')
    expect(r).toEqual({ email: true, text: true, failed: false, warning: null })
    expect(sent.emails).toHaveLength(1)
    expect(sent.emails[0]).toMatchObject({ to: 'jessica@example.com', givenName: 'Jessica', subject: "You're on Needlepoint 101, Sun Oct 25", shiftsUrl: 'https://ourhometownstudio.com/staff' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse((fetchMock.mock.calls[0] as any)[1].body)
    expect(body.to).toEqual([PREVIEW_SMS_TO])
    expect(body.content).toContain("You're on Needlepoint 101")
  })

  it('a failed text keeps going and says so plainly', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 500 }))
    const r = await tellPerson('on', jessica, klass, 'https://ourhometownstudio.com')
    expect(r).toEqual({ email: true, text: false, failed: true, warning: "Saved. The text to Jessica didn't go through." })
  })

  it('missing contact details', async () => {
    expect((await tellPerson('on', { ...jessica, phone: null }, klass, 'https://x.test')).warning).toBe("Saved. There's no phone number saved for Jessica, so only the email went. Add one in More › Staff › People.")
    expect((await tellPerson('on', { ...jessica, email: null, phone: null }, klass, 'https://x.test')).warning).toBe("Saved. There's no phone or email saved for Jessica, so no message went. Add a phone or email for Jessica in More › Staff › People.")
  })

  it('warning wording', () => {
    expect(toldWarning('Jessica', { hasEmail: true, hasPhone: true, email: false, text: false })).toBe("Saved. The text and email to Jessica didn't go through.")
    expect(toldWarning('Jessica', { hasEmail: true, hasPhone: false, email: false, text: false })).toBe("Saved. The email to Jessica didn't go through.")
    expect(toldWarning('Jessica', { hasEmail: false, hasPhone: true, email: false, text: true })).toBe("Saved. There's no email saved for Jessica, so only the text went. Add one in More › Staff › People.")
  })
})
