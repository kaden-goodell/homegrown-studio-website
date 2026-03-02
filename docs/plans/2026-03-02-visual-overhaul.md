# Visual Overhaul Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the site from a generic template look to a sleek, modern, Anthropologie-inspired craft studio with ambient gold canvas glitter, asymmetric layouts, and editorial design.

**Architecture:** Replace the existing CSS Shimmer component with a canvas-based glitter system. Redesign all static pages with asymmetric layouts, editorial typography, and warm color palette. Keep booking wizard functional layout intact.

**Tech Stack:** Astro, React, Tailwind CSS, Canvas API, CSS scroll-snap

---

### Task 1: Canvas Glitter System

Replace the existing `Shimmer.tsx` (8 floating CSS dots) with a proper canvas-based glitter effect.

**Files:**
- Replace: `src/components/shared/Shimmer.tsx`

**Step 1: Write the canvas glitter component**

Replace `src/components/shared/Shimmer.tsx` with a canvas-based glitter system:

```tsx
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

const COLORS = ['#d4a574', '#c4a882', '#e8c89a', '#f0d9b5']
const PARTICLE_COUNT = 60

function createParticles(width: number, height: number): Particle[] {
  return Array.from({ length: PARTICLE_COUNT }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    radius: 1 + Math.random() * 2,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    maxOpacity: 0.4 + Math.random() * 0.4,
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
      const docHeight = document.documentElement.scrollHeight
      canvas!.width = window.innerWidth * dpr
      canvas!.height = docHeight * dpr
      canvas!.style.width = `${window.innerWidth}px`
      canvas!.style.height = `${docHeight}px`
      ctx!.scale(dpr, dpr)
    }

    resize()
    let particles = createParticles(window.innerWidth, document.documentElement.scrollHeight)

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

      ctx!.clearRect(0, 0, canvas!.width / (window.devicePixelRatio || 1), canvas!.height / (window.devicePixelRatio || 1))

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
      particles = createParticles(window.innerWidth, document.documentElement.scrollHeight)
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
        top: 0,
        left: 0,
        width: '100%',
        pointerEvents: 'none',
        zIndex: 0,
      }}
    />
  )
}
```

**Step 2: Verify dev server shows gold twinkles**

Run: `npm run dev` (already running)
Expected: Tiny gold dots twinkling across the background at http://localhost:4321

**Step 3: Run tests and type check**

Run: `npx tsc --noEmit && npx vitest run`
Expected: Clean types, 195 tests pass

**Step 4: Commit**

```bash
git add src/components/shared/Shimmer.tsx
git commit -m "feat: replace CSS shimmer with canvas gold glitter system"
```

---

### Task 2: Update Animations & Global Styles

Update CSS animations and global styles to match the new warm palette and remove stale purple references.

**Files:**
- Modify: `src/styles/animations.css`
- Modify: `src/styles/global.css`

**Step 1: Update animations.css**

Replace the `hover-glow` purple color with primary, and add scroll-chevron animation:

```css
/* In hover-glow:hover — change rgba(124, 58, 237, 0.15) to: */
box-shadow: 0 0 16px rgba(150, 112, 91, 0.15);

/* Add at bottom (before @media prefers-reduced-motion): */
@keyframes scroll-chevron {
  0%, 100% { opacity: 0.4; transform: translateY(0); }
  50% { opacity: 1; transform: translateY(6px); }
}

.scroll-hint {
  animation: scroll-chevron 2s ease-in-out infinite;
}

@keyframes underline-in {
  from { transform: scaleX(0); }
  to { transform: scaleX(1); }
}
```

Add `scroll-hint` and `underline-in` to the reduced motion block:

```css
.scroll-hint { animation: none; opacity: 0.4; }
```

**Step 2: Add dark color var to global.css**

In the `:root` block in `src/styles/global.css`, add after `--color-muted`:

```css
--color-dark: #3d3229;
```

