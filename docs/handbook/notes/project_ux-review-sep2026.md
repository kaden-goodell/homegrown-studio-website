---
name: project_ux-review-sep2026
description: "UX review of Parties/Workshops/Calendar (2026-09-27) — Kaden's decisions, the three-deploy plan, Linear tickets HOM-170…205, closed days, automated sign-up emails, and the keep-it-in-Square rule"
metadata:
  node_type: memory
  type: project
  originSessionId: 0431dff9-5ad3-4c52-8305-86f4b0b4219c
  modified: 2026-09-27T20:43:04.266Z
---

On 2026-09-27 Kaden asked for a deep end-user UI/UX review of Parties, Workshops and Calendar, then approved it and asked for the "this week" and "before Oct 16" work to be built. Deploys 1 and 2 are built and committed locally, nothing pushed — see Build status below.

Report (findings, approved before/after sketches, decisions, plan): https://claude.ai/artifact/CEF8PXHudap3XWrBX3bwWm

## Linear
Project "Website & Tech", two milestones: **Safe to sell (before reopening booking)** = HOM-170…179, target 10/2; **Opening-day ready (Oct 16)** = HOM-180…199, target 10/14. HOM-200 = after-opening backlog. The deploy plan is appended to HOM-163 (reopen bookings). Each ticket carries evidence, files, acceptance checklist; line numbers are from commit `89328db`.

- Deploy 1 (booking closed): HOM-170 email capture, 171 remove workshop coupon, 175 favicon, 176 walk-ins/hours, 177 link previews, 178 structured data/sitemap/404, 179 calendar phone rows, 188 rename "Most popular"
- Deploy 2 (reopen): HOM-172 attempt ID + honest messages, 173 workshop errors + release seat, 174 workshop email, 191 month-end calendar bug, then HOM-163 test run and `BOOKINGS_OPEN=true`
- Deploy 3 (before 10/16): HOM-180…198; build HOM-195 (button/contrast) first
- No deploy: HOM-193 Square catalog for the register, HOM-199 photos + reviews (Kaden)

## Kaden's decisions (9/27)
- Sell dates from Oct 16 onward **as soon as the payment fixes are in** (wants to pre-sell before opening; thinks parties may already be late).
- Party booking window **stays 45 days** (new business, wants room to pivot).
- Workshop confirmation email: **we send our own**; still confirm what Square sends.
- Workshop capacity 35 is correct (building capacity).
- Hours need correcting (Sunday workshops run past posted hours) — waiting on the real hours.
- Craft photos are his own or AI-generated; rights question closed.
- Notify-me requests go to Kaden and Catherine's phones.
- All four sketches approved: workshop card, party price summary, calendar phone row, Opening Soon panel.

## Standing rule from Kaden
Keep Square as the backend and stay backend-agnostic: new Square calls go behind `src/providers`; **do not add site-side storage if Square can hold it**; raise it for discussion if not. He is open to reusing old unused Square fields (custom attribute definitions are maxed at 10; several belong to switched-off Programs) — propose, never delete without his say. He also wants per-person party crafts and open-studio crafts usable on the Square register; POS is not set up yet. See [[square-admin-api-capabilities]], [[party-data-rebuild]], [[feedback_square_via_api]].

## Facts worth keeping
- Wallets for workshops are a Square limit, not an oversight: class seats must be paid under Square's booking app ID, which Apple Pay on the site isn't registered under ([[square-class-bookings]]). HOM-194 is a two-hour test.
- The seven party craft items ($15–$25/person) are also what `/open-studio` lists, via `/api/party/service-info.json`.
- Kits nav item and themed-table step render only under `astro dev`, not for customers.
- Linear connector is back on the Homegrown Studio workspace as of 9/27 (it had been lost 8/6).
- Screenshots of a background Chrome tab show paused fade-ins and look washed out; inject CSS to disable `.fade-in` transitions before judging visuals. Chrome can't shrink below ~1178px wide here; render pages in 390px iframes for phone checks.

