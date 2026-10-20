---
name: feedback_never-cancel-bookings
description: "HARD RULE — never cancel, release, refund, or delete a customer's party or workshop booking on my own; that is 100% Kaden's manual step, no exceptions"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 2dcd1843-324d-4cfb-b5af-16c757c96ae5
  modified: 2026-10-07T02:34:46.618Z
---

**NEVER cancel a customer's party or booking.** Not via the Square API, not via the dashboard session in Chrome, not via a script, not "to fix a conflict", not to clean up what looks like a test row unless it is unmistakably my own test row from this session. Same for refunds, seat releases on someone else's booking, and deleting class schedules that have bookings.

**Why:** Kaden, 2026-10-06: "you are NEVER EVER allowed to cancel someone's party or booking on your own. That is a 100% manual step for me to do and NEVER you..."

**How to apply:** When a conflict or mistake needs a booking cancelled or moved (e.g. a workshop lands on a booked party slot), STOP, show him the booking(s) and the options, and let him do it in Square. Code I write must never auto-cancel either: a class/party conflict guard refuses the NEW thing, it never touches the existing booking. Rescheduling a class WITH bookings also needs his explicit go, since it affects paying customers. See [[feedback_admin-actions-are-kadens]].
