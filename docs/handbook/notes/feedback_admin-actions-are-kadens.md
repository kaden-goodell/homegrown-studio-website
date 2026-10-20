---
name: feedback_admin-actions-are-kadens
description: Don't change live/production data on Kaden's behalf when an admin UI exists for it — point him to the button; he rejected a direct DB UPDATE to approve a church
metadata:
  type: feedback
---

When a record needs an admin decision (approve, hide, delete, edit) and the app has an admin screen for it, tell Kaden where the button is instead of running SQL against the live database myself. On 2026-09-20 ([[project_not-on-my-watch]]) I tried to `UPDATE churches SET status='approved'` for his own church; he rejected the tool call and approved it himself in `/admin`.

**Why:** the database is shared by preview and production and holds real people's signups; admin decisions are his to make and he wants to see them happen through the product (which also tests the product).

**How to apply:** read-only queries to diagnose are fine. Writes to live data are limited to cleaning up test rows I created myself (e.g. `@example.com`). For anything else: explain the state, name the admin action, and let him do it.

**Exception set by Kaden 2026-10-06: "You need to be able to flip the drop off switch if I tell you it's dropoff."** When he says a class is drop-off, flip it myself with `npx tsx scripts/set-dropoff.ts --workshop <clssch_id> --on` (writes the PROD `event-meta` blob store via the authed netlify CLI; `by` = "Kaden (CLI)"; `--show`/`--off`/`--days a,b` too). Workshops key on the Square class SCHEDULE id from `scripts/list-classes.ts`. Same spirit for class copy/images/times: when he hands me the facts, push them to Square directly.


**CLARIFIED by Kaden 2026-10-07:** "the rule is not that you can't change live data. It's that you can't change anything that would affect actual existing orders — like an already booked party." So: writing production settings (class questions, capacity, cutoffs, drop-off, copy, images, prices) when he's given me the facts is FINE and expected; the hard line is existing bookings/orders — never cancel, move, release, refund, or reschedule a class that has sign-ups ([[feedback_never-cancel-bookings]]). Don't park config work waiting for a "go" — do it and report it.