## Build status (updated 2026-09-27, after the evening session)
- **PRODUCTION = `main` @ `7fa927e`** (deployed 9/27 evening, 15 credits, Kaden said "Yes deploy"): deploys 1, 2 AND 3, with "(tentative)" off the calendar's Grand Opening row. Revert tag `pre-deploy-3-prod-2026-09-27` (= 8bd940e).
- **PREVIEW = `dev` @ `7550041`, NOT in production:** footer column alignment, closed days + holiday calendar (HOM-205), automated sign-up emails (HOM-204). Branch `kaden/ux-refactor-deploy-3` in the worktree. 1,535 tests green, build OK. **Needs Kaden's go for the production deploy.**
- **Booking is still CLOSED in production** (`BOOKINGS_OPEN=false`). One switch gates parties AND workshops. Kaden: "we're not ready to launch parties yet". Do not change it.
- **Revert points:** tags `pre-refactor-2026-09-27` (dev @ 89328db) and `pre-refactor-prod-2026-09-27` (main @ ef26206), pushed.
- Work happens in worktree `.worktrees/hom-195-colors-and-buttons` (`.worktrees/` is in `.git/info/exclude`). The LOCAL `dev` checkout in the main folder is still at 89328db (left so `localhost:4321` shows the old site); it is behind origin.
- Local servers from the worktree: `localhost:4322` (booking open), `localhost:4323` (booking closed). Kaden watches these live while I work and comments on what he sees. Local `.env` points at PRODUCTION Square with `DEV_BYPASS_PAYMENT=true` (party flow skips Square; the WORKSHOP endpoint has no bypass, so never submit a workshop payment locally). Local `.env` has Gmail credentials but NO `LOOKUP_SIGNING_SECRET`, so the sign-up email job refuses every call locally.
- Netlify: `OWNER_ALERT_NUMBERS` SET 9/27. CLI is signed in as Kaden and linked. Neither the owner text nor the sign-up email has been seen arriving (no sign-up submitted; Kaden's to try).
- Square: category renamed **"Crafts"** 9/27 via `scripts/rename-craft-category.ts`. 23 customers, 1 sign-up on record (9/27).
- Preview URL: https://dev--iridescent-croissant-494fc3.netlify.app

### Built 9/27 evening (on preview only)
- **Closed days:** `src/config/closures.ts` (`closures`, `closureOn`, `studioOpenOn`, `daysOf`, `reopensOn`), enforced in `bookableOn` (new result `'closed'`). Closed: Fri 30 Oct to Sun 1 Nov 2026 (Halloween) and 21 Dec 2026 to 1 Jan 2027 (reopen Sat 2 Jan). Calendar shows a "Closed for …" row on EVERY closed day (Kaden rejected one row for the whole week) with holiday colours: tokens `--holiday-halloween*`, `--holiday-christmas*`; orange stripes and candy-cane stripes on the month cells. Hover must set `backgroundColor`, not `background`, or the stripes vanish (Kaden caught this).
- **Automated sign-up emails (HOM-204):** `netlify/functions/signup-emails.ts` runs every 30 min, 8am to 8pm Central, production only; it calls `POST /api/jobs/signup-emails.json` with a key made from `LOOKUP_SIGNING_SECRET`. Rules in `src/lib/signup-due.ts` (`judge`), note lines in `src/lib/signup-ledger.ts`, `src/lib/party-open-dates.ts`, `sendSignupNewsEmail`. State lives in the Square customer note (`Emailed:` / `Email failed:` lines). Does nothing while booking is closed. `{dry:true}` reports counts only.
- "Planning something later" always names a month now (no "Not sure yet"); the month list starts with the month the window ends in.
- Footer columns: Visit left, Hours centred, Contact right (Kaden's request).
- Scripts: `scripts/list-signups.ts` (counts only by default), `scripts/compare-party-availability.ts` (site's party times vs Square's free times, read-only).

### Open decisions (asked 9/27 evening, not yet answered)
- Halloween: Kaden wrote "Oct 29 - Nov 1 (Fri - Sun)" but 29 Oct is a Thursday. Built Fri to Sun.
- How to close a day WITHOUT a deploy (HOM-205): block time in Square's calendar and have the site honour Square's availability, and/or use the party service's "bookable" setting as the parties on/off switch. Square's availability matched all 24 site times on 9/27. Unverified: that a block in Square removes the time from Square's answer.
- "Tentative" is still on the homepage banner and the About page ("Tentatively opening"); Kaden approved removing it from the calendar only.
- Kaden did not know what "party name" meant (HOM-189 item 2): it is the name a host types for their party on their party page ("Mia's 9th birthday"), kept only in their browser today.

### What deploy 3 built (shared pieces worth knowing)
- `src/components/shared/BookingPanel.tsx`: the one shell both booking flows sit in (portal, inert page, pinned footer, leave prompt). `ContactFields.tsx` + `src/lib/contact-rules.ts`: shared fields and messages. `BookingConfirmed.tsx`, `ShareLink.tsx`.
- `src/lib/money.ts` `formatMoney` is THE price formatter. `src/lib/workshop-rules.ts`: `canBeBooked`, `seatsLeftLabel`, `isSoldOut`. `src/lib/party-summary.ts`, `refund-lines.ts`, `signup-promise.ts`, `short-memory.ts`, `cache-headers.ts`.
- `src/lib/party-slots.ts` `bookableDates()` / `bookableOn()`: the ONE rule for which party dates are on offer (opening day, `minLeadDays: 5`, `bookingWindowDays: 45`).
- Workshop panel is two steps; party panel always shows the craft step.
- Footer: dark band, three columns, one row of links (Kaden picked it from three sketches after rejecting two attempts).
- Calendar controls: ONE row, filters as underlined tabs left, List/Month switch right, month name on the grid (Kaden rejected three stacked rows and pill filters).

### Not built
- HOM-189 item 2: party name saved on the Square booking (needs Kaden's decision; editing a live booking may email the customer).
- HOM-172 item 4: party email after responding (needs a Netlify background function).
- HOM-197 photos at display size; HOM-194 wallet test for workshops (needs real phones); HOM-193 register-ready catalog beyond the rename; HOM-199 (Kaden).
- Emoji remain in `waiver-content.ts` handoff labels and `invite-content.ts` buttons (outside this review's pages).

- Shell gotchas in this worktree: the Bash cwd resets to the main checkout after commands that `cd` elsewhere, so start every command with `cd <worktree>`; zsh errors on unmatched globs; vitest's summary is buried in log noise, so write output to a file and grep "Test Files|Tests  ". Commit with explicit paths while helper agents have uncommitted work in the tree.
- Screenshot gotcha: images with `decoding="async"` do not paint in a background-tab screenshot. Set `decoding='sync'` and re-assign `src` before capturing.
- Helper agents finish and go idle WITHOUT their report reaching me. Review their diffs, tests and pages directly.

## Square facts learned the hard way (2026-09-27)
- **Idempotency keys do not replay across a re-typed card.** Same key + same body returns the original result; same key + anything changed (a new payment token) is refused with `IDEMPOTENCY_KEY_REUSED` (HTTP 400). Never read that as a decline. To learn how an earlier try ended, ask Square whether the ORDER is paid (`PaymentProvider.findOrderPayment`).
- A paid order: `state COMPLETED`, `netAmountDueMoney 0`, `tenders[0].paymentId === tenders[0].id`, and `payments.get` on it returns status/receiptUrl. Checked read-only on the real 1 Sep party order.
- `bookings.list` accepts a range of exactly 31 days and refuses anything longer. The provider now splits longer ranges. Before the fix the 45-day party date list failed its lookup on every load and showed booked dates as open (bug is on prod until deploy 2 ships).
- Square sandbox credentials are NOT in `.env`; real retry behaviour is unverified until the HOM-163 test run or a sandbox token.

## Answers from Kaden (2026-09-27, second round)
Interim "H" favicon OK; Sunday hours become 2–9 PM; minimum party notice **5 days** (time to order supplies); hosts may arrive 30 min early; Slack alerts probably NOT set up yet — must test, fall back to a text via Quo. Category rename "Party Crafts" -> "Crafts": not answered yet.

## Answers from Kaden (2026-09-27, third round)
- Calendar day order: **strictly by start time, earliest at the top** ("parties are typically first" only because they start earlier). Overrides HOM-179 item 9 and HOM-192 items 2 and 4.
- Oct 16 to Dec 3 the door is open **only when something is booked**; copy points to the calendar.
- Retry behaviour gets proven in the **$1 production test run** (HOM-163), not a sandbox. Checklist is in a HOM-163 comment.
- He reminded me to check Linear before treating something as a new finding: the tickets already covered most of it. Record decisions ON the ticket.

## Answers from Kaden (2026-09-27, fourth round)
- Rename to "Crafts": yes (done). Time-range format: "whatever" (kept as built).
- **No free workshops.** A class with no price is "Coming soon" and unbookable (HOM-203). "Maybe later, but def not now."
- Calendar felt very slow on phone and desktop -> HOM-202 (fixed).
- Production deploy allowed as long as parties stay closed.
- Deploy 3 may start.

## Kaden's design feedback (2026-09-27, while watching localhost)
- Picking a date and "planning something later" on one screen was "weird": they are now two separate views.
- Footer: rejected the original and a four-column sand version; chose dark band + three columns; then asked for the links in ONE row across the bottom with Policies and Participation agreement to the right of About.
- Calendar: "three stacked looks very weird" on desktop and filter pills "look kind of funny"; after the one-row fix: "WAYY better".
- He expected an automatic email to people who sign up. There was none; the immediate one is now built.

## Still needed from Kaden
 a test sign-up on `/book` to confirm both phones get the text; his word that the calendar now feels fast; when to run the $1 test run and reopen.

**Why:** the next session will be asked to start building from these tickets.
**How to apply:** continue from `kaden/ux-refactor-deploy-2` with the deploy 3 tickets (HOM-180…198); re-verify each finding against current code before editing; never push or deploy without Kaden's go; batch production deploys as listed (15 credits each). See [[feedback_reground-after-compaction]].
