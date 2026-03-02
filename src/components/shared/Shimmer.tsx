import { useEffect, useRef } from 'react'

interface Particle {
  x: number
  y: number
  radius: number
  color: string
  maxOpacity: number
  phase: number      // current position in cycle (0-1)
  speed: number      // how fast it cycles
}

const COLORS = ['#c8943c', '#b8860b', '#daa520', '#cd853f', '#d4a040']
const PARTICLES_PER_SCREEN = 100

function createParticles(width: number, height: number): Particle[] {
  const screens = (height / window.innerHeight) || 1
  const count = Math.round(PARTICLES_PER_SCREEN * screens)
  return Array.from({ length: count }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    radius: 1 + Math.random() * 2,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    maxOpacity: 0.5 + Math.random() * 0.5,
    phase: Math.random(),
    speed: 0.15 + Math.random() * 0.35, // cycles per second — completes in 2-6s
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
      const w = document.documentElement.scrollWidth
      const h = document.documentElement.scrollHeight
      canvas!.width = w * dpr
      canvas!.height = h * dpr
      canvas!.style.width = `${w}px`
      canvas!.style.height = `${h}px`
      ctx!.scale(dpr, dpr)
    }

    resize()
    let particles = createParticles(document.documentElement.scrollWidth, document.documentElement.scrollHeight)

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
      if (paused) { animId = requestAnimationFrame(draw); return }
      const dt = lastTime ? (time - lastTime) / 1000 : 0.016
      lastTime = time

      const dpr = window.devicePixelRatio || 1
      ctx!.clearRect(0, 0, canvas!.width / dpr, canvas!.height / dpr)

      for (const p of particles) {
        p.phase = (p.phase + p.speed * dt) % 1
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

    function onResize() {
      resize()
      particles = createParticles(document.documentElement.scrollWidth, document.documentElement.scrollHeight)
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
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 0,
      }}
    />
  )
}
