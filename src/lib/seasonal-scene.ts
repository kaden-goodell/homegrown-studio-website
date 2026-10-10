/**
 * The seasonal sky behind every page (drawn by Shimmer.tsx):
 *   winter (Dec–Feb) snowflakes
 *   otherwise        nothing here — Shimmer keeps its glitter
 * Fall leaves are built and can be previewed with ?season=fall, but are not
 * on by date (Kaden, 9 Oct 2026: "no leaves… keep the Christmas ones").
 *
 * Kept free of React and the DOM (except the canvas context it is handed) so
 * the season rule and the motion can be tested on their own.
 */

export type Season = 'fall' | 'winter' | 'glitter'

/** Which sky a studio-local date gets. `override` (from ?season=) wins when valid. */
export function seasonFor(date: Date, override?: string | null): Season {
  if (override === 'fall' || override === 'winter' || override === 'glitter') return override
  const month = date.getMonth() // 0 = January
  if (month === 11 || month <= 1) return 'winter'
  return 'glitter'
}

export interface Drifter {
  x: number
  y: number
  size: number
  color: string
  opacity: number
  /** Straight-down speed, px/s. */
  fall: number
  /** Side-to-side sway: how far (px) and how fast (radians/s). */
  swayAmp: number
  swayRate: number
  swayPhase: number
  /** Spin (radians) and spin speed; tumble is the 3D flip as it turns over. */
  angle: number
  spin: number
  tumble: number
  tumbleRate: number
  /** How much the breeze pushes this one (light leaves catch more). */
  catchWind: number
  /** Current sideways speed from the breeze, eased so leaves don't snap. */
  vx: number
  shape: number
}

const LEAF_COLORS = ['#b5532a', '#c8692b', '#c99a2e', '#8f3a22', '#a8742c', '#7d6b33']
const SNOW_COLORS = ['#a9bccd', '#b9c9d8', '#9fb3c6', '#c5d2de']

// Per laptop-sized screen, scaled by area (same rule as the glitter).
const PER_SCREEN: Record<Exclude<Season, 'glitter'>, number> = { fall: 30, winter: 80 }
const REFERENCE_AREA = 1440 * 900
const MIN_COUNT = 8

const rand = (a: number, b: number) => a + Math.random() * (b - a)
const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)]

export function countFor(season: Exclude<Season, 'glitter'>, width: number, height: number): number {
  const per = PER_SCREEN[season]
  const scaled = Math.round(per * ((width * height) / REFERENCE_AREA))
  return Math.max(MIN_COUNT, Math.min(Math.round(per * 1.5), scaled))
}

function makeDrifter(season: Exclude<Season, 'glitter'>, width: number, height: number, anywhere: boolean): Drifter {
  const leaf = season === 'fall'
  const size = leaf ? rand(10, 22) : rand(2, 6.5)
  return {
    x: rand(-40, width + 40),
    // On first paint they're already spread down the screen; after that they enter from the top.
    y: anywhere ? rand(-40, height) : rand(-80, -20),
    size,
    color: pick(leaf ? LEAF_COLORS : SNOW_COLORS),
    opacity: leaf ? rand(0.35, 0.6) : rand(0.45, 0.85),
    // Bigger leaves fall a touch faster; snow drifts slowly.
    fall: leaf ? rand(16, 30) + size * 0.6 : rand(10, 24) + size * 1.5,
    swayAmp: leaf ? rand(18, 55) : rand(6, 20),
    swayRate: leaf ? rand(0.5, 1.2) : rand(0.4, 0.9),
    swayPhase: rand(0, Math.PI * 2),
    angle: rand(0, Math.PI * 2),
    spin: leaf ? rand(-0.9, 0.9) : rand(-0.3, 0.3),
    tumble: rand(0, Math.PI * 2),
    tumbleRate: leaf ? rand(0.8, 2.2) : 0,
    catchWind: leaf ? rand(0.6, 1.3) : rand(0.4, 0.8),
    vx: 0,
    shape: leaf ? Math.floor(Math.random() * 3) : Math.random() < 0.4 ? 0 : 1, // snow: 60% six-armed flakes, 40% soft dots
  }
}