**Step 3: Run type check**

Run: `npx tsc --noEmit`
Expected: Clean

**Step 4: Commit**

```bash
git add src/styles/animations.css src/styles/global.css
git commit -m "feat: update animations for warm palette, add scroll-chevron and dark color var"
```

---

### Task 3: Header Redesign

Replace the thin border header with scroll-shadow + animated underline nav links.

**Files:**
- Modify: `src/components/shared/Header.astro`

**Step 1: Update Header.astro**

Key changes:
1. Remove `border-b` from header, add `transition-shadow` and an id for the scroll script
2. Active link: add a small dot indicator (pseudo-element via a class)
3. Hover links: relative positioning with an `::after` underline that scales in
4. Add a small `<script>` that toggles a `shadow-sm` class on scroll

The header element becomes:
```html
<header id="site-header" class="sticky top-0 z-50 bg-[var(--color-background)]/80 backdrop-blur-md transition-shadow duration-300">
```

Nav links get a wrapper span with the underline animation. Active links get a dot via `data-active` attribute.

Add scroll listener script at bottom:
```html
<script>
  const header = document.getElementById('site-header')
  function onScroll() {
    if (window.scrollY > 10) {
      header?.classList.add('shadow-sm')
    } else {
      header?.classList.remove('shadow-sm')
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true })
  onScroll()
</script>
```

Add scoped `<style>` for nav underline animation:
```css
.nav-link {
  position: relative;
}
.nav-link::after {
  content: '';
  position: absolute;
  bottom: -4px;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--color-primary);
  transform: scaleX(0);
  transform-origin: center;
  transition: transform 0.3s ease;
}
.nav-link:hover::after {
  transform: scaleX(1);
}
.nav-link[data-active]::after {
  transform: scaleX(1);
}
```

**Step 2: Verify visually**

Check http://localhost:4321 — header should have no border by default, subtle shadow on scroll, underline animation on nav hover.

**Step 3: Commit**

```bash
git add src/components/shared/Header.astro
git commit -m "feat: header scroll-shadow and animated nav underlines"
```

---

### Task 4: Footer Redesign

Switch to dark warm background with cream text.

**Files:**
- Modify: `src/components/shared/Footer.astro`

**Step 1: Update Footer.astro**

Key changes:
1. Outer footer: `bg-[var(--color-dark)]` instead of `bg-[var(--color-text)]/5`
2. Border-top: `border-[var(--color-secondary)]/20` instead of `border-[var(--color-primary)]/10`
3. Heading text: `text-[var(--color-background)]` (cream) instead of `text-[var(--color-text)]`
4. Body text / links: `text-[var(--color-background)]/70` instead of `text-[var(--color-muted)]`
5. Link hover: `hover:text-[var(--color-accent)]` instead of `hover:text-[var(--color-primary)]`
6. Bottom bar border: `border-[var(--color-secondary)]/20`
7. Copyright: `text-[var(--color-background)]/50`
8. Increase padding: `py-20` instead of `py-16`

**Step 2: Verify visually**

Check http://localhost:4321 — footer should be dark warm brown with cream text.

**Step 3: Commit**

```bash
git add src/components/shared/Footer.astro
git commit -m "feat: dark warm footer with cream text"
```

---

### Task 5: Homepage Redesign

Full rewrite of `index.astro` with asymmetric layout, full-height hero, horizontal testimonials.

**Files:**
- Modify: `src/pages/index.astro`

**Step 1: Rewrite index.astro**

Key sections:

**Hero** — full viewport height:
- `min-h-screen flex flex-col items-center justify-center`
- Heading: Playfair Display, `text-5xl sm:text-6xl lg:text-7xl`, `tracking-wide` (0.02em via style)
- Subtitle: Inter, `text-lg sm:text-xl`, `max-w-[32ch]`, muted color
- CTA: pill-shaped (`rounded-full`), `px-10 py-4`, warm clay bg, hover glow shadow
- Scroll chevron: SVG down-arrow with `scroll-hint` animation class at bottom of hero

