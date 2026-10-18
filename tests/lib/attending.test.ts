import { describe, it, expect } from 'vitest'
import { addAttending, householdForSeats, personIdsOf } from '@lib/attending'
import { saveWaiverRecord, indexWaiverByContact, listWaiversByEvent, type WaiverRecord } from '@lib/waiver-store'
import { getRsvp, upsertRsvp } from '@lib/rsvp-store'

const by = { id: 'sam', name: 'Sam' }
let n = 0
function record(over: Partial<WaiverRecord> = {}): WaiverRecord {
  n++
  const stamp = `${Date.now()}_${n}`
  return {
    id: `wvr_att_${stamp}`, agreementVersion: 'v1', agreementSha256: 'x',
    signedAt: new Date().toISOString(), validUntil: new Date(Date.now() + 1e10).toISOString(),
    adult: { firstName: 'Ashley', lastName: 'Singleton', email: `ashley-${stamp}@x.com`, phone: `256${String(Date.now()).slice(-7)}`, dob: '', allergies: '' },
    minors: [{ name: 'Flynn', dob: '2016-01-01', allergies: 'None', medications: '' }, { name: 'Rowan', dob: '2018-01-01', allergies: '', medications: '' }],
    emergency: { name: '', phone: '', relationship: '' }, authorizedPickup: [], notAuthorized: '', photoConsent: true,
    signature: 'Ashley Singleton', squareCustomerId: null, ip: null, userAgent: null,
    ...over,
  }
}

describe('householdForSeats', () => {
  it('finds the household by email, listing the adult then each child', async () => {
    const r = record()
    await saveWaiverRecord(r); await indexWaiverByContact(r)
    expect(await householdForSeats({ email: r.adult.email })).toEqual({
      recordId: r.id, status: 'ok',
      people: [
        { id: 'adult', name: 'Ashley Singleton', adult: true },
        { id: 'child:0', name: 'Flynn', adult: false },
        { id: 'child:1', name: 'Rowan', adult: false },
      ],
    })
  })
  it('falls back to the phone, and says when the signature has lapsed', async () => {
    const r = record({ validUntil: '2026-01-01T00:00:00.000Z' })
    await saveWaiverRecord(r); await indexWaiverByContact(r)
    const h = await householdForSeats({ email: 'nobody-on-file@x.com', phone: r.adult.phone })
    expect(h?.recordId).toBe(r.id)
    expect(h?.status).toBe('expired')
  })
  it('is null with nothing on file', async () => {
    expect(await householdForSeats({ email: 'nobody-at-all@x.com' })).toBeNull()
  })
})

describe('addAttending', () => {
  it('puts the chosen people on the event roster', async () => {
    const r = record(); await saveWaiverRecord(r)
    const ev = `clssch_att_${Date.now()}`
    const { alreadyRsvpd } = await addAttending({ kind: 'workshop', id: ev, waiver: r, people: ['child:0'], by })
    expect(alreadyRsvpd).toBe(false)
    expect((await getRsvp('workshop', ev, r.id))?.attending).toEqual(['child:0'])
    expect((await listWaiversByEvent('workshop', ev)).map((w) => w.id)).toEqual([r.id])
  })
  it('only ever widens who is attending, and keeps the booking ref', async () => {
    const r = record(); await saveWaiverRecord(r)
    const ev = `clssch_att2_${Date.now()}`
    await upsertRsvp({ waiverId: r.id, event: { kind: 'workshop', id: ev }, ref: { bookingId: 'clsbk_1' }, attending: ['adult'], responsibleAdult: null, at: new Date().toISOString(), ip: null, userAgent: null })
    const { alreadyRsvpd } = await addAttending({ kind: 'workshop', id: ev, waiver: r, people: ['child:1'], by })
    expect(alreadyRsvpd).toBe(true)
    const rsvp = await getRsvp('workshop', ev, r.id)
    expect(rsvp?.attending).toEqual(['adult', 'child:1'])
    expect(rsvp?.ref).toEqual({ bookingId: 'clsbk_1' })
  })
  it('personIdsOf lists the adult and every child', () => {
    expect(personIdsOf(record())).toEqual(['adult', 'child:0', 'child:1'])
  })
})
