import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useKeyboardViewport } from '@components/shared/BookingPanel'

function fakeViewport(height: number, offsetTop = 0) {
  const listeners: Record<string, (() => void)[]> = {}
  const vv = {
    height, offsetTop,
    addEventListener: (t: string, f: () => void) => { (listeners[t] ??= []).push(f) },
    removeEventListener: vi.fn(),
    fire(h: number, top = 0) { vv.height = h; vv.offsetTop = top; listeners.resize?.forEach((f) => f()) },
  }
  vi.stubGlobal('visualViewport', vv)
  return vv
}

afterEach(() => vi.unstubAllGlobals())

describe('useKeyboardViewport', () => {
  it('is null with no keyboard, and the visible area once a keyboard opens', () => {
    vi.stubGlobal('innerHeight', 800)
    const vv = fakeViewport(800)
    const { result } = renderHook(() => useKeyboardViewport(true))
    expect(result.current).toBeNull()
    act(() => vv.fire(450, 12))
    expect(result.current).toEqual({ top: 12, height: 450 })
    act(() => vv.fire(760))
    expect(result.current).toBeNull() // small change = browser chrome, not a keyboard
  })
  it('does nothing on wide screens', () => {
    vi.stubGlobal('innerHeight', 800)
    fakeViewport(400)
    expect(renderHook(() => useKeyboardViewport(false)).result.current).toBeNull()
  })
})
