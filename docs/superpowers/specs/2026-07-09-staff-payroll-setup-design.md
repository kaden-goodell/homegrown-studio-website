# Staff, Payroll & Store-Credit Compensation — Design

**Date:** 2026-07-09
**Status:** Approved by Kaden (this doc formalizes the approved design)
**Context:** Grand opening Fri July 31, 2026. 6–10 workers at launch. Account: Homegrown Studio, Madison, AL (location `LTHCH1W1J3Y4Q`). Square Plus subscription assumed active (Kaden: "pretty sure we already have it" — verify in dashboard during Phase 1).

## Worker groups

| Group | Structure | Pay |
|---|---|---|
| Hourly assistants (HS/college) | W-2 hourly employees | Cash wage (rate TBD by Kaden), direct deposit |
| Future salaried staff | Same payroll plan, flip hourly → salary later | Deferred — no work now |
| "Studio Crew" moms | W-2 hourly at **$7.25/hr cash** + **store-credit top-up** per hour worked (~$12–15/hr in credit, exact rate TBD by Kaden) | Small cash wage keeps FLSA-minimum-wage compliance; credit is the real draw. Confirm structure with CPA. |

Key constraints:
- **Nobody new becomes bookable in Appointments.** Kaden's calendar-blocking availability model must be untouched. Team members are created for payroll/clock-in only; bookability stays a per-member opt-in we never set.
- Keep moms under 40 hrs/week — overtime regular-rate math with in-kind credit is not worth entering.
- Alabama workers' comp is required at 5+ employees (part-timers count). 6–10 heads crosses it.

## Products & costs

- **Square Payroll** (chosen over Gusto: $35/mo + $6/person-paid vs $49 + $6; Gusto Simple lacks time tracking; Square imports clock-in timecards natively; next-day direct deposit). ~$71–95/mo at 6–10 people.
- **Square Shifts via existing Square Plus**: clock in/out (Team app or POS passcode), timecards, scheduling, **native open-shift claiming in the Team app** — moms can self-claim posted slots day one, no build required.
- **Square Gift Cards**: store-credit vehicle. Promotional loads via Gift Card Activities API are free (no money movement).
- Workers' comp: pay-as-you-go via Square's payroll-partner offering (small premium for part-time staff).

## Phases

### Phase 1 — Registrations & subscriptions (Kaden, manual; dashboard blocked for Claude)
1. Register AL withholding account (My Alabama Taxes) and AL DOL unemployment account. **Start immediately** — lead time is days-to-weeks and payroll onboarding needs both numbers.
2. Verify Square Plus is actually active (Dashboard → Settings → Pricing & subscriptions).
3. Subscribe to Square Payroll; connect + verify bank; add workers' comp policy in the payroll flow.
4. Decide: hourly assistant wage, mom credit rate, pay frequency (weekly vs biweekly).

### Phase 2 — Team setup (Claude, via Team API)
- Create team members with two jobs: **Studio Assistant** (market hourly) and **Studio Crew** ($7.25/hr).
- Wage settings via Team API `WageSetting`; verify none appear as bookable staff afterward.
- Script: `scripts/team/add-team-member.ts` (name, email, phone, job, wage) so future adds stay API-driven per Kaden's preference.
- Clock-in setup: team passcodes for POS + Square Team app invites (dashboard-side toggles done by Kaden if API can't set them).

### Phase 3 — Store-credit engine (Claude, build)
- `scripts/team/load-crew-credit.ts`, run each pay period:
  1. Pull the period's timecards for Studio Crew members (Labor API).
  2. hours × credit rate → promotional load onto each mom's gift card (Gift Card Activities API; create card on first run, GAN stored/looked up by customer).
  3. Print a per-person summary (hours, credit loaded, running balance) for Kaden's records.
- Idempotency: tag loads with pay-period key so a re-run never double-loads.
- Later: becomes a page on the planned admin site.

### Phase 4 — Mom slot signup: native Team app + auto-posted open shifts — FINAL (Kaden picked Option A, 2026-07-09, after seeing side-by-side mockups)
The Square Team app natively supports open-shift claiming: manager publishes unassigned shifts → team member taps Request → manager approves via push notification. Moms need the Team app anyway for clock-in, so mom-facing build is ZERO.

- **`scripts/team/post-open-shifts.ts`** (the only build): cuts business hours (Thu/Fri 4–9, Sat 9–9, Sun 2–8) into 3–4 hr "Studio Crew" open slots and publishes them for a target week via the ScheduledShift API (unassigned = open). Idempotent per week (skip already-posted slots). Run weekly by Kaden or a scheduled job.
- Moms claim in the Team app; Kaden approves with one tap per claim; assistants placed afterward in Square's native drag-drop dashboard scheduler.
- **Superseded:** the custom `/crew` drag-paint grid + magic-link login (previous revision of this section) is shelved as an admin-site-era v2 (see comparison artifact "Mom Signup: Two Ways"). Nothing in Option A blocks building it later. Resend account no longer needed for launch.

### Phase 5 — Operate
- Timecards import into each pay run; moms paid $7.25 cash via the same run; credit script run alongside.
- Salaried conversion for group 2 when it happens — same payroll plan supports it.

## Open items / risks
- CPA sanity-check on the min-wage-plus-credit structure (and that credit loads are treated as taxable fringe/bonus comp — CPA to advise whether credit value must run through payroll as imputed income).
- Verify Square Plus subscription is actually active.
- Confirm workers' comp quote is reasonable at part-time hours.
- Exact wage rates, credit rate, pay frequency: Kaden decisions in Phase 1.
