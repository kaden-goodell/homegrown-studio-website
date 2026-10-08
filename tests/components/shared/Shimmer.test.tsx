import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import Shimmer, { CELEBRATE_EVENT, shimmerAllowedOn } from '@components/shared/Shimmer'

/** Frames the component has asked for and not yet cancelled. */
let frames = new Map<number, FrameRequestCallback>()
let nextFrameId = 0
let cancelled: number[] = []
let reduceMotion = false
let tabHidden = false

/** Run every frame that is waiting, as the browser would at `time` ms. */
function frame(time: number) {
  const due = [...frames.values()]
  frames.clear()
  for (const cb of due) cb(time)
}

const ctx = () => ({
  scale: vi.fn(),
  clearRect: vi.fn(),
  beginPath: vi.fn(),
  arc: vi.fn(),
  fill: vi.fn(),
  globalAlpha: 1,
  fillStyle: '',
})
let ambient: ReturnType<typeof ctx>

function goTo(path: string) {
  window.history.replaceState({}, '', path)
  document.dispatchEvent(new Event('astro:page-load'))
}

function setTabHidden(hidden: boolean) {
  tabHidden = hidden
  document.dispatchEvent(new Event('visibilitychange'))
}

const celebrate = () => window.dispatchEvent(new CustomEvent(CELEBRATE_EVENT))
const glitter = () => document.querySelector<HTMLCanvasElement>('canvas:not([data-shimmer-burst])')!
const burst = () => document.querySelector<HTMLCanvasElement>('canvas[data-shimmer-burst]')

beforeEach(() => {
  frames = new Map()
  nextFrameId = 0
  cancelled = []
  reduceMotion = false
  tabHidden = false
  ambient = ctx()
  let first = true
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => {
    if (first) {
      first = false
      return ambient
    }
    return ctx()
  }) as never)
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frames.set(++nextFrameId, cb)
    return nextFrameId
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    cancelled.push(id)
    frames.delete(id)
  })
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('prefers-reduced-motion') ? reduceMotion : false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => tabHidden })
  window.history.replaceState({}, '', '/')
  document.body.style.overflow = ''
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.style.overflow = ''
  document.body.innerHTML = ''
})

describe('shimmerAllowedOn', () => {
  it.each(['/', '/book', '/workshops', '/calendar', '/about/', '/craft-cafe', '/party/abc123', '/kits'])(
    'glitter is on at %s',
    (path) => {
      expect(shimmerAllowedOn(path)).toBe(true)
    },
  )

  it.each(['/policies', '/policies/', '/waiver', '/waiver/', '/waiver/sign', '/staff', '/staff/', '/staff/checkin/today'])(
    'glitter is off at %s',
    (path) => {
      expect(shimmerAllowedOn(path)).toBe(false)
    },
  )

  it('is decided by the page, not by a lookalike name', () => {
    expect(shimmerAllowedOn('/staffing')).toBe(true)
    expect(shimmerAllowedOn('/about/policies')).toBe(true)
  })
})

