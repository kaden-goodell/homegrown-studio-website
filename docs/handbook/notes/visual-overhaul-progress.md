# Visual Overhaul Progress — 2026-03-02

## Status: COMPLETE — all committed on dev branch

### What's Done
- Glass morphism overhaul — all pages use translucent frosted panels (35% opacity)
- Modern hover effects (scale + glow), gradient CTAs, flowing layout
- Header: scroll-shadow, animated nav underlines, frosted glass backdrop
- Footer: simplified horizontal layout, light bg matching page (not dark)
- Homepage: full-height hero on glass panel, asymmetric offering cards, horizontal scroll testimonials
- Workshops: glass cards with date badges, themed toggle/search
- About: glass panels around content sections
- Gallery: glass cards with image zoom on hover
- Newsletter: variant prop ('light'|'dark'), currently using light variant
- Purple classes fully removed, warm palette applied everywhere
- Body bg moved to html, textures no longer set opaque bg
- Shimmer canvas is position:fixed, added to both Layout.astro AND StaticLayout.astro
- Gold shimmer particles: saturated golds, 100 particles, 1-3px radius, 0.5-1.0 opacity

### Key Shimmer Config (Shimmer.tsx)
- COLORS: `['#c8943c', '#b8860b', '#daa520', '#cd853f', '#d4a040']` (saturated golds)
- PARTICLE_COUNT: 100
- radius: `1 + Math.random() * 2` (1-3px)
- maxOpacity: `0.5 + Math.random() * 0.5` (0.5-1.0)
- Canvas: position:fixed, inset:0, z-index:0

### Key Architecture Decisions
- Background color on `<html>` not `<body>` so canvas shows through
- Texture classes have NO background-color (only background-image patterns)
- Glass panels use `rgba(255,255,255,0.35)` with `backdrop-filter: blur()`
- Shimmer in BOTH Layout.astro and StaticLayout.astro

### Relevant Commits (dev branch)
- `d7f3673` — glass morphism overhaul
- `13d52f6` — glass transparency + unified bg
- `b7d24f1` — body transparent, shimmer fixed viewport
- `164fd97` — visible gold particles (saturated colors, 100 count)
- `8968618` — scale down particles to 1-3px
