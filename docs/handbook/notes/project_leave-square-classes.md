---
name: project_leave-square-classes
description: Kaden wants to move classes off Square's Classes API (18 Oct 2026) after per-seat pricing failed; likely path = party-style checkout
metadata:
  type: project
---
Kaden 2026-10-18: "I feel like we need to get away from using Square's classes... doesn't have a good enough API." Trigger: Adult/Kid ticket pricing failed live (Square charges the class price per seat; see [[square-class-bookings]]). Ticket-type code is on prod but switched off in the CLI (set-event refuses --ticket).

**Why:** one price per class, one person per booking, no Apple Pay, dashboard-session-only writes.
**How to apply:** when this comes up, propose the party-style path — our own order with any line items (Adult/Kid), ONE Payments API charge (Apple Pay works), our roster (seat-choices) as the source of truth, Square class kept only as a calendar entry or dropped. Interim: family classes use one per-person price ($15 for the Oct 23 potholder class).

**DECIDED 2026-10-18 (Kaden: "I'd like to do this for sure... All the way including parties"):** build our own class + party system run from /staff (Catherine must be able to add a class with price, photo, etc. and press Add — "she's not going to get on Claude"; bus-factor). Includes a bookings calendar on /staff. Parties leave Square Bookings too (so Appointments Plus $49/mo can be cancelled). MUST keep everything doable through the Square POS (catalog categories). Process: brainstorm → written spec for Kaden + Catherine → staged plan. Started after the potholder class went live (clssch_nffkh3o72y3qoq, item TW4YSL6VSKLXZMMSBYQNTIJG, $15/person, 40 seats, Fri Oct 23 6–8 PM). Open question asked first: should a POS sale of a class seat auto-count toward capacity (webhook) or POS just takes money + staff add on /staff?

**BRANCH RULE (Kaden 2026-10-18, caps):** all own-booking-system work lives on branch `kaden/own-booking-system` (spec committed d60cd39). NO prod push of it until Kaden says so. `dev` stays for quick prod fixes (dev:main as usual, each on his go). Spec: docs/superpowers/specs/2026-10-18-own-booking-system-design.md (stages 1 core, 2 parties, 3 staff availability/assignments, 4 waitlist/promo/early-bird/repeat).

**STATUS 2026-10-19:** worktree /Users/catherine/source/homegrownStudio-booking; ledger `.superpowers/sdd/2026-10-18-stage1-own-classes/progress.md` is the recovery map (trust it + git log after compaction). Stage 1 tasks 1–12 done; 13 needs fixes; 14–17 open. Preview = Square SANDBOX + STORE_NAMESPACE=preview (https://kaden-own-booking-system--iridescent-croissant-494fc3.netlify.app). New stuff goes on /admin (owners), not /staff. Admin redesign **D approved** (5 tabs Home·Calendar·Classes·Inbox·More, one sheet deep, iPad sidebar) — mock-up https://claude.ai/artifact/Pu123yENkG5pLdcaa2AzyN. Kaden gave FULL AUTONOMY to finish ALL 4 stages, "production level", fully tested, UI "smoking hot" — still no prod push, no unproven live Square writes, nothing auto-cancels/refunds. Owner decision R14: charge Square's order total, refuse only if > quote + $1.
