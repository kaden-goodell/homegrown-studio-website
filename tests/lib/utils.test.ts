import { describe, it, expect } from 'vitest'
import { formatCents, formatDate, formatTime, formatDuration } from '@lib/utils'

describe('formatCents', () => {
  it('formats whole dollar amounts', () => {
    expect(formatCents(4500)).toBe('$45.00')
  })

  it('formats amounts with cents', () => {
    expect(formatCents(4599)).toBe('$45.99')
  })

  it('formats zero', () => {
    expect(formatCents(0)).toBe('$0.00')
  })
})

describe('formatDate', () => {
  it('formats ISO date string', () => {
    const result = formatDate('2026-03-15')
    expect(result).toContain('Mar')
    expect(result).toContain('15')
    expect(result).toContain('2026')
  })
})

describe('formatTime', () => {
  it('formats ISO datetime to time string', () => {
    const result = formatTime('2026-03-15T10:00:00Z')
    expect(result).toBeTruthy()
  })
})

describe('formatDuration', () => {
  it('formats minutes to human-readable', () => {
    expect(formatDuration(90)).toBe('1h 30m')
  })

  it('formats exact hours', () => {
    expect(formatDuration(120)).toBe('2h')
  })

  it('formats minutes only', () => {
    expect(formatDuration(45)).toBe('45m')
  })
})
