/**
 * The glitter behind every page.
 *
 * CELEBRATION: dispatch the custom event `hometown:celebrate` on `window` and
 * one burst of glitter falls from the top of the screen for about 1.5 seconds,
 * then everything returns to normal:
 *
 *   window.dispatchEvent(new CustomEvent('hometown:celebrate'))
 *
 * The burst draws on its own canvas above the page (booking panels included),
 * never takes a click, and removes itself when it is done. The event does
 * nothing with "reduce motion" on, on the pages where glitter is off, or while
 * a burst is already playing.
 *
 * The everyday glitter holds still while a booking panel is open, stops while
 * the tab is hidden, and is off on the pages listed in SHIMMER_OFF_PATHS. With
 * "reduce motion" on it is a still image.
 *
 * SEASONS (seasonal-scene.ts): fall swaps the everyday glitter for leaves on a
 * breeze, winter for snowflakes; spring and summer keep the glitter. Preview
 * any of them with ?season=fall|winter|glitter. The celebration burst is
 * always glitter.
 */
import { useEffect, useRef } from 'react'
import { seasonFor, createDrifters, stepDrifters, drawDrifters, type Drifter } from '@lib/seasonal-scene'

interface Particle {
  x: number
  y: number
  radius: number
  color: string
  maxOpacity: number
  phase: number      // current position in cycle (0-1)
  speed: number      // how fast it cycles
  dx: number         // drift pixels per second
  dy: number
}

interface BurstParticle {
  x: number
  y: number
  radius: number
  color: string
  maxOpacity: number
  vx: number         // pixels per second
  vy: number
  delay: number      // ms after the burst starts before this one falls
}

const COLORS = ['#c8943c', '#b8860b', '#daa520', '#cd853f', '#d4a040']
// 120 particles on a laptop-sized screen, scaled by area so a phone gets the
// same density rather than the same count squeezed into a fifth of the space.
const PARTICLES_PER_SCREEN = 120
const REFERENCE_AREA = 1440 * 900
const MIN_PARTICLES = 25

export const CELEBRATE_EVENT = 'hometown:celebrate'
/** Reading and signing pages, and the staff console: no glitter. */
export const SHIMMER_OFF_PATHS = ['/policies', '/waiver', '/staff']

const BURST_MS = 1500
// 90 pieces across a laptop-wide screen, scaled by width.
const BURST_PER_SCREEN = 90
const REFERENCE_WIDTH = 1440
const MIN_BURST = 40
const BURST_GRAVITY = 520 // pixels per second, per second
// Booking panels sit at 100–110.
const BURST_Z_INDEX = 1000

/** Glitter is off on a listed page and on anything beneath it (/staff/…). */
export function shimmerAllowedOn(pathname: string): boolean {
  return !SHIMMER_OFF_PATHS.some((off) => pathname === off || pathname.startsWith(`${off}/`))
}

function createParticles(width: number, height: number): Particle[] {
  const scaled = Math.round(PARTICLES_PER_SCREEN * ((width * height) / REFERENCE_AREA))
  const count = Math.max(MIN_PARTICLES, Math.min(PARTICLES_PER_SCREEN * 1.5, scaled))
  return Array.from({ length: count }, () => {
    const angle = Math.random() * Math.PI * 2
    const drift = 3 + Math.random() * 7 // 3-10 px/sec gentle drift
    return {
      x: Math.random() * width,
      y: Math.random() * height,
      radius: 1 + Math.random() * 2,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      maxOpacity: 0.5 + Math.random() * 0.5,
      phase: Math.random(),
      speed: 0.225 + Math.random() * 0.525,
      dx: Math.cos(angle) * drift,
      dy: Math.sin(angle) * drift,
    }
  })
}

function createBurst(width: number): BurstParticle[] {
  const count = Math.max(MIN_BURST, Math.round(BURST_PER_SCREEN * (width / REFERENCE_WIDTH)))
  return Array.from({ length: count }, () => ({
    x: Math.random() * width,
    y: -4 - Math.random() * 24, // just above the top edge
    radius: 1.5 + Math.random() * 2.5,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    maxOpacity: 0.7 + Math.random() * 0.3,
    vx: -50 + Math.random() * 100,
    vy: 120 + Math.random() * 320,
    delay: Math.random() * 350,
  }))
}

