import { describe, it, expect } from 'vitest'
import { cafeOn, cafeRunsOn } from '@lib/cafe-days'
import { CONFIG_STUDIO_DAYS } from '@config/studio-days'

describe('cafeRunsOn', () => {
  it('is Saturdays from the café start date', () => {
    expect(cafeRunsOn('2026-11-07')).toBe(true) // first café Saturday
    expect(cafeRunsOn('2026-11-08')).toBe(false) // Sunday
    expect(cafeRunsOn('2026-10-31')).toBe(false) // a Saturday before the start
  })
})

describe('UI review (3 Nov): a special café day shows whenever it falls', () => {
  const withSpecial = (date: string) => ({ ...CONFIG_STUDIO_DAYS, cafe: { ...CONFIG_STUDIO_DAYS.cafe, special: [...CONFIG_STUDIO_DAYS.cafe.special, { date, opens: '09:00', closes: '20:00', name: 'Tuesday pop-up café' }] } })
  it('a special day before the café start date runs (on /admin Home, the calendars and /staff Today)', () => {
    const days = withSpecial('2026-11-03')
    expect(cafeRunsOn('2026-11-03', days)).toBe(true)
    expect(cafeOn('2026-11-03', days)).toEqual({ opens: '09:00', closes: '20:00' })
    // Weekly days before the start still don't.
    expect(cafeRunsOn('2026-10-31', days)).toBe(false)
  })
  it('never on a closed day', () => {
    const days = { ...withSpecial('2026-11-03'), closures: [{ from: '2026-11-03', to: '2026-11-03', name: 'a snow day' }] }
    expect(cafeRunsOn('2026-11-03', days as any)).toBe(false)
  })
})
