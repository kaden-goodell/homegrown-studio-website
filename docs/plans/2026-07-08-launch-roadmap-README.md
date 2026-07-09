# Homegrown Studio Launch Roadmap — Plan Index

> **Source:** Full-site audit dossier, 2026-07-08 (UI/UX, SEO/SEM, integration, pricing).
> **For agents:** Each phase plan below is fully self-contained — open it in a fresh session and execute top to bottom with sdd (sequential) or team-dev (parallel). Read THIS file first for shared context, then the phase plan.

**Grand opening: Friday, July 31, 2026** (Parents' Night Out 6–9pm). Today is ~3 weeks out.

## Execution order

| # | Plan file | Goal | When |
|---|-----------|------|------|
| 1 | `2026-07-08-phase1-production-ready-plan.md` | Fix broken/embarrassing production: real business info, SEO foundation, crawlable pages, security fixes, one production deploy | ASAP (this week) |
| 2 | `2026-07-08-phase2-take-money-plan.md` | Alternating-week schedule, real Square catalog, policies/waiver, deposits, analytics, revenue report, modal accessibility | Week of Jul 13 |
| 3 | `2026-07-08-phase3-launch-polish-plan.md` | Gift cards, open-studio page, pricing display, opening banner, corporate inquiries | Week of Jul 20–27 |
| 4 | `2026-07-08-phase4-post-launch-plan.md` | Caching, validation, CI hardening, Event schema, experiment runbook | August |

Phases must run in order (2 depends on 1's refactors, etc.). Tasks *within* a phase declare their own dependencies.

## Shared project context (read once, applies to every phase)

- **Repo:** `/Users/catherine/source/homegrownStudio`. Astro 5 **SSR** (`output: 'server'`) + React islands, deployed on **Netlify** via `@astrojs/netlify`. Tailwind + custom glassmorphism styles.
- **Path aliases** (vitest.config.ts + tsconfig): `@config` → `src/config`, `@lib` → `src/lib`, `@components` → `src/components`, `@providers` → `src/providers`, `@layouts` → `src/layouts`, `@styles` → `src/styles`.
- **Business:** "Homegrown Studio" (NOT "Homegrown Craft Studio" — that's only the domain), a craft studio in the Huntsville, AL area. Hours: Thu/Fri 4–9pm, Sat 9am–9pm, Sun 2–8pm, timezone America/Chicago. Domain: `homegrowncraftstudio.com`.
- **Offerings:**
  - **Workshops** — evening classes (6pm+), Square "Classes", booked per-seat via `WorkshopBookingModal` using Square's buyer-facing classes API (see `~/.claude/.../memory/square-class-bookings.md` if reachable; key fact: payment uses hardcoded `CLASS_BOOKING_APP_ID` in `src/config/site.config.ts`).
  - **Party** — whole-studio rental: $200 base + per-head craft cost (craft is a Square modifier, $20–90 range), 2h + 1h cleanup, latest start 3pm ("6pm-exclusive" rule keeps evenings for workshops). Booked via `/book` → `PartyModal` → `/api/party/*`. Pricing single-source-of-truth: `src/lib/party-pricing.ts` (marginal volume tiers: guests 1–10 full price, 11–20 25% off craft, 21+ 50% off craft; $200 base never discounted). Max 30 guests.
  - **Open Studio** — walk-in, no booking. Display-only calendar windows stored in Square catalog item custom attribute `programDates` (format `YYYY-MM-DDTHH:MM-HH:MM,...`), parsed by `src/lib/open-studio.ts`.
  - **Programs** — feature exists but `enabled: false` (hidden). Leave hidden.
- **THE EXPERIMENT:** Open-studio weeks and party weeks **alternate weekly** (week A = open studio, no party bookings; week B = party slots, no open studio). Workshops run every week in the evenings. Owners will compare revenue for ~6–8 weeks per mode, then phase out the loser.
- **⚠️ SCHEDULING DECISION (owner, 2026-07-08): the alternating-week schedule is managed entirely IN SQUARE, not in app code.** Kaden controls party availability via Square Appointments and open-studio dates via the `programDates` custom attribute. The app stays passive: it displays whatever Square returns and explains empty weeks gracefully. Do NOT build app-side schedule pattern config or week-type enforcement. Phase 2 adds the display/messaging; Phase 4 documents how to evaluate the experiment.
- **Square:** source of truth for catalog/bookings/payments. SDK v44 (`square` npm pkg). **v44 gotcha:** responses sometimes need unwrapping — copy the existing pattern `((resp as any)?.object ?? resp)` seen in `src/pages/api/calendar.json.ts`. `PROVIDER_MODE` env var switches `mock` ↔ `square` (default mock). Square custom-attribute definitions are **maxed at 10 — never create a new one**; reuse existing fields (`specialRequests`, `programDates`, `flow`).
- **Current catalog IDs in `src/config/party.config.ts` are TEST data** (objects prefixed "TEST —" in the real Square production account, created by `scripts/test-data-setup.mjs`, removable with `scripts/test-data-teardown.mjs`). Phase 2 swaps them for real objects.
- **Netlify credits:** production deploys (push to `main`) cost 15 credits of a 1000/month budget. Deploy previews from `dev` are FREE. **Workflow: commit and push to `dev` freely. NEVER push/merge to `main` without the user explicitly approving** — each phase plan ends with a "propose production deploy" step, not an automatic one.
- **Git:** work on `dev` branch. Conventional commits: `type(scope): message`, types `feat|fix|docs|chore|refactor|test`. User is `kaden` / `kaden.goodell@gmail.com`.
- **Tests:** vitest (jsdom, `tests/setup.ts`, aliases configured). Run with `npx vitest run` (Phase 1 adds a `test` npm script). Existing tests live in `tests/` (api, components, providers, e2e).
- **Verify before claiming done:** `npm run build` must succeed and `npx vitest run` must pass at the end of every task that touches code. Local dev: `npm run dev` → http://localhost:4321 (a `.env` with sandbox/production Square vars may exist; mock mode works without it).

## Required inputs from Kaden (ask before/while executing — do NOT invent these)

| Input | Needed by | Placeholder rule |
|---|---|---|
| Real street address + city + zip | Phase 1 Task 2 | Site currently shows fake "123 Main St, Anytown, CA 90210". **Do not deploy to production while fake address/phone remain.** If Kaden hasn't answered, use city "Huntsville, AL" prose only and OMIT street/phone from pages + JSON-LD rather than shipping fakes. |
| Real phone number | Phase 1 Task 2 | Same rule — omit if unknown. |
| Final craft menu + per-head prices | Phase 2 Task 8 (real catalog) | Recommended defaults are in the plan; confirm before creating real catalog objects. |
| Square gift-card ordering URL (Square Dashboard → Payments → Gift Cards → eGift ordering page) | Phase 3 Task 1 | Page renders an "email us" fallback if empty. |
| Real gallery photos | Phase 3 Task 6 | Skip task if not provided; leave note. |
| Approval to deploy to production | End of Phases 1, 2, 3 | Hard gate. 15 Netlify credits each. |

## Known live-production defects (why Phase 1 is urgent)

Verified against https://homegrowncraftstudio.com on 2026-07-08: `/calendar` → 404, `/api/workshops.json` → 404 (workshops page loads skeletons forever), nav still links `/programs`, footer shows the fake Anytown address, no robots.txt/sitemap/OG tags. Production (`main`) is ~1 month behind `dev`.
