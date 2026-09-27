import { useEffect, useRef } from 'react'

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

const COLORS = ['#c8943c', '#b8860b', '#daa520', '#cd853f', '#d4a040']
// 120 particles on a laptop-sized screen, scaled by area so a phone gets the
// same density rather than the same count squeezed into a fifth of the space.
const PARTICLES_PER_SCREEN = 120
const REFERENCE_AREA = 1440 * 900
const MIN_PARTICLES = 25

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

    // Static render for reduced motion
    if (prefersReduced) {
      for (const p of particles) {
        ctx.globalAlpha = p.maxOpacity * 0.3
        ctx.fillStyle = p.color
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2)
        ctx.fill()
      }
      return
    }

    let animId: number
    let lastTime = 0
    let paused = false

    function draw(time: number) {
      // Hold still while the tab is hidden or a booking panel is open (panels
      // lock page scroll), so nothing moves behind a form.
      if (paused || document.body.style.overflow === 'hidden') {
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

    animId = requestAnimationFrame(draw)

    function onVisChange() { paused = document.hidden }
    document.addEventListener('visibilitychange', onVisChange)

    // Phones fire resize whenever the address bar shows or hides. Only lay the
    // particles out again when the width really changes.
    let laidOutWidth = window.innerWidth
    function onResize() {
      resize()
      if (Math.abs(window.innerWidth - laidOutWidth) > 100) {
        laidOutWidth = window.innerWidth
        particles = createParticles(window.innerWidth, window.innerHeight)
      }
    }
    window.addEventListener('resize', onResize)

    return () => {
      cancelAnimationFrame(animId)
      document.removeEventListener('visibilitychange', onVisChange)
      window.removeEventListener('resize', onResize)
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
