import { describe, it, expect } from 'vitest'
import { homeTabOf, isFormSheet, parseHash, parseSheet, sheetToken, type Sheet } from '@components/admin/shell/router'

describe('/admin address tokens', () => {
  const round: Sheet[] = [
    { kind: 'class', id: 'cls_abc123' },
    { kind: 'edit', id: 'cls_abc123' },
    { kind: 'new' },
    { kind: 'new', day: '2026-10-24' },
    { kind: 'block', day: '2026-10-24' },
    { kind: 'book-party' },
    { kind: 'book-party', day: '2026-10-24' },
    { kind: 'print', day: '2026-10-24' },
    { kind: 'day', day: '2026-10-24' },
    { kind: 'legacy', day: '2026-10-24', id: 'ABC-DEF_1' },
    { kind: 'blocked', day: '2026-10-24', id: 'blk_x1' },
    { kind: 'party', day: '2026-10-24', id: 'z9y8x7' },
    { kind: 'cafe', day: '2026-10-24' },
    { kind: 'closed', day: '2026-10-30' },
    { kind: 'request', id: '2026-10-17-abcdef12' },
    { kind: 'message', id: '2026-10-17-11111111' },
    { kind: 'teacher', id: '2026-10-15-abcdef12' },
    { kind: 'todo', id: 'd1' },
    { kind: 'again', id: 'cls_abc123' },
    { kind: 'lib', id: 'lib_1' },
    { kind: 'libedit', id: 'lib_1' },
    { kind: 'libsched', id: 'lib_1' },
    { kind: 'more', page: 'hours' },
  ]
  it('every sheet survives a trip through the address bar', () => {
    for (const s of round) expect(parseSheet(sheetToken(s)!)).toEqual(s)
  })
  it('matches the examples in the brief', () => {
    expect(sheetToken({ kind: 'class', id: 'x1' })).toBe('class-x1')
    expect(sheetToken({ kind: 'new' })).toBe('new')
    expect(sheetToken({ kind: 'day', day: '2026-10-24' })).toBe('day-2026-10-24')
    expect(sheetToken({ kind: 'more', page: 'hours' })).toBe('more-hours')
  })
  it('only plain tokens: anything else is ignored', () => {
    expect(sheetToken({ kind: 'class', id: 'a b' })).toBeNull()
    expect(parseHash('#class-<script>')).toEqual({})
    expect(parseHash('#day-2026-1-1')).toEqual({})
    expect(parseHash('#more-secrets')).toEqual({})
    expect(parseHash('#%E0%A4%A')).toEqual({})
    expect(parseHash('#calendar')).toEqual({ tab: 'calendar' })
    expect(parseHash('')).toEqual({})
  })
  it('a sheet named alone sits on its own tab; forms are the long ones', () => {
    expect(homeTabOf({ kind: 'message', id: 'm' })).toBe('inbox')
    expect(homeTabOf({ kind: 'more', page: 'reports' })).toBe('more')
    expect(homeTabOf({ kind: 'party', day: '2026-10-24', id: 'p' })).toBe('calendar')
    expect(homeTabOf({ kind: 'new' })).toBe('home')
    expect(isFormSheet({ kind: 'new' })).toBe(true)
    expect(isFormSheet({ kind: 'again', id: 'cls_1' })).toBe(true)
    expect(isFormSheet({ kind: 'day', day: '2026-10-24' })).toBe(false)
    // A class's own sheet (Bookings · Details · Dates) is a side panel on an iPad, even on Details.
    expect(isFormSheet({ kind: 'class', id: 'cls_1' })).toBe(false)
    expect(isFormSheet({ kind: 'edit', id: 'cls_1' })).toBe(false)
    expect(homeTabOf({ kind: 'lib', id: 'lib_1' })).toBe('classes')
    expect(homeTabOf({ kind: 'again', id: 'cls_1' })).toBe('classes')
    // "Add a class to the library" is gone: every class gets there on its own.
    expect(parseHash('#libnew')).toEqual({})
  })
})
