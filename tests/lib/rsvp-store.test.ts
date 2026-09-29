/**
 * Tests for rsvp-store: one RSVP per household (waiverId) per event,
 * firstAt preserved across re-RSVP, list-by-event.
 */
import { describe, it, expect } from 'vitest'
import { upsertRsvp, getRsvp, listRsvpsByEvent, getLatestPickupForWaiver, type RsvpRecord } from '@lib/rsvp-store'

const base: Omit<RsvpRecord, 'id' | 'firstAt'> = {
  waiverId: 'wvr_a',
  event: { kind: 'workshop', id: 'cs_' + Date.now() },
  attending: ['adult', 'child:0'],
  responsibleAdult: null,
  at: '2026-10-01T00:00:00.000Z',
  ip: null,
  userAgent: null,
}

describe('rsvp-store', () => {
  it('upserts one RSVP per household per event, keeping firstAt', async () => {
    const a = await upsertRsvp(base)
    expect(a.id).toMatch(/^rsv_/)
    expect(a.firstAt).toBe(base.at)

    const b = await upsertRsvp({ ...base, at: '2026-10-02T00:00:00.000Z', attending: ['adult'] })
    expect(b.firstAt).toBe(base.at)
    expect(b.attending).toEqual(['adult'])

    expect((await listRsvpsByEvent('workshop', base.event.id)).length).toBe(1)
    expect((await getRsvp('workshop', base.event.id, 'wvr_a'))!.id).toBe(b.id)
  })

  it('keeps separate households (waiverIds) as separate RSVPs for the same event', async () => {
    const eventId = 'cs_multi_' + Date.now()
    await upsertRsvp({ ...base, event: { kind: 'workshop', id: eventId }, waiverId: 'wvr_mom' })
    await upsertRsvp({ ...base, event: { kind: 'workshop', id: eventId }, waiverId: 'wvr_dad' })

    const rsvps = await listRsvpsByEvent('workshop', eventId)
    expect(rsvps.map((r) => r.waiverId).sort()).toEqual(['wvr_dad', 'wvr_mom'])
  })

  it('does not mix RSVPs from different events', async () => {
    const eventA = 'cs_evtA_' + Date.now()
    const eventB = 'cs_evtB_' + Date.now()
    await upsertRsvp({ ...base, event: { kind: 'workshop', id: eventA }, waiverId: 'wvr_x' })
    await upsertRsvp({ ...base, event: { kind: 'workshop', id: eventB }, waiverId: 'wvr_y' })

    expect((await listRsvpsByEvent('workshop', eventA)).map((r) => r.waiverId)).toEqual(['wvr_x'])
    expect((await listRsvpsByEvent('workshop', eventB)).map((r) => r.waiverId)).toEqual(['wvr_y'])
  })

  it('carries ref.bookingId and responsibleAdult through', async () => {
    const eventId = 'cs_ref_' + Date.now()
    const r = await upsertRsvp({
      ...base,
      event: { kind: 'workshop', id: eventId },
      waiverId: 'wvr_ref',
      ref: { bookingId: 'bkg_seat_1' },
      responsibleAdult: 'Grandma Sue',
    })
    expect(r.ref).toEqual({ bookingId: 'bkg_seat_1' })
    expect(r.responsibleAdult).toBe('Grandma Sue')
    const fetched = await getRsvp('workshop', eventId, 'wvr_ref')
    expect(fetched?.ref).toEqual({ bookingId: 'bkg_seat_1' })
  })

  it('getRsvp returns null when no RSVP is on file', async () => {
    expect(await getRsvp('party', 'no-such-party', 'wvr_nope')).toBeNull()
  })

  describe('getLatestPickupForWaiver', () => {
    const w = 'wvr_pk_' + Date.now()
    const pk = (name: string, na = '') => ({ authorizedPickup: name ? [{ name, phone: '' }] : [], notAuthorized: na })

    it('returns null when the household has no RSVP with a pickup override', async () => {
      await upsertRsvp({ ...base, waiverId: w + 'x', event: { kind: 'workshop', id: 'e_none_' + Date.now() } })
      expect(await getLatestPickupForWaiver(w + 'x')).toBeNull()
    })

    it('returns the pickup from the LATEST RSVP that has a non-empty one, across events', async () => {
      await upsertRsvp({ ...base, waiverId: w, event: { kind: 'workshop', id: 'e_a' + w }, at: '2026-10-01T00:00:00.000Z', pickup: pk('Grandma', 'Rick Smith') })
      await upsertRsvp({ ...base, waiverId: w, event: { kind: 'party', id: 'e_b' + w }, at: '2026-10-05T00:00:00.000Z', pickup: pk('Uncle Al') })
      await upsertRsvp({ ...base, waiverId: w, event: { kind: 'workshop', id: 'e_c' + w }, at: '2026-10-09T00:00:00.000Z' }) // newest, but no pickup
      await upsertRsvp({ ...base, waiverId: w, event: { kind: 'workshop', id: 'e_d' + w }, at: '2026-10-10T00:00:00.000Z', pickup: pk('', '') }) // empty
      expect(await getLatestPickupForWaiver(w)).toEqual({ ...pk('Uncle Al'), at: '2026-10-05T00:00:00.000Z' })
    })

    it('does not match a different household whose id merely ends the same way', async () => {
      expect(await getLatestPickupForWaiver('x' + w)).toBeNull()
    })
  })
})
