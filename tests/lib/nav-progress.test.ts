import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('nav progress line', () => {
  beforeEach(async () => { vi.useFakeTimers(); vi.resetModules(); document.querySelectorAll('[data-nav-progress]').forEach((n) => n.remove()); await import('@lib/nav-progress') })
  afterEach(() => vi.useRealTimers())

  const line = () => document.querySelector<HTMLElement>('[data-nav-progress]')

  it('does not appear for a fast page change', () => {
    document.dispatchEvent(new Event('astro:before-preparation'))
    vi.advanceTimersByTime(80)
    document.dispatchEvent(new Event('astro:after-swap'))
    vi.advanceTimersByTime(500)
    expect(line()?.style.opacity ?? '0').toBe('0')
  })

  it('shows on a slow one and goes away when the page arrives', () => {
    document.dispatchEvent(new Event('astro:before-preparation'))
    vi.advanceTimersByTime(200)
    expect(line()!.style.opacity).toBe('1')
    expect(line()!.parentElement).toBe(document.documentElement)
    document.dispatchEvent(new Event('astro:after-swap'))
    expect(line()!.style.opacity).toBe('0')
    expect(line()!.style.width).toBe('100%')
  })
})