export function createDrifters(season: Exclude<Season, 'glitter'>, width: number, height: number): Drifter[] {
  return Array.from({ length: countFor(season, width, height) }, () => makeDrifter(season, width, height, true))
}

/**
 * The breeze at time t (seconds), px/s, positive = to the right. It slowly
 * swings between blowing left and blowing right (a couple of minutes each way,
 * never on a beat), with calmer stretches as it turns and the odd short gust in
 * whichever direction it's blowing.
 */
export function breezeAt(t: number): number {
  // Two slow, unrelated waves: the direction drifts instead of flipping on a schedule.
  const prevailing = 14 * Math.sin(t * 0.041) + 7 * Math.sin(t * 0.017 + 2.1)
  const swell = 10 * Math.sin(t * 0.23 + 1.3) * Math.sin(t * 0.051)
  const gust = Math.max(0, Math.sin(t * 0.13 + 0.4)) ** 6 * 32 * Math.sign(prevailing || 1)
  return prevailing + swell + gust
}

/** Move every drifter forward by dt seconds; ones that leave the screen come back in at the top. */
export function stepDrifters(ds: Drifter[], season: Exclude<Season, 'glitter'>, t: number, dt: number, width: number, height: number): void {
  const wind = breezeAt(t)
  for (let i = 0; i < ds.length; i++) {
    const d = ds[i]
    // Ease toward the breeze (inertia), so a gust builds instead of jerking.
    d.vx += (wind * d.catchWind - d.vx) * Math.min(1, dt * 0.8)
    d.swayPhase += d.swayRate * dt
    d.angle += d.spin * dt + (season === 'fall' ? Math.cos(d.swayPhase) * 0.35 * dt : 0)
    d.tumble += d.tumbleRate * dt
    // A leaf slows as it swings sideways (it "floats" at the end of each swing).
    const lift = season === 'fall' ? 0.75 + 0.25 * Math.abs(Math.cos(d.swayPhase)) : 1
    d.x += (d.vx + Math.cos(d.swayPhase) * d.swayAmp * d.swayRate) * dt
    d.y += d.fall * lift * dt
    if (d.y > height + 40 || d.x > width + 80 || d.x < -80) {
      const fresh = makeDrifter(season, width, height, false)
      // Enter upwind: shift the start against the breeze by about half of how
      // far it will be carried on the way down, so no side of the screen goes bare.
      const carried = wind * fresh.catchWind * (height / fresh.fall)
      fresh.x -= Math.max(-width * 0.6, Math.min(width * 0.6, carried * 0.5))
      ds[i] = fresh
    }
  }
}