describe('Shimmer', () => {
  it('renders nothing when the site has glitter switched off', () => {
    render(<Shimmer enabled={false} />)
    expect(document.querySelector('canvas')).toBeNull()
    expect(frames.size).toBe(0)
    celebrate()
    expect(burst()).toBeNull()
  })

  it('sits behind the page and out of the way of clicks and screen readers', () => {
    render(<Shimmer enabled />)
    expect(glitter().style.zIndex).toBe('-1')
    expect(glitter().style.pointerEvents).toBe('none')
    expect(glitter().getAttribute('aria-hidden')).toBe('true')
  })

  it('animates on an ordinary page', () => {
    render(<Shimmer enabled />)
    expect(frames.size).toBe(1)
    frame(16)
    expect(ambient.arc).toHaveBeenCalled()
    expect(frames.size).toBe(1)
  })

  describe('pages without glitter', () => {
    it.each(['/policies/', '/waiver', '/staff'])('stays off when the visit starts on %s', (path) => {
      window.history.replaceState({}, '', path)
      render(<Shimmer enabled />)
      expect(frames.size).toBe(0)
      expect(glitter().style.display).toBe('none')
    })

    it('stops when in-site navigation arrives at one', () => {
      render(<Shimmer enabled />)
      goTo('/policies/')
      expect(frames.size).toBe(0)
      expect(cancelled).toHaveLength(1)
      expect(glitter().style.display).toBe('none')
    })

    it('starts again when navigation leaves one', () => {
      window.history.replaceState({}, '', '/waiver')
      render(<Shimmer enabled />)
      goTo('/workshops')
      expect(frames.size).toBe(1)
      expect(glitter().style.display).toBe('')
    })

    it('ignores the celebration', () => {
      window.history.replaceState({}, '', '/staff')
      render(<Shimmer enabled />)
      celebrate()
      expect(burst()).toBeNull()
    })
  })

  describe('hidden tab', () => {
    it('stops asking for frames while the tab is hidden', () => {
      render(<Shimmer enabled />)
      setTabHidden(true)
      expect(frames.size).toBe(0)
      expect(cancelled).toHaveLength(1)
    })

    it('picks up again when the tab comes back', () => {
      render(<Shimmer enabled />)
      setTabHidden(true)
      setTabHidden(false)
      expect(frames.size).toBe(1)
      frame(5000)
      expect(ambient.arc).toHaveBeenCalled()
    })

    it('does not jump: the first frame back moves as one ordinary frame', () => {
      render(<Shimmer enabled />)
      frame(16)
      setTabHidden(true)
      setTabHidden(false)
      ambient.arc.mockClear()
      frame(60_000)
      const width = window.innerWidth
      const height = window.innerHeight
      for (const [x, y] of ambient.arc.mock.calls) {
        expect(x).toBeGreaterThan(-20)
        expect(x).toBeLessThan(width + 20)
        expect(y).toBeGreaterThan(-20)
        expect(y).toBeLessThan(height + 20)
      }
    })

    it('does not start in a tab that opened in the background', () => {
      tabHidden = true
      render(<Shimmer enabled />)
      expect(frames.size).toBe(0)
      setTabHidden(false)
      expect(frames.size).toBe(1)
    })

    it('stays off when the tab comes back on a page without glitter', () => {
      window.history.replaceState({}, '', '/policies')
      render(<Shimmer enabled />)
      setTabHidden(true)
      setTabHidden(false)
      expect(frames.size).toBe(0)
    })
  })

  describe('booking panel open', () => {
    it('holds still behind the panel', () => {
      render(<Shimmer enabled />)
      document.body.style.overflow = 'hidden'
      frame(16)
      expect(ambient.arc).not.toHaveBeenCalled()
      document.body.style.overflow = ''
      frame(32)
      expect(ambient.arc).toHaveBeenCalled()
    })
  })

  describe('small resizes', () => {
    it('keeps the same particles when only the height changes (phone address bar)', () => {
      render(<Shimmer enabled />)
      frame(16)
      const before = ambient.arc.mock.calls.length
      ambient.arc.mockClear()
      window.dispatchEvent(new Event('resize'))
      frame(32)
      expect(ambient.arc.mock.calls.length).toBe(before)
    })
  })

  describe('celebration', () => {
    it('plays one burst above the page, then clears it away', () => {
      render(<Shimmer enabled />)
      celebrate()
      const canvas = burst()
      expect(canvas).not.toBeNull()
      expect(canvas!.getAttribute('aria-hidden')).toBe('true')
      expect(canvas!.style.pointerEvents).toBe('none')
      expect(Number(canvas!.style.zIndex)).toBeGreaterThan(110)

      frame(1000)
      frame(1700)
      expect(burst()).not.toBeNull()
      frame(2400)
      expect(burst()).not.toBeNull()
      frame(2501)
      expect(burst()).toBeNull()
    })

    it('starts from the top of the screen', () => {
      render(<Shimmer enabled />)
      const contexts: ReturnType<typeof ctx>[] = []
      vi.mocked(HTMLCanvasElement.prototype.getContext).mockImplementation((() => {
        const c = ctx()
        contexts.push(c)
        return c
      }) as never)
      celebrate()
      frame(1000)
      frame(1100)
      const drawn = contexts[0].arc.mock.calls
      expect(drawn.length).toBeGreaterThan(0)
      for (const [, y] of drawn) expect(y).toBeLessThan(window.innerHeight / 2)
    })

    it('plays while a booking panel is open (the confirmation screen is inside one)', () => {
      render(<Shimmer enabled />)
      document.body.style.overflow = 'hidden'
      celebrate()
      expect(burst()).not.toBeNull()
    })

    it('leaves the everyday glitter running afterwards', () => {
      render(<Shimmer enabled />)
      celebrate()
      frame(1000)
      frame(2600)
      expect(burst()).toBeNull()
      ambient.arc.mockClear()
      frame(2616)
      expect(ambient.arc).toHaveBeenCalled()
    })

    it('plays one at a time', () => {
      render(<Shimmer enabled />)
      celebrate()
      celebrate()
      expect(document.querySelectorAll('canvas[data-shimmer-burst]')).toHaveLength(1)
    })

    it('can play again once the first has finished', () => {
      render(<Shimmer enabled />)
      celebrate()
      frame(1000)
      frame(2600)
      celebrate()
      expect(burst()).not.toBeNull()
    })

    it('does nothing with "reduce motion" on', () => {
      reduceMotion = true
      render(<Shimmer enabled />)
      celebrate()
      expect(burst()).toBeNull()
      expect(frames.size).toBe(0)
    })

    it('is cleared away if the page goes while it is playing', () => {
      const { unmount } = render(<Shimmer enabled />)
      celebrate()
      unmount()
      expect(burst()).toBeNull()
      expect(frames.size).toBe(0)
    })
  })

  describe('"reduce motion"', () => {
    it('draws a still image and never animates', () => {
      reduceMotion = true
      render(<Shimmer enabled />)
      expect(ambient.arc).toHaveBeenCalled()
      expect(frames.size).toBe(0)
      setTabHidden(true)
      setTabHidden(false)
      goTo('/workshops')
      expect(frames.size).toBe(0)
    })

    it('hides the still image on pages without glitter', () => {
      reduceMotion = true
      render(<Shimmer enabled />)
      goTo('/policies')
      expect(glitter().style.display).toBe('none')
      goTo('/')
      expect(glitter().style.display).toBe('')
    })
  })

  it('stops listening when it is removed', () => {
    const { unmount } = render(<Shimmer enabled />)
    unmount()
    expect(frames.size).toBe(0)
    celebrate()
    setTabHidden(false)
    goTo('/')
    expect(frames.size).toBe(0)
    expect(burst()).toBeNull()
  })
})

describe('where the glitter is mounted', () => {
  it.each(['src/layouts/Layout.astro', 'src/layouts/StaticLayout.astro'])('%s loads it when the browser is idle, never before the page is usable', async (path) => {
    const { readFileSync } = await import('fs')
    const { resolve } = await import('path')
    const layout = readFileSync(resolve(__dirname, '../../..', path), 'utf8')
    const mount = layout.split('\n').find((line) => line.includes('<Shimmer'))!
    expect(mount).toContain('client:idle')
    expect(mount).not.toContain('client:load')
    expect(mount).toContain('transition:persist')
  })
})