**Offerings** — asymmetric grid:
- Section heading left-aligned with decorative line: `<div class="w-12 h-0.5 bg-secondary mb-8"></div>`
- CSS grid: `grid-cols-1 md:grid-cols-3`, parties card spans `md:col-span-2 md:row-span-2`
- Cards: `bg-[#f5f0ea] border border-secondary/30 rounded-xl p-8`
- Hover: `hover:-translate-y-1 hover:shadow-lg transition`

**Testimonials** — horizontal scroll:
- Outer: `overflow-x-auto scroll-snap-type-x-mandatory flex gap-8`
- Each quote: `min-w-full sm:min-w-[80%] scroll-snap-align-start flex-shrink-0`
- Quote text: `font-heading italic text-2xl sm:text-3xl`
- Attribution: small, muted, right-aligned
- Dot indicators: small circles, active one uses primary color

**Newsletter** — dark section:
- `bg-[var(--color-dark)]` with `text-[var(--color-background)]`
- Newsletter component text colors need inline style overrides for dark bg

**Step 2: Verify visually at multiple breakpoints**

Check http://localhost:4321 at desktop and mobile widths.

**Step 3: Run tests and type check**

Run: `npx tsc --noEmit && npx vitest run`
Expected: Clean types, 195 tests pass

**Step 4: Commit**

```bash
git add src/pages/index.astro
git commit -m "feat: homepage redesign — full-height hero, asymmetric cards, horizontal testimonials"
```

---

### Task 6: Workshops Page Redesign

Restyle workshop cards with accent stripe and date badges. Theme the search/filter controls.

**Files:**
- Modify: `src/components/workshops/WorkshopCard.tsx`
- Modify: `src/components/workshops/WorkshopExplorer.tsx`
- Modify: `src/components/workshops/SearchView.tsx`
- Modify: `src/pages/workshops.astro`

**Step 1: Update WorkshopCard.tsx**

Key changes:
- Card wrapper: `bg-[#f5f0ea] border border-[var(--color-secondary)]/30 rounded-xl overflow-hidden` (remove white bg)
- Add left accent stripe: wrap content in `flex`, with a `<div class="w-1.5 bg-[var(--color-primary)] flex-shrink-0 rounded-l-xl" />` as first child
- Date badge: absolute-positioned in top-right corner, small pill with warm bg
- Replace `bg-gray-900` active toggle with `bg-[var(--color-primary)] text-white`
- Replace `bg-gray-100` inactive toggle with `bg-[#f5f0ea] text-[var(--color-text)]`

**Step 2: Update WorkshopExplorer.tsx**

Theme the view toggle buttons:
- Active: `bg-[var(--color-primary)] text-white` (replace `bg-gray-900`)
- Inactive: `bg-[#f5f0ea] text-[var(--color-text)] hover:bg-[var(--color-secondary)]/30` (replace `bg-gray-100`)

**Step 3: Update SearchView.tsx**

Theme search input and category select:
- `border-[var(--color-secondary)]/50` instead of `border-gray-300`
- `focus:ring-[var(--color-primary)]` instead of `focus:ring-gray-400`
- Category select: style as pill-shaped (`rounded-full px-5`)

**Step 4: Update workshops.astro**

- Add section heading with decorative line (same pattern as homepage)
- More vertical padding: `py-20` instead of `py-12`

**Step 5: Verify visually**

Check workshops page — cards should have warm cream bg, accent stripe, themed controls.

**Step 6: Run tests and type check**

Run: `npx tsc --noEmit && npx vitest run`
Expected: Clean

**Step 7: Commit**

```bash
git add src/components/workshops/WorkshopCard.tsx src/components/workshops/WorkshopExplorer.tsx src/components/workshops/SearchView.tsx src/pages/workshops.astro
git commit -m "feat: workshops page redesign — accent stripe cards, themed controls"
```

