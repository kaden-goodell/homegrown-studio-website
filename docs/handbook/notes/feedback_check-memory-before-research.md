---
name: feedback_check-memory-before-research
description: Before researching Square (or any) API capabilities, read the existing memory notes and answer from them; don't redo research Kaden already paid for
metadata:
  type: feedback
---
Kaden (2026-10-08): "we've done this research over and over... you should already know this." I re-probed Square's class-booking endpoints and started web-searching class packages when [[square-class-bookings]] and [[square-class-schedule-create]] already held the answer.

**Why:** repeated research burns his time and makes it look like nothing was learned.
**How to apply:** for any "can Square do X" question, read the Square memory notes first and answer from them. Only probe live when the notes leave a specific gap, and name that gap first.

Settled facts (10/8): public buyer endpoint (seat counts, public booking) needs NO login, so nothing to refresh, but it can't confirm a seat without a card or a prepaid class package (422 "Payment source or credit pack must be provided"). A no-card seat = dashboard endpoint only = needs a signed-in Square session.
