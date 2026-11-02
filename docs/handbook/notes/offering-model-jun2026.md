---
name: offering-model-jun2026
description: "The studio's offering model as of June 2026 — Open Studio (walk-in), Party (whole-room rental), Workshops (per-seat); per-table reservation system was REMOVED"
metadata: 
  node_type: memory
  type: project
  originSessionId: 9947dcb9-a61c-453b-b426-dce80ed91617
---

Redesigned 2026-06-13. Tables are now random sizes (2–8 seats), so the old symmetric per-table reservation model was scrapped. Three offerings:

1. **Open Studio** — pure WALK-IN, non-bookable. Just shown on a calendar so people know when to drop in; pay in person. Modeled as a non-bookable Square catalog ITEM (`flow='display'`, $0), with individual dated windows in `programDates` encoded as `YYYY-MM-DDTHH:MM-HH:MM` comma list (parsed local, no recurrence in code). Parser: `src/lib/open-studio.ts`.
2. **Party** = renting the whole place. BOOKABLE. Square `APPOINTMENTS_SERVICE`: **$200 flat base + per-head craft cost that varies by craft** (craft = a Square modifier list, each modifier carries a per-head price). Flow: date → craft → headcount → info → payment. 2h duration + 1h cleanup (cleanup enforced app-side by offering every-3h start times; Square returns hourly). Code: `src/components/party/`, `src/pages/api/party/`, `src/config/party.config.ts`.
3. **Workshops** — per-seat Classes, UNCHANGED (read via buyer classes API, [[square-class-bookings]]). Must be added in the Square Appointments UI ([[square-admin-api-capabilities]]).

**Removed:** entire `src/components/reservations/` + `src/pages/api/reservations/` + `reservation.config.ts` (per-table deposits, 6-table capacity, whole-studio-via-tables).
**Programs** (multi-day pay-once camps) — code KEPT but hidden (`features.programs.enabled=false`, nav entry removed, `/programs` redirects). Real future offering, nothing to sell now.

**A/B test** = a SCHEDULING approach, not a website feature: alternate weeks (one Open Studio, one Party-bookable), compare revenue per bookable-hour. Party slots gated to ~90 days from opening.

**Updates 2026-07-08 (Kaden):**
- The alternating-week schedule is managed **entirely in Square** (party availability via Square Appointments; open-studio dates via `programDates`). The app stays passive — display what Square returns, explain empty weeks. Do NOT build app-side schedule config/enforcement.
- **NO open-studio studio fee.** Walk-ins pay only for the craft they make (full per-craft price). An earlier $8-fee recommendation was rejected.
- Launch-roadmap implementation plans (4 phases + README) live in `docs/plans/2026-07-08-*`.

**Calendars:** `/calendar` = read-only "What's On" (Open Studio + workshops, no book button); `/workshops` = searchable booking calendar. One Square data source.

**TEST data:** `scripts/test-data-setup.mjs` creates "TEST —" prefixed Open Studio + Party + craft modifiers in PROD Square; `scripts/test-data-teardown.mjs` wipes them (IDs in `scripts/.test-data-ids.json`). `.env` set to `PROVIDER_MODE=square` to read them. Grand opening Fri 2026-07-31 ([[project_homegrown-launch-date]]).


**2026-10-08:** "Open Studio" renamed **"Craft Café"** everywhere customers/staff see it (page `/craft-cafe`, `/open-studio` 301s; nav; homepage card + cut-paper image; calendar; staff Today/incident labels; email default label). Internal code names unchanged. The Instagram "Craft Café" post (1st & 3rd Saturdays, no reservation) is the source of the name.
