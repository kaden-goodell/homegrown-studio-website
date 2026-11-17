import { describe, it, expect, vi, afterEach } from 'vitest'
import { describe as label, isRage, startRageWatch, tapTarget } from '@lib/rage-watch'

afterEach(() => { document.body.innerHTML = '' })

describe('rage taps (Kaden, 16 Nov 2026: every rage tap texts him)', () => {
  it('three taps on the same thing within a second is a rage tap; two is not', () => {
    const el = document.createElement('button')
    const t = (at: number) => ({ at, x: 10, y: 10, el })
    expect(isRage([t(0)], t(300))).toBe(false)
    expect(isRage([t(0), t(300)], t(600))).toBe(true)
  })
  it('taps spread out, far apart, or on different things are not', () => {
    const a = document.createElement('button'); const b = document.createElement('button')
    expect(isRage([{ at: 0, x: 0, y: 0, el: a }, { at: 400, x: 0, y: 0, el: a }], { at: 1500, x: 0, y: 0, el: a })).toBe(false)
    expect(isRage([{ at: 0, x: 0, y: 0, el: a }, { at: 100, x: 0, y: 0, el: b }], { at: 200, x: 0, y: 0, el: a })).toBe(false)
    expect(isRage([{ at: 0, x: 0, y: 0, el: a }, { at: 100, x: 200, y: 0, el: a }], { at: 200, x: 0, y: 0, el: a })).toBe(false)
  })
  it('names the button on public pages, but only the kind of thing on staff and owner screens', () => {
    const b = document.createElement('button'); b.setAttribute('aria-label', 'Pay with Apple Pay')
    expect(label(b, '/book')).toBe('button "Pay with Apple Pay"')
    const row = document.createElement('button'); row.textContent = 'Sarah Lee · peanut allergy'
    expect(label(row, '/staff')).toBe('button')
    expect(label(row, '/admin')).toBe('button')
  })
  it('the tap goes to the nearest button, even inside it', () => {
    const b = document.createElement('button'); const span = document.createElement('span'); b.appendChild(span)
    expect(tapTarget([span, b, document.body])).toBe(b)
  })
  it('reports once per thing per page load, even when a button swallows the tap', () => {
    const send = vi.fn()
    const stop = startRageWatch(send)
    const b = document.createElement('button'); b.textContent = 'Pay'
    b.addEventListener('click', (e) => e.stopPropagation())
    document.body.appendChild(b)
    for (let i = 0; i < 8; i++) b.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 5, clientY: 5 }))
    stop()
    expect(send).toHaveBeenCalledTimes(1)
    expect(JSON.parse(send.mock.calls[0][0])).toMatchObject({ kind: 'site', problem: 'rage', detail: 'button "Pay"' })
  })
})
