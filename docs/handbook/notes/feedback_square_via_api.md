---
name: feedback-square-via-api
description: "Kaden wants ALL Square work done via API, never asks him to use Square admin manually"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 5ced43d0-929a-442d-9103-4625987a7953
---

Do all Square work — workshop CRUD, catalog changes, gift card setup, bookings, deletions, schedule updates — via Square's API yourself. Don't ask the user to log into Square admin to do it manually.

**Why:** Kaden was explicit: "I want you to do ALL the work on the Square stuff going forward. I'm not doing anything at all unless you just can't through their API." (2026-05-25, during workshops-launch PRD)

**How to apply:**
- When a task involves Square data (workshops, catalog items, customers, bookings, gift cards), default to writing/running API calls rather than instructing the user.
- The buyer-facing classes API (see [[square-class-bookings]]) and the v44 catalog API (see [[square-sdk-v44-shapes]]) are both fair game — use whichever fits.
- Only escalate to "you'll need to do this in Square admin" when the API genuinely doesn't support the operation (e.g., some custom-attribute creation, payment dispute handling). When you escalate, say *why* the API can't do it.
- One-shot data operations (bulk delete, bulk create) are still our responsibility — write a small script, don't punt to the user.
