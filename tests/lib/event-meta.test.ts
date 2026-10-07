import { describe, it, expect } from 'vitest'
import { getEventMeta, setEventMeta } from '@lib/event-meta'
import { emptyEventMeta, mergeEventMeta } from '@lib/event-meta'
import { saveSeatChoices } from '@lib/seat-choices'
import { SeatSettingsError } from '@lib/seat-options'
import { makeKvStore } from '@lib/blob-store'

const PAILS = { id: 'pumpkin-color', label: 'Pumpkin color', choices: ['Light Pink', 'Light Blue', 'Black', 'Lavender'] }
const by = { id: 'k', name: 'Kaden' }
describe('event-meta', () => {
  it('returns null when unset, then the merged patch with history', async () => {
    const id = 'w_' + Date.now()
    expect(await getEventMeta('workshop', id)).toBeNull()
    const m = await setEventMeta('workshop', id, { dropOff: true }, by)
    expect(m.dropOff).toBe(true); expect(m.days).toBeNull(); expect(m.history).toHaveLength(1); expect(m.history[0].by).toEqual(by)
    const m2 = await setEventMeta('workshop', id, { days: ['2026-10-19', '2026-10-20'] }, by)
    expect(m2.dropOff).toBe(true); expect(m2.days).toEqual(['2026-10-19', '2026-10-20']); expect(m2.history).toHaveLength(2)
  })
  it('caps history at 50', async () => {
    const id = 'w_cap_' + Date.now()
    for (let i = 0; i < 55; i++) await setEventMeta('party', id, { dropOff: i % 2 === 0 }, by)
    expect((await getEventMeta('party', id))!.history).toHaveLength(50)
  })
})

describe('event-meta — seat questions and sign-up cutoff', () => {
  it('defaults to no questions and the default cutoff', async () => {
    const m = await setEventMeta('workshop', 'w_def_' + Date.now(), { dropOff: false }, by)
    expect(m.options).toEqual([])
    expect(m.signupCutoffHours).toBeNull()
  })

  it('reads an old record without the new fields as the defaults', async () => {
    const id = 'w_old_' + Date.now()
    await makeKvStore('event-meta', 'event-meta').set(
      `event-meta-workshop:${id}`,
      JSON.stringify({ dropOff: true, days: null, updatedAt: '2026-09-28T00:00:00.000Z', by, history: [] }),
    )
    expect(await getEventMeta('workshop', id)).toMatchObject({ dropOff: true, options: [], signupCutoffHours: null })
  })

  it('saves questions and a cutoff, and logs both', async () => {
    const id = 'w_set_' + Date.now()
    const m = await setEventMeta('workshop', id, { options: [PAILS], signupCutoffHours: 48 }, by)
    expect(m.options).toEqual([PAILS])
    expect(m.signupCutoffHours).toBe(48)
    expect(m.history.at(-1)).toMatchObject({ by, options: [PAILS], signupCutoffHours: 48 })
    const m2 = await setEventMeta('workshop', id, { signupCutoffHours: null }, by)
    expect(m2.signupCutoffHours).toBeNull()
    expect(m2.options).toEqual([PAILS])
  })

  it('refuses invalid questions with a plain message', async () => {
    const id = 'w_bad_' + Date.now()
    await expect(setEventMeta('workshop', id, { options: [{ ...PAILS, choices: ['Black'] }] }, by)).rejects.toMatchObject({
      name: 'SeatSettingsError', status: 400, message: '“Pumpkin color” needs 2 to 12 choices.',
    })
    expect(await getEventMeta('workshop', id)).toBeNull()
  })

  it('once someone has picked: adding a choice works, removing one or the question is refused', async () => {
    const id = 'w_lock_' + Date.now()
    await setEventMeta('workshop', id, { options: [PAILS] }, by)
    await saveSeatChoices({
      eventKind: 'workshop', eventId: id, bookingId: 'clsbk_1', orderId: null,
      customer: { givenName: 'Ada', familyName: 'Lovelace', email: 'ada@example.com', phone: '' },
      seats: 1, picks: [{ seat: 1, optionId: 'pumpkin-color', choice: 'Lavender' }], at: '2026-10-06T15:00:00.000Z', attemptId: 'a',
    })
    const added = await setEventMeta('workshop', id, { options: [{ ...PAILS, choices: [...PAILS.choices, 'Orange'] }] }, by)
    expect(added.options[0].choices).toContain('Orange')
    await expect(setEventMeta('workshop', id, { options: [{ ...PAILS, choices: ['Light Pink', 'Light Blue', 'Black', 'Orange'] }] }, by)).rejects.toMatchObject({ status: 409 })
    await expect(setEventMeta('workshop', id, { options: [] }, by)).rejects.toMatchObject({ status: 409 })
    expect((await getEventMeta('workshop', id))!.options[0].choices).toContain('Lavender')
  })

  it('mergeEventMeta applies the same rules without storage', () => {
    const now = '2026-10-06T00:00:00.000Z'
    const next = mergeEventMeta(emptyEventMeta(), { signupCutoffHours: 24 }, by, now, false)
    expect(next).toMatchObject({ signupCutoffHours: 24, options: [], updatedAt: now, by })
    expect(() => mergeEventMeta(emptyEventMeta(), { signupCutoffHours: -1 }, by, now, false)).toThrow(SeatSettingsError)
  })
})