---

### Task 7: About Page Redesign

Editorial layout with generous whitespace and decorative heading lines.

**Files:**
- Modify: `src/pages/about.astro`

**Step 1: Update about.astro**

Key changes:
- Increase max-width: `max-w-4xl` instead of `max-w-3xl`
- More vertical padding: `py-28` instead of `py-20`
- Page title: add decorative line below (`<div class="w-16 h-0.5 bg-secondary mx-auto mt-6"></div>`)
- Article headings: left-aligned with decorative line beside them:
  ```html
  <div class="flex items-center gap-4 mb-6">
    <div class="w-8 h-0.5 bg-secondary flex-shrink-0"></div>
    <h2 class="text-2xl md:text-3xl font-heading font-semibold text-[var(--color-primary)]">{title}</h2>
  </div>
  ```
- Prose: add `!leading-[1.9]` for more generous line-height
- More margin between articles: `mb-20` instead of `mb-16`

**Step 2: Verify visually**

Check about page — should feel editorial/magazine-like.

**Step 3: Commit**

```bash
git add src/pages/about.astro
git commit -m "feat: about page editorial layout with decorative headings"
```

---

### Task 8: Gallery Page Polish

Update gallery card styling to match warm palette.

**Files:**
- Modify: `src/pages/gallery.astro`

**Step 1: Update gallery.astro**

Key changes:
- Page heading: add decorative line below (same pattern as about)
- `.gallery-item` background: `#f5f0ea` instead of `white`
- Add subtle border: `border border-[var(--color-secondary)]/20`
- More vertical padding: `py-28`

**Step 2: Verify visually**

Check gallery page.

**Step 3: Commit**

```bash
git add src/pages/gallery.astro
git commit -m "feat: gallery page warm palette polish"
```

---

### Task 9: Newsletter Component Dark-Mode Styles

The newsletter renders inside a dark section on the homepage. Update it to work on dark backgrounds.

**Files:**
- Modify: `src/components/shared/Newsletter.tsx`

**Step 1: Update Newsletter.tsx**

The component uses inline styles for some colors. It needs to detect when it's on a dark background. Simplest approach: accept an optional `variant` prop.

Add `variant?: 'light' | 'dark'` to the component (default `'light'`).

When `variant === 'dark'`:
- Heading color: `var(--color-background)` (cream)
- Subtitle color: `var(--color-background)` with 70% opacity
- Success message: `var(--color-accent)`
- Input: keep white bg (looks good on dark)
- Button: `var(--color-accent)` bg with dark text

Update `index.astro` to pass `variant="dark"` when rendering in the dark newsletter section.

**Step 2: Verify visually**

Check newsletter section on homepage — text should be cream on dark brown bg.

**Step 3: Run tests and type check**

Run: `npx tsc --noEmit && npx vitest run`
Expected: Clean

**Step 4: Commit**

```bash
git add src/components/shared/Newsletter.tsx src/pages/index.astro
git commit -m "feat: newsletter dark variant for dark background sections"
```

---

### Task 10: Final Verification

**Step 1: Full type check and test run**

Run: `npx tsc --noEmit && npx vitest run`
Expected: Clean types, 195 tests pass

**Step 2: Visual check all pages**

Visit each page at desktop and mobile widths:
- http://localhost:4321/ (homepage)
- http://localhost:4321/about
- http://localhost:4321/workshops
- http://localhost:4321/gallery
- http://localhost:4321/book

Verify:
- Gold glitter twinkles across all pages
- Warm off-white background, clay buttons, soft gray text
- No purple remnants
- Header shadow appears on scroll
- Footer is dark warm brown
- Homepage: full-height hero, asymmetric cards, horizontal testimonials
- All pages responsive at mobile widths

**Step 3: Build check**

Run: `npm run build`
Expected: Clean production build
