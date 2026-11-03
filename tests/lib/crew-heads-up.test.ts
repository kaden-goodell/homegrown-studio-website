/**
 * DV19 / final crew review I6: the owners hear about every crew refund, comp
 * and gift card, at most once an hour (the first at once, the rest together).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({
  text: vi.fn(async (_c: string) => ({ attempted: 1, sent: 1 })),
  email: vi.fn(async (_i: any) => ({ sent: true })),
  to: 'kaden@x.com, catherine@x.com',
}))
vi.mock('@lib/owner-alert', () => ({ alertOwners: (c: string) => m.text(c) }))
vi.mock('@lib/email', () => ({ sendEmail: (i: any) => m.email(i) }))
vi.mock('@lib/notify-settings', () => ({ emailsFor: async () => m.to }))

import { recordAudit } from '@lib/audit'
import { _resetHeadsUpForTests, flushCrewHeadsUp, headsUpLine, noteCrewAction, pendingHeadsUp, HEADS_UP_EVERY_MS } from '@lib/crew-heads-up'
import type { AuditEntry } from '@lib/audit'

const sam = { id: 'sam', name: 'Sam', role: 'crew' as const }
const entry = (over: Partial<AuditEntry>): AuditEntry => ({
  id: 'au_1', at: '2026-11-07T19:00:00.000Z', by: sam, action: 'class-refund',
  target: { kind: 'class', id: 'cls_1', label: 'Pottery Sat' }, details: { cents: 8500, reason: 'no-show, asked nicely' }, ...over,
})

beforeEach(async () => {
  await _resetHeadsUpForTests()
  m.text.mockClear(); m.email.mockClear(); m.to = 'kaden@x.com, catherine@x.com'
  m.text.mockImplementation(async () => ({ attempted: 1, sent: 1 }))
  m.email.mockImplementation(async () => ({ sent: true }))
})

describe('which actions', () => {
  it('crew refunds, comps and gift cards; never owners, never simulated, never other actions', () => {
    expect(headsUpLine(entry({}))).toBe('Sam: refunded $85.00 on Pottery Sat: “no-show, asked nicely”')
    expect(headsUpLine(entry({ action: 'party-refund', target: { kind: 'party', id: 'p', label: 'the Justice party' }, details: { cents: 1000, reason: 'sick' } }))).toBe('Sam: refunded $10.00 on the Justice party: “sick”')
    expect(headsUpLine(entry({ action: 'seat.comped', target: { kind: 'workshop', id: 'c', label: 'Candles' }, details: { seats: 2, name: 'Jo Friend' } }))).toBe('Sam: comped 2 seats for Jo Friend on Candles')
    // Crew I6: the comp's reason rides along, the same as a refund's.
    expect(headsUpLine(entry({ action: 'seat.comped', target: { kind: 'workshop', id: 'c', label: 'Candles' }, details: { seats: 1, name: 'Jo Friend', reason: 'make-up class' } }))).toBe('Sam: comped a seat for Jo Friend on Candles: “make-up class”')
    expect(headsUpLine(entry({ action: 'gift-card.minted', target: { kind: 'gift-card', id: 'gc', label: 'Megan' }, details: { amountCents: 20000, forWhom: 'Megan', note: 'giveaway' } }))).toBe('Sam: made a $200.00 gift card for Megan: “giveaway”')
    expect(headsUpLine(entry({ by: { id: 'k', name: 'Kaden', role: 'owner' } }))).toBeNull()
    expect(headsUpLine(entry({ simulated: true }))).toBeNull()
    expect(headsUpLine(entry({ action: 'checkin.here' }))).toBeNull()
  })

  it('crew turning drop-off off (before the event; /staff refuses it during) is a heads-up; on, or other settings, are not', () => {
    const off = entry({ action: 'event.settings', target: { kind: 'party', id: 'p1', label: 'Glow Night' }, details: { changed: 'dropOff', dropOff: false } })
    expect(headsUpLine(off)).toBe('Sam: turned drop-off off for Glow Night (kids leave without a pickup code)')
    expect(headsUpLine({ ...off, details: { changed: 'dropOff', dropOff: true } })).toBeNull()
    expect(headsUpLine({ ...off, details: { changed: 'capacity', capacity: 12 } })).toBeNull()
    expect(headsUpLine({ ...off, by: { id: 'k', name: 'Kaden', role: 'owner' } })).toBeNull()
  })
})

describe('batched per hour', () => {
  it('the first goes at once (text + email); later ones wait for the hour, then go together', async () => {
    const t0 = new Date('2026-11-07T19:00:00.000Z')
    await noteCrewAction(entry({}), t0)
    expect(m.text).toHaveBeenCalledTimes(1)
    expect(m.text.mock.calls[0][0]).toContain('Sam: refunded $85.00 on Pottery Sat')
    expect(m.email).toHaveBeenCalledTimes(1)
    expect(m.email.mock.calls[0][0].to).toBe('kaden@x.com, catherine@x.com')
    expect(await pendingHeadsUp()).toEqual([])

    const t1 = new Date(t0.getTime() + 10 * 60_000)
    await noteCrewAction(entry({ action: 'seat.comped', details: { seats: 1, name: 'Jo' } }), t1)
    await noteCrewAction(entry({ action: 'gift-card.minted', details: { amountCents: 5000, forWhom: 'Ann' } }), t1)
    expect(m.text).toHaveBeenCalledTimes(1)
    expect(await pendingHeadsUp()).toHaveLength(2)
    expect((await flushCrewHeadsUp(new Date(t0.getTime() + 30 * 60_000))).sent).toBe(0)

    const r = await flushCrewHeadsUp(new Date(t0.getTime() + HEADS_UP_EVERY_MS))
    expect(r).toEqual({ sent: 2, text: true, email: true })
    expect(m.text).toHaveBeenCalledTimes(2)
    expect(m.text.mock.calls[1][0]).toMatch(/^Crew heads-up, 2 things: Sam: comped a seat for Jo on Pottery Sat; Sam: made a \$50\.00 gift card for Ann/)
    expect(m.email.mock.calls[1][0].subject).toBe('Crew heads-up: 2 things to know')
    expect(await pendingHeadsUp()).toEqual([])
  })

  it('when nobody could be reached the lines stay for the next run', async () => {
    m.text.mockImplementation(async () => ({ attempted: 0, sent: 0 }))
    m.to = ''
    await noteCrewAction(entry({}), new Date('2026-11-07T19:00:00.000Z'))
    expect(await pendingHeadsUp()).toHaveLength(1)
  })

  it('recordAudit hands crew entries over (and an owner’s are never sent)', async () => {
    await recordAudit({ by: { id: 'k', name: 'Kaden', role: 'owner' }, action: 'class-refund', target: { kind: 'class', id: 'c', label: 'X' }, details: { cents: 100 } })
    expect(m.text).not.toHaveBeenCalled()
    await recordAudit({ by: sam, action: 'gift-card.minted', target: { kind: 'gift-card', id: 'gc', label: 'Megan' }, details: { amountCents: 2500, forWhom: 'Megan' } })
    expect(m.text).toHaveBeenCalledTimes(1)
    expect(m.text.mock.calls[0][0]).toContain('Sam: made a $25.00 gift card for Megan')
  })
})
