import { describe, it, expect } from 'vitest'
import { clock, clockRange } from '@components/admin/shell/time'
import { formatCafeHours, formatCafeRange, formatRange } from '@config/hours'

const NBSP = '\u00a0'
describe('noon and midnight by name (N7)', () => {
  it('/admin: lower case inside a line, capital at the start of a range', () => {
    expect(clock('12:00')).toBe('noon')
    expect(clock('00:00')).toBe('midnight')
    expect(clockRange('09:00', '12:00')).toBe(`9${NBSP}AM–noon`)
    expect(clockRange('12:00', '14:00')).toBe(`Noon–2${NBSP}PM`)
    expect(clockRange('18:00', '20:00')).toBe(`6–8${NBSP}PM`)
  })
  it('the public café hours use the same words; other ranges are unchanged', () => {
    expect(formatCafeRange('09:00', '12:00')).toBe('9 AM – noon')
    expect(formatCafeRange('12:00', '16:00')).toBe('Noon – 4 PM')
    expect(formatCafeRange('09:00', '21:00')).toBe('9 AM – 9 PM')
    expect(formatCafeHours([{ days: ['Saturday'], opens: '09:00', closes: '12:00' }])).toEqual([{ days: 'Saturday', time: '9 AM – noon' }])
    expect(formatRange('09:30', '12:00')).toBe('9:30 AM – 12 PM')
  })
})