/** Leaf outlines on a unit box (about -1..1), point at the top. */
function leafPath(shape: number): Path2D {
  const p = new Path2D()
  if (shape === 0) {
    // Maple: five lobes.
    p.moveTo(0, -1)
    p.lineTo(0.18, -0.55); p.lineTo(0.55, -0.72); p.lineTo(0.42, -0.3)
    p.lineTo(0.95, -0.2); p.lineTo(0.6, 0.12); p.lineTo(0.78, 0.42)
    p.lineTo(0.25, 0.32); p.lineTo(0.08, 0.72); p.lineTo(0.04, 1)
    p.lineTo(-0.04, 1); p.lineTo(-0.08, 0.72); p.lineTo(-0.25, 0.32)
    p.lineTo(-0.78, 0.42); p.lineTo(-0.6, 0.12); p.lineTo(-0.95, -0.2)
    p.lineTo(-0.42, -0.3); p.lineTo(-0.55, -0.72); p.lineTo(-0.18, -0.55)
    p.closePath()
  } else if (shape === 1) {
    // Birch / aspen: an almond with a short stem.
    p.moveTo(0, -1)
    p.bezierCurveTo(0.62, -0.62, 0.62, 0.45, 0, 0.82)
    p.bezierCurveTo(-0.62, 0.45, -0.62, -0.62, 0, -1)
    p.moveTo(0.03, 0.8); p.lineTo(0.03, 1); p.lineTo(-0.03, 1); p.lineTo(-0.03, 0.8)
  } else {
    // Oak: rounded lobes down each side.
    p.moveTo(0, -1)
    p.quadraticCurveTo(0.35, -0.9, 0.22, -0.62)
    p.quadraticCurveTo(0.6, -0.55, 0.32, -0.28)
    p.quadraticCurveTo(0.72, -0.15, 0.36, 0.08)
    p.quadraticCurveTo(0.62, 0.32, 0.22, 0.45)
    p.quadraticCurveTo(0.3, 0.72, 0.04, 0.78)
    p.lineTo(0.04, 1); p.lineTo(-0.04, 1); p.lineTo(-0.04, 0.78)
    p.quadraticCurveTo(-0.3, 0.72, -0.22, 0.45)
    p.quadraticCurveTo(-0.62, 0.32, -0.36, 0.08)
    p.quadraticCurveTo(-0.72, -0.15, -0.32, -0.28)
    p.quadraticCurveTo(-0.6, -0.55, -0.22, -0.62)
    p.quadraticCurveTo(-0.35, -0.9, 0, -1)
  }
  return p
}

let leafPaths: Path2D[] | null = null
let flakePath: Path2D | null = null

function snowflake(): Path2D {
  const p = new Path2D()
  for (let k = 0; k < 6; k++) {
    const a = (k * Math.PI) / 3
    const c = Math.cos(a), s = Math.sin(a)
    p.moveTo(0, 0); p.lineTo(c, s)
    // Two little branches on each arm.
    const bx = c * 0.55, by = s * 0.55
    p.moveTo(bx, by); p.lineTo(bx + Math.cos(a + 0.6) * 0.3, by + Math.sin(a + 0.6) * 0.3)
    p.moveTo(bx, by); p.lineTo(bx + Math.cos(a - 0.6) * 0.3, by + Math.sin(a - 0.6) * 0.3)
  }
  return p
}

export function drawDrifters(ctx: CanvasRenderingContext2D, ds: Drifter[], season: Exclude<Season, 'glitter'>, fade = 1): void {
  if (season === 'fall' && !leafPaths) leafPaths = [leafPath(0), leafPath(1), leafPath(2)]
  if (season === 'winter' && !flakePath) flakePath = snowflake()
  for (const d of ds) {
    ctx.save()
    ctx.globalAlpha = d.opacity * fade
    ctx.translate(d.x, d.y)
    ctx.rotate(d.angle)
    if (season === 'fall') {
      // Turning over in the air: the leaf narrows as it flips edge-on.
      ctx.scale(d.size, d.size * (0.25 + 0.75 * Math.abs(Math.cos(d.tumble))))
      ctx.fillStyle = d.color
      ctx.fill(leafPaths![d.shape])
      // A faint midrib so it reads as a leaf, not a blob.
      ctx.globalAlpha = d.opacity * fade * 0.5
      ctx.strokeStyle = 'rgba(70, 40, 20, 0.6)'
      ctx.lineWidth = 0.06
      ctx.beginPath(); ctx.moveTo(0, -0.85); ctx.lineTo(0, 0.95); ctx.stroke()
    } else if (d.shape === 1) {
      ctx.scale(d.size * 1.4, d.size * 1.4)
      ctx.strokeStyle = d.color
      ctx.lineWidth = 0.14
      ctx.lineCap = 'round'
      ctx.stroke(flakePath!)
    } else {
      ctx.fillStyle = d.color
      ctx.beginPath(); ctx.arc(0, 0, d.size * 0.55, 0, Math.PI * 2); ctx.fill()
    }
    ctx.restore()
  }
}
