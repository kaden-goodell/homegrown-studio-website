---
name: project-teach-and-admin-oct2026
description: /teach artist application page + owner-only /admin (ADMIN_PASSCODE), built 15 Oct 2026; Kaden's rules for it
metadata:
  type: project
---
Built on dev 2026-10-15 (97ac1d0 + style fix). Not shipped until Kaden says so.

- /teach in the MAIN MENU (Kaden's choice). No pay model on the page ("we'll discuss"), nothing required up front (no insurance/background check). Copy approved; Kaden: NO timelines anywhere ("Don't want timelines") — no "within a week".
- Required: name, email, phone, class idea, ≥1 photo (≤6, shrunk to ~1600px on the phone). Video = link only.
- Submit → saved in blob store `artist-applications` (+ photos), owners emailed with photos attached, artist gets "Thanks, we got it. We'll be in touch."
- /admin: owner-only, separate from /staff, own passcode env ADMIN_PASSCODE (Kaden must set it in Netlify; I must not type it). Lists applications, status New/Talking/Booked/Not now. Kaden wants future owner tools (post links, digest) to live here.
- Workshops page rework (phone compact rows A, desktop centered cards option 2) also waiting on dev for ship.

Related: [[project-waiver-reminders-oct2026]]