export default function Shimmer({ enabled }: { enabled: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!enabled) return

    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    function resize() {
      const dpr = window.devicePixelRatio || 1
      const w = window.innerWidth
      const h = window.innerHeight
      canvas!.width = w * dpr
      canvas!.height = h * dpr
      canvas!.style.width = `${w}px`
      canvas!.style.height = `${h}px`
      ctx!.scale(dpr, dpr)
    }

    resize()
    let particles = createParticles(window.innerWidth, window.innerHeight)
    const season = seasonFor(new Date(), new URLSearchParams(window.location.search).get('season'))
    let drifters: Drifter[] = season === 'glitter' ? [] : createDrifters(season, window.innerWidth, window.innerHeight)
    let clock = Math.random() * 600 // start somewhere in the breeze's cycle

    // Static render for reduced motion
    if (prefersReduced && season !== 'glitter') {
      drawDrifters(ctx, drifters, season, 0.6)
    } else if (prefersReduced) {
      for (const p of particles) {
        ctx.globalAlpha = p.maxOpacity * 0.3
        ctx.fillStyle = p.color
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    let animId = 0
    let running = false
    let lastTime = 0

    function draw(time: number) {
      // Hold still while a booking panel is open (panels lock page scroll), so
      // nothing moves behind a form.
      if (document.body.style.overflow === 'hidden') {
        lastTime = 0
        animId = requestAnimationFrame(draw)
        return
      }
      const dt = lastTime ? (time - lastTime) / 1000 : 0.016
      lastTime = time

      const dpr = window.devicePixelRatio || 1
      ctx!.clearRect(0, 0, canvas!.width / dpr, canvas!.height / dpr)

      const w = canvas!.width / dpr
      const h = canvas!.height / dpr

      if (season !== 'glitter') {
        clock += dt
        stepDrifters(drifters, season, clock, Math.min(dt, 0.1), w, h)
        drawDrifters(ctx!, drifters, season)
        animId = requestAnimationFrame(draw)
        return
      }

      for (const p of particles) {
        const prevPhase = p.phase
        p.phase = (p.phase + p.speed * dt) % 1

        // When phase wraps (particle fully faded out), respawn at random position
        if (p.phase < prevPhase) {
          p.x = Math.random() * w
          p.y = Math.random() * h
          const angle = Math.random() * Math.PI * 2
          const drift = 3 + Math.random() * 7
          p.dx = Math.cos(angle) * drift
          p.dy = Math.sin(angle) * drift
        } else {
          // Gentle drift
          p.x += p.dx * dt
          p.y += p.dy * dt
        }

        // Sine wave for smooth fade in/out
        const opacity = p.maxOpacity * Math.sin(p.phase * Math.PI)
        ctx!.globalAlpha = opacity
        ctx!.fillStyle = p.color
        ctx!.beginPath()
        ctx!.arc(p.x, p.y, p.radius, 0, Math.PI * 2)
        ctx!.fill()
      }

      animId = requestAnimationFrame(draw)
    }

    function start() {
      if (running) return
      running = true
      lastTime = 0
      animId = requestAnimationFrame(draw)
    }

    function stop() {
      if (!running) return
      running = false
      cancelAnimationFrame(animId)
    }

    // Runs only on a page that has glitter, in a tab that is showing. In-site
    // navigation keeps this component, so the page is checked again each time.
    function sync() {
      const allowed = shimmerAllowedOn(window.location.pathname)
      canvas!.style.display = allowed ? '' : 'none'
      if (prefersReduced) return
      if (allowed && !document.hidden) start()
      else stop()
    }

    sync()
    document.addEventListener('visibilitychange', sync)
    document.addEventListener('astro:page-load', sync)

    // Phones fire resize whenever the address bar shows or hides. Only lay the
    // particles out again when the width really changes.
    let laidOutWidth = window.innerWidth
    function onResize() {
      if (prefersReduced) return
      resize()
      if (Math.abs(window.innerWidth - laidOutWidth) > 100) {
        laidOutWidth = window.innerWidth
        particles = createParticles(window.innerWidth, window.innerHeight)
        if (season !== 'glitter') drifters = createDrifters(season, window.innerWidth, window.innerHeight)
      }
    }
    window.addEventListener('resize', onResize)

    let burstCanvas: HTMLCanvasElement | null = null
    let burstAnimId = 0

    function endBurst() {
      cancelAnimationFrame(burstAnimId)
      burstCanvas?.remove()
      burstCanvas = null
    }

    function celebrate() {
      if (burstCanvas) return
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      if (!shimmerAllowedOn(window.location.pathname)) return

      const layer = document.createElement('canvas')
      const layerCtx = layer.getContext('2d')
      if (!layerCtx) return

      const dpr = window.devicePixelRatio || 1
      const w = window.innerWidth
      const h = window.innerHeight
      layer.width = w * dpr
      layer.height = h * dpr
      layer.setAttribute('aria-hidden', 'true')
      layer.setAttribute('data-shimmer-burst', '')
      layer.style.position = 'fixed'
      layer.style.top = '0'
      layer.style.left = '0'
      layer.style.width = `${w}px`
      layer.style.height = `${h}px`
      layer.style.pointerEvents = 'none'
      layer.style.zIndex = String(BURST_Z_INDEX)
      layerCtx.scale(dpr, dpr)
      document.body.appendChild(layer)
      burstCanvas = layer

      const pieces = createBurst(w)
      let startedAt = 0

      function fall(time: number) {
        if (!startedAt) startedAt = time
        const elapsed = time - startedAt
        if (elapsed >= BURST_MS) {
          endBurst()
          return
        }

        layerCtx!.clearRect(0, 0, w, h)
        // Full strength for the first half, then fading to nothing at the end.
        const fade = Math.min(1, (2 * (BURST_MS - elapsed)) / BURST_MS)
        for (const p of pieces) {
          const t = (elapsed - p.delay) / 1000
          if (t < 0) continue
          layerCtx!.globalAlpha = p.maxOpacity * fade
          layerCtx!.fillStyle = p.color
          layerCtx!.beginPath()
          layerCtx!.arc(p.x + p.vx * t, p.y + p.vy * t + (BURST_GRAVITY * t * t) / 2, p.radius, 0, Math.PI * 2)
          layerCtx!.fill()
        }

        burstAnimId = requestAnimationFrame(fall)
      }

      burstAnimId = requestAnimationFrame(fall)
    }
    window.addEventListener(CELEBRATE_EVENT, celebrate)

    return () => {
      stop()
      endBurst()
      document.removeEventListener('visibilitychange', sync)
      document.removeEventListener('astro:page-load', sync)
      window.removeEventListener('resize', onResize)
      window.removeEventListener(CELEBRATE_EVENT, celebrate)
    }
  }, [enabled])

  if (!enabled) return null

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        // Behind everything, so glitter never crosses text or a form.
        zIndex: -1,
      }}
    />
  )
}
