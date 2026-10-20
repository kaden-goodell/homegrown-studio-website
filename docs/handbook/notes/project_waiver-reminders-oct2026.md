---
name: project-waiver-reminders-oct2026
description: Class-day 9 AM waiver reminder (email+text) shipped 15 Oct 2026; how it decides; first live run Fri 16 Oct
metadata:
  type: project
---
Shipped to prod 2026-10-15 (main@0202686), with phone-required class checkout and seats-left only under 10.

- Kaden asked for it "rock solid… no false positives/negatives"; channel = email + text (Quo), 9 AM studio time day-of (cron 14:00+15:00 UTC, endpoint acts only at studio hour 09).
- Booked = our seat-choices records, each re-checked via Square buyer GET (`accepted`, same class + time). Signed = RSVP via this booking's link, or current agreement under booking email or phone; "current" = shared `src/lib/waiver-coverage.ts` (door check uses it too).
- Unknown (Square/storage down) → no message, owners' summary lists "Couldn't check". Once per family per day (kv `waiver-reminders`). No name in greeting: bookings often carry the CHILD's name (a child's name).
- Gap: bookings added only in Square's dashboard (no seat record) are not seen.
- Dry run on real data matched the manual audit: one family Friday, two Sunday.

Related: [[square-class-bookings]], [[project-seat-options-oct2026]]

**Results (checked 10/17):** Fri 10/16 had no classes in seat records, so nothing to send. Sat 10/17 9:00 AM: 3 families reminded (names in Square), all 3 signed by 10:42 AM (2 via text link, 1 via email). Sun 10/18: one family unsigned. Netlify function logs only reach back ~1 day; check via `npx netlify blobs:list waiver-reminders` + `contact-email-*` in `waivers`.
