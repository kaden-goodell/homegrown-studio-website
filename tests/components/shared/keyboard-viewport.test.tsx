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

import { render, screen } from '@testing-library/react'
import BookingPanel from '@components/shared/BookingPanel'

describe('BookingPanel while typing on a phone', () => {
  it('hides the step bar, summary and footer while the keyboard is up', () => {
    vi.stubGlobal('innerHeight', 800)
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('max-width'), media: q, addEventListener: () => {}, removeEventListener: () => {} }))
    const vv = fakeViewport(800)
    const ui = () => (
      <BookingPanel title="Photo Magnets" onRequestClose={() => {}} stepKey="delivery" stepName="Pickup or shipping" stepNumber={2} stepCount={3}
        summary={<p>6 magnets</p>} footer={<button type="button">Continue</button>}>
        <input aria-label="Email" />
      </BookingPanel>
    )
    render(ui())
    expect(screen.getByText('6 magnets')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy()
    act(() => vv.fire(420))
    expect(screen.queryByText('6 magnets')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull()
    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(screen.getByLabelText('Email')).toBeTruthy()
    act(() => vv.fire(800))
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy()
  })
})
