/**
 * Guest seats: a booker's extra seats have no name, so a friend who signs her
 * own agreement matched no booking at the door ("No seat on record"). The
 * guest link in the confirmation, or one tap at check-in, ties her household
 * to the booking's seat. Only a link: never money, seats or Square.
 */
import { describe, it, expect } from 'vitest'
import {
  guestToken, readGuestToken, guestWaiverPath,
  attachGuest, detachGuest, listGuestLinks, guestSeatView,
  type GuestLink,
} from '@lib/guest-links'
import type { SeatChoiceRecord } from '@lib/seat-choices'

const rec = (over: Partial<SeatChoiceRecord> & { bookingId: string; seats: number; email: string; name?: string }): SeatChoiceRecord => {
  const [givenName, familyName = ''] = (over.name ?? 'Shelby Taylor').split(' ')
  const { email, name: _n, ...rest } = over
  return {
    eventKind: 'workshop', eventId: 'clssch_door', orderId: null,
    customer: { givenName, familyName, email, phone: '' },
    picks: [], at: '2026-11-17T12:00:00.000Z', attemptId: 'a', ...rest,
  }
}
const hh = (recordId: string, email: string, signer: string) => ({ recordId, email, signer })
const link = (recordId: string, bookingId: string, at: string, via: GuestLink['via'] = 'staff'): GuestLink =>
  ({ recordId, bookingId, at, via, by: via === 'staff' ? { id: 's', name: 'Sam' } : null })

describe('guest link token', () => {
  it('round-trips for the same class and booking', () => {
    const t = guestToken('clssch_door', 'clsbk_shelby')
    expect(readGuestToken('clssch_door', t)).toBe('clsbk_shelby')
  })

  it('is scoped to one class: the same token on another class reads as nothing', () => {
    const t = guestToken('clssch_door', 'clsbk_shelby')
    expect(readGuestToken('clssch_other', t)).toBeNull()
  })

  it('cannot be forged by swapping the booking id', () => {
    const t = guestToken('clssch_door', 'clsbk_shelby')
    const sig = t.split('.')[1]
    expect(readGuestToken('clssch_door', `clsbk_other.${sig}`)).toBeNull()
  })

  it('refuses junk without throwing', () => {
    for (const raw of [undefined, null, 42, '', 'nodot', 'a.b.c', 'x'.repeat(400), 'clsbk_shelby.']) {
      expect(readGuestToken('clssch_door', raw as any)).toBeNull()
    }
  })

  it('carries an unguessable signature (not just the booking id)', () => {
    const t = guestToken('clssch_door', 'clsbk_shelby')
    expect(t.split('.')[1].length).toBeGreaterThanOrEqual(20)
  })

  it('the waiver path names the class and the token, never the plain booking link', () => {
    const p = guestWaiverPath('clssch_door', 'clsbk_shelby')
    expect(p.startsWith('/waiver?workshop=clssch_door&guest=')).toBe(true)
    expect(p).not.toContain('booking=')
    const u = new URL(`https://x.test${p}`)
    expect(readGuestToken('clssch_door', u.searchParams.get('guest'))).toBe('clsbk_shelby')
  })
})

describe('guest link store', () => {
  it('attach is idempotent and undo removes it', async () => {
    const ev = `clssch_store_${Math.random().toString(36).slice(2)}`
    await attachGuest({ eventId: ev, bookingId: 'b1', recordId: 'wvr_janea', via: 'staff', by: { id: 's', name: 'Sam' } })
    await attachGuest({ eventId: ev, bookingId: 'b1', recordId: 'wvr_janea', via: 'staff', by: { id: 's', name: 'Sam' } })
    let links = await listGuestLinks(ev)
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({ recordId: 'wvr_janea', bookingId: 'b1', via: 'staff', by: { id: 's', name: 'Sam' } })
    const firstAt = links[0].at

    // a repeat keeps the first time (seat order is by when they were attached)
    await attachGuest({ eventId: ev, bookingId: 'b1', recordId: 'wvr_janea', via: 'link', by: null })
    links = await listGuestLinks(ev)
    expect(links[0].at).toBe(firstAt)

    expect(await detachGuest(ev, 'wvr_janea')).toBe(true)
    expect(await listGuestLinks(ev)).toEqual([])
    expect(await detachGuest(ev, 'wvr_janea')).toBe(false)
  })

  it('a household is one booking\'s guest at a time: attaching to another booking moves it', async () => {
    const ev = `clssch_store_${Math.random().toString(36).slice(2)}`
    await attachGuest({ eventId: ev, bookingId: 'b1', recordId: 'wvr_janea', via: 'staff', by: { id: 's', name: 'Sam' } })
    await attachGuest({ eventId: ev, bookingId: 'b2', recordId: 'wvr_janea', via: 'staff', by: { id: 's', name: 'Sam' } })
    const links = await listGuestLinks(ev)
    expect(links).toHaveLength(1)
    expect(links[0].bookingId).toBe('b2')
  })

  it('keeps each class separate', async () => {
    const a = `clssch_a_${Math.random().toString(36).slice(2)}`
    const b = `clssch_b_${Math.random().toString(36).slice(2)}`
    await attachGuest({ eventId: a, bookingId: 'b1', recordId: 'wvr_janea', via: 'link', by: null })
    expect(await listGuestLinks(b)).toEqual([])
  })
})

