/**
 * LEGACY FALLBACK — delete after 2027-01-15 (this file).
 *
 * Which booking system takes new online bookings (Kaden, 16 Nov 2026): the old
 * Square booking until an owner switches, switchable back at once, and gone
 * after LEGACY_FALLBACK_UNTIL.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  _resetSwitchForTests, describeSwitchChanges, envSystems, getSwitchState, legacyFallbackAvailable, resetSwitchCache, saveSwitches, stateOf, validateSwitchInput,
} from '@lib/booking-switch'
import { ownSystemNow } from '@lib/bookings-gate'
import { LEGACY_FALLBACK_UNTIL } from '@config/legacy-fallback'

const OWNER = { id: 'admin', name: 'Kaden' }
const BEFORE_END = new Date('2026-12-01T18:00:00Z')
const AFTER_END = new Date('2027-01-16T18:00:00Z')
let saved: string | undefined

beforeEach(async () => {
  saved = process.env.BOOKING_SYSTEMS
  delete process.env.BOOKING_SYSTEMS
  await _resetSwitchForTests()
})
afterEach(async () => {
  if (saved === undefined) delete process.env.BOOKING_SYSTEMS
  else process.env.BOOKING_SYSTEMS = saved
  await _resetSwitchForTests()
})

describe('which system takes new bookings', () => {
  it('starts on the old Square booking when nothing is saved and no hosting setting is set (a deploy moves nothing)', () => {
    expect(stateOf(null, BEFORE_END).system).toEqual({ parties: 'square', classes: 'square' })
  })

  it('BOOKING_SYSTEMS sets it until an owner saves: "own" or a per-kind list', () => {
    process.env.BOOKING_SYSTEMS = 'own'
    expect(envSystems()).toEqual({ parties: 'own', classes: 'own' })
    process.env.BOOKING_SYSTEMS = 'parties=own,classes=square'
    expect(envSystems()).toEqual({ parties: 'own', classes: 'square' })
    process.env.BOOKING_SYSTEMS = 'nonsense'
    expect(envSystems()).toEqual({ parties: 'square', classes: 'square' })
  })

  it('a saved document without a system reads as the old Square booking; a saved choice wins over the hosting setting', () => {
    const doc: any = { v: 1, open: { parties: true, workshops: true, kits: false }, pauseNote: '', previewToken: '', updatedAt: '2026-11-16T00:00:00Z', by: OWNER, history: [] }
    expect(stateOf(doc, BEFORE_END).system).toEqual({ parties: 'square', classes: 'square' })
    process.env.BOOKING_SYSTEMS = 'own'
    expect(stateOf({ ...doc, system: { parties: 'square' } }, BEFORE_END).system).toEqual({ parties: 'square', classes: 'own' })
  })

  it('an owner switches parties to the new system and straight back; each is logged in plain words', async () => {
    const open = { parties: true, workshops: true, kits: false }
    const first = await saveSwitches({ open, pauseNote: '', system: { parties: 'own' } }, { expectedUpdatedAt: null, by: OWNER })
    expect(first.saved.system).toEqual({ parties: 'own', classes: 'square' })
    expect(first.changed).toContain('Parties now book on the new booking system')
    resetSwitchCache()
    expect(await ownSystemNow(undefined, 'parties')).toBe(true)
    expect(await ownSystemNow(undefined, 'classes')).toBe(false)
    const back = await saveSwitches({ open, pauseNote: '', system: { parties: 'square' } }, { expectedUpdatedAt: first.saved.updatedAt, by: OWNER })
    expect(back.saved.system.parties).toBe('square')
    expect(back.changed).toContain('Parties back on the old Square booking')
    resetSwitchCache()
    expect((await getSwitchState()).system.parties).toBe('square')
    // Left out = unchanged.
    const other = await saveSwitches({ open, pauseNote: 'x' }, { expectedUpdatedAt: back.saved.updatedAt, by: OWNER })
    expect(other.saved.system).toEqual({ parties: 'square', classes: 'square' })
  })

  it('both on together, and both back together, in one save', async () => {
    const open = { parties: true, workshops: true, kits: false }
    const on = await saveSwitches({ open, pauseNote: '', system: { parties: 'own', classes: 'own' } }, { expectedUpdatedAt: null, by: OWNER })
    expect(on.saved.system).toEqual({ parties: 'own', classes: 'own' })
    const off = await saveSwitches({ open, pauseNote: '', system: { parties: 'square', classes: 'square' } }, { expectedUpdatedAt: on.saved.updatedAt, by: OWNER })
    expect(off.saved.system).toEqual({ parties: 'square', classes: 'square' })
  })

  it('refuses anything but square or own', () => {
    expect(() => validateSwitchInput({ open: { parties: true, workshops: true, kits: false }, system: { parties: 'maybe' } })).toThrow()
  })

  it('describes no change when the system stays', () => {
    const before = stateOf(null, BEFORE_END)
    expect(describeSwitchChanges(before, { open: before.open, pauseNoteWritten: '', newTestLink: false, system: before.system })).toEqual([])
  })
})

describe('the fallback ends on LEGACY_FALLBACK_UNTIL', () => {
  it('is offered through the last day and gone the day after', () => {
    expect(legacyFallbackAvailable(new Date(`${LEGACY_FALLBACK_UNTIL}T23:00:00-06:00`))).toBe(true)
    expect(legacyFallbackAvailable(AFTER_END)).toBe(false)
  })

  it('after the end everything reads as the new system, whatever was saved', () => {
    const doc: any = { v: 1, open: { parties: true, workshops: true, kits: false }, pauseNote: '', previewToken: '', system: { parties: 'square', classes: 'square' }, updatedAt: '2026-11-16T00:00:00Z', by: OWNER, history: [] }
    expect(stateOf(doc, AFTER_END).system).toEqual({ parties: 'own', classes: 'own' })
    expect(stateOf(null, AFTER_END).system).toEqual({ parties: 'own', classes: 'own' })
  })
})
