---
name: project_email-typo-fix-oct2026
description: Mistyped-email protection on bookings (classes + parties) — rules for what may change a Square profile; dev da673a7, prod pending
metadata:
  type: project
---
Built 10/11 after a customer's mistyped email (dev da673a7, NOT on prod yet — batched with Google Pay 8663f7c + remembered details ca27bfc + Catherine default b024e97).
- "Did you mean …@gmail.com?" under common-domain typos (src/lib/email-typos.ts, ContactFields) — every form.
- You're-booked screen (shared/EmailCheck.tsx): "Wrong email? Fix it" resends the confirmation copy kept as sent (lib/confirmation-copies.ts) via /api/booking/fix-email.json with a signed 24h ticket (lib/email-fix.ts).
- Phone matched a Square record whose email is ≤2 edits off → confirmation sent to BOTH, screen asks "Which one is right?" (Kaden: only super-close ones; wholly different email = a real second address, Square left alone).
- Square profile changes only: the near-identical choice, a record this booking created, or a ≤2-edit correction. Otherwise owners are texted — so typing someone's phone can't hijack their profile.
Verified end-to-end on dev (simulated booking → fix → resent:true; forged ticket refused). Related: [[feedback_never-cancel-bookings]].