describe('guestSeatView', () => {
  const shelby = rec({ bookingId: 'b_shelby', seats: 2, email: 'shelby@x.com', name: 'Shelby Taylor' })
  const households = [hh('wvr_shelby', 'Shelby@X.com', 'Shelby Taylor'), hh('wvr_janea', 'janea@x.com', 'Janea Boyd')]

  it('a household linked to a booking shows as the booker\'s guest in seat 2', () => {
    const v = guestSeatView([shelby], households, [link('wvr_janea', 'b_shelby', '2026-11-18T00:00:00Z', 'link')])
    expect(v.guestOf.wvr_janea).toEqual({ bookingId: 'b_shelby', bookerName: 'Shelby Taylor', seat: 2, of: 2 })
    expect(v.guestsByEmail['shelby@x.com']).toEqual(['Janea Boyd'])
    // Shelby's one guest seat is used now
    expect(v.matches).toEqual([])
  })

  it('offers each booking with an open guest seat (seats − booker − guests already attached)', () => {
    const big = rec({ bookingId: 'b_amy', seats: 4, email: 'amy@x.com', name: 'Amy Lee' })
    const v = guestSeatView([shelby, big], households, [link('wvr_other', 'b_amy', '2026-11-18T00:00:00Z')])
    expect(v.matches).toEqual([
      { bookingId: 'b_shelby', bookerName: 'Shelby Taylor', open: 1 },
      { bookingId: 'b_amy', bookerName: 'Amy Lee', open: 2 },
    ])
  })

  it('a one-seat booking has no guest seat', () => {
    const solo = rec({ bookingId: 'b_solo', seats: 1, email: 'solo@x.com', name: 'Solo Person' })
    expect(guestSeatView([solo], [], []).matches).toEqual([])
  })

  it('caps guests at seats − 1: a later signer through the link shows as a guest with no seat', () => {
    const v = guestSeatView([shelby], [...households, hh('wvr_third', 'third@x.com', 'Third Friend')], [
      link('wvr_janea', 'b_shelby', '2026-11-18T00:00:00Z', 'link'),
      link('wvr_third', 'b_shelby', '2026-11-18T01:00:00Z', 'link'),
    ])
    expect(v.guestOf.wvr_janea.seat).toBe(2)
    expect(v.guestOf.wvr_third).toEqual({ bookingId: 'b_shelby', bookerName: 'Shelby Taylor', seat: null, of: 2 })
    // only seated guests count against the booker's seats
    expect(v.guestsByEmail['shelby@x.com']).toEqual(['Janea Boyd'])
  })

  it('ignores a link from the booker\'s own household (she opened her guest link herself)', () => {
    const v = guestSeatView([shelby], households, [link('wvr_shelby', 'b_shelby', '2026-11-18T00:00:00Z', 'link')])
    expect(v.guestOf.wvr_shelby).toBeUndefined()
    expect(v.matches).toEqual([{ bookingId: 'b_shelby', bookerName: 'Shelby Taylor', open: 1 }])
  })

  it('ignores a link to a booking that is not on this day (refunded, or another day of the class)', () => {
    const v = guestSeatView([shelby], households, [link('wvr_janea', 'b_gone', '2026-11-18T00:00:00Z')])
    expect(v.guestOf.wvr_janea).toBeUndefined()
  })

  it('never offers a counter sale with no name yet (it has its own "Who is it?")', () => {
    const counter = rec({ bookingId: 'b_counter', seats: 3, email: '', name: 'Counter sale, no name yet' })
    expect(guestSeatView([counter], [], []).matches).toEqual([])
  })

  it('works the same for a Square-era class record and one of our own', () => {
    const own = rec({ bookingId: 'bkg_1', seats: 2, email: 'shelby@x.com', eventId: 'cls_1' })
    const v = guestSeatView([own], households, [link('wvr_janea', 'bkg_1', '2026-11-18T00:00:00Z')])
    expect(v.guestOf.wvr_janea).toMatchObject({ seat: 2, of: 2 })
  })
})
