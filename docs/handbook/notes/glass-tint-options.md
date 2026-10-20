# Glass Tint Options (Homepage Cards)

Tested 4 glass tint options for the `.glass` / `.glass-strong` CSS classes on the homepage.
Inner pages (workshops, booking, gallery) use white glass — only homepage uses the tinted glass.

**Winner: Option 1.5**

## Option 1 — Warm Cream (subtle)
- Color: `rgb(235, 222, 210)` — soft sandy cream
- `--glass: rgba(235, 222, 210, 0.45)`
- `--glass-strong: rgba(235, 222, 210, 0.6)`
- Gradient: `rgba(235, 222, 210, 0.5)` → `rgba(245, 235, 225, 0.3)` → `rgba(235, 222, 210, 0.45)`
- saturate: 1.3 / 1.4
- Verdict: Noticeable but subtle. User liked it.

## Option 1.5 — Warm Cream+ (CHOSEN)
- Color: `rgb(230, 208, 189)` — slightly warmer than 1
- `--glass: rgba(230, 208, 189, 0.38)`
- `--glass-strong: rgba(230, 208, 189, 0.51)`
- Gradient: `rgba(230, 208, 189, 0.42)` → `rgba(240, 228, 218, 0.25)` → `rgba(230, 208, 189, 0.38)`
- Strong: `rgba(230, 208, 189, 0.55)` → `rgba(240, 228, 218, 0.34)` → `rgba(230, 208, 189, 0.47)`
- saturate: 1.35 / 1.45
- Verdict: "That's it!" — perfect balance.

## Option 2 — Halfway (too muted)
- Color: `rgb(224, 194, 168)` — midpoint between 1 and 3
- `--glass: rgba(224, 194, 168, 0.3)`
- `--glass-strong: rgba(224, 194, 168, 0.42)`
- Gradient: `rgba(224, 194, 168, 0.35)` → `rgba(235, 222, 210, 0.2)` → `rgba(224, 194, 168, 0.3)`
- saturate: 1.35 / 1.45
- Verdict: "Looks half-assed" — neither here nor there.

## Option 3 — Frosted Amber (too strong)
- Color: `rgb(212, 165, 116)` — accent color at low opacity
- `--glass: rgba(212, 165, 116, 0.15)`
- `--glass-strong: rgba(212, 165, 116, 0.22)`
- Gradient: `rgba(212, 165, 116, 0.18)` → `rgba(196, 168, 130, 0.1)` → `rgba(212, 165, 116, 0.15)`
- saturate: 1.4 / 1.5
- Verdict: "Too much" — too obviously tinted.

## Common properties (all options)
- All use diagonal gradient (135deg) with lighter middle for glass refraction effect
- White border: `rgba(255, 255, 255, 0.45-0.6)`
- Inset highlights: top `rgba(255,255,255,0.5-0.7)`, bottom `rgba(150,112,91,0.06-0.08)`
- Outer shadow: warm brown layered shadows
- blur: 20px (glass) / 24px (glass-strong)
