import { describe, it, expect } from 'vitest'
import { safeReturnPath } from '@lib/safe-return'

describe('safeReturnPath', () => {
  it('accepts a plain same-origin path', () => {
    expect(safeReturnPath('/staff')).toBe('/staff')
  })

  it('rejects a protocol-relative URL (//evil.com)', () => {
    expect(safeReturnPath('//evil.com')).toBe('/staff')
  })

  it('rejects an absolute URL with a scheme', () => {
    expect(safeReturnPath('https://evil')).toBe('/staff')
  })

  it('defaults to /staff when undefined', () => {
    expect(safeReturnPath(undefined)).toBe('/staff')
  })

  it('defaults to /staff when null', () => {
    expect(safeReturnPath(null)).toBe('/staff')
  })

  it('defaults to /staff when empty string', () => {
    expect(safeReturnPath('')).toBe('/staff')
  })

  it('rejects a path not starting with /', () => {
    expect(safeReturnPath('staff')).toBe('/staff')
  })

  it('rejects a backslash trick (\\\\evil.com)', () => {
    expect(safeReturnPath('/\\evil.com')).toBe('/staff')
  })

  it('accepts a deeper same-origin path', () => {
    expect(safeReturnPath('/staff/kits')).toBe('/staff/kits')
  })

  it('accepts a same-origin path WITH a query string (the roster deep link)', () => {
    expect(safeReturnPath('/staff?open=party:abc')).toBe('/staff?open=party:abc')
    expect(safeReturnPath('/staff?open=workshop:cs-camp-1')).toBe('/staff?open=workshop:cs-camp-1')
    expect(safeReturnPath(encodeURIComponent('/staff?open=party:abc'))).toBe('/staff') // still-encoded = not a path
  })

  it('still rejects off-site tricks that carry a query', () => {
    expect(safeReturnPath('//evil.com/staff?open=party:abc')).toBe('/staff')
    expect(safeReturnPath('https://evil.com/staff?open=party:abc')).toBe('/staff')
    expect(safeReturnPath('/javascript:alert(1)')).toBe('/staff')
    expect(safeReturnPath('/\\evil.com?open=party:abc')).toBe('/staff')
  })
})
