# Visual Overhaul Design — Sleek, Modern, Gold Glitter

**Date:** 2026-03-02
**Goal:** Transform the site from generic WordPress-template look to a sleek, modern, Anthropologie-inspired craft studio with ambient gold glitter.

## Palette (already applied)

| Role | Hex | Description |
|------|-----|-------------|
| primary | `#96705B` | warm clay/terracotta |
| secondary | `#c4a882` | soft tan |
| accent | `#d4a574` | warm gold |
| background | `#faf8f5` | warm off-white |
| text | `#374151` | soft dark gray |
| muted | `#6b7280` | gray |
| dark | `#3d3229` | warm dark brown (footer/contrast sections) |

## 1. Glitter System

Fixed `<canvas>` behind all content (`z-index: -1`), managed by a ~2KB script.

- **Particles:** ~60 gold dots randomly placed across full page height
- **Colors:** Random from `['#d4a574', '#c4a882', '#e8c89a', '#f0d9b5']`
- **Size:** 1-3px radius, mostly tiny
- **Animation:** Each particle fades between 0 and 0.4-0.8 max opacity on its own random 2-6s cycle. No movement, just breathing/twinkling
- **Density:** Sparse — ambient light catching gold leaf, not a snow globe
- **Performance:** `requestAnimationFrame`, only redraws changed particles, pauses on `visibilitychange`
- **Accessibility:** `prefers-reduced-motion` → static particles at low opacity, no animation
- **Implementation:** `<script>` in StaticLayout and Layout, creates its own canvas element

## 2. Homepage Layout

### Hero (full viewport)
- Playfair Display heading, 5-7rem, letter-spacing 0.02em
- Subtitle: Inter, 1.25rem, muted, max-width 32ch
- CTA: pill-shaped button, warm clay bg, soft glow on hover
- Subtle animated scroll chevron at bottom
- No gradient blobs or dot patterns — glitter canvas does the work

### Offerings (asymmetric)
- Section heading left-aligned with thin decorative line
- Parties card spans 2 columns (primary offering), workshops + gallery stack in 1 column
- Cards: warm cream bg (`#f5f0ea`), thin `border-secondary`, generous padding
- Hover: lift + warm shadow

### Testimonials (horizontal scroll)
- Single large editorial pull-quote at a time
- Playfair italic for the quote text
- CSS `scroll-snap-type: x mandatory`
- Dot indicators below

### Newsletter
- Dark warm section (`#3d3229`) with light/cream text
- Creates visual contrast/rhythm break

## 3. Header
- Sticky + backdrop-blur (keep)
- Replace border-bottom with subtle warm shadow on scroll
- Nav links: subtle underline animation on hover
- Active link: small dot indicator underneath

## 4. Workshops Page
- Cards in responsive grid with warm cream bg
- Colored accent stripe on left edge of each card (primary color)
- Date/time as stacked badge in top-right corner
- Category filters as pill toggles

## 5. About Page
- Full-width editorial layout with generous whitespace
- Section headings with thin decorative line beside them
- Larger line-height for prose readability

## 6. Gallery Page
- CSS `columns`-based masonry grid (when images exist)
- Current placeholder structure otherwise

## 7. Footer
- Dark warm background (`#3d3229`) with cream text
- Same 3-column structure with more breathing room
- Bottom bar with thin `border-secondary` divider

## 8. Booking Wizard
- Keeps functional layout as-is
- Inherits glitter background, updated palette, themed buttons/inputs (already done)

## Files to Create/Modify
- `src/lib/glitter.ts` — new, canvas glitter script
- `src/layouts/StaticLayout.astro` — add glitter script, update header/footer refs
- `src/layouts/Layout.astro` — same glitter integration
- `src/pages/index.astro` — full homepage redesign
- `src/pages/about.astro` — editorial layout
- `src/pages/workshops.astro` — card redesign
- `src/pages/gallery.astro` — masonry grid
- `src/components/shared/Header.astro` — scroll shadow, underline nav
- `src/components/shared/Footer.astro` — dark warm bg
- `src/styles/global.css` — add dark color var, updated base styles
- `src/styles/animations.css` — update hover-glow color, add new animations
- `src/styles/textures.css` — may remove/simplify since glitter replaces texture
