---
name: square-admin-api-capabilities
description: "What can vs cannot be created/managed via Square's API for this account — classes are UI-only, catalog/bookings are API-managed, custom-attr cap is maxed"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 9947dcb9-a61c-453b-b426-dce80ed91617
---

Verified against the production Square account (2026-06-13) while designing the Open Studio / Party model.

**API-manageable (official SDK `client.catalog.*`, `client.bookings.*`):**
- Catalog: items, categories, modifier lists, custom-attribute *values* — full create/read/update/delete via `catalog.batchUpsert` / `batchDelete` (proven). Amounts are `bigint`; `serviceDuration` must be `bigint` too.
- Bookings/Appointments: `bookings.create/cancel/searchAvailability/list` (book a customer appointment against an `APPOINTMENTS_SERVICE` variation).

**NOT API-manageable — Square Appointments UI only (or browser automation):**
- **Classes** (group per-seat sessions, e.g. workshops). No `classes`/`classSchedules` namespace in the SDK. The site only *reads* them via the undocumented buyer endpoint `app.squareup.com/appointments/api/buyer/classes/class_schedule_instances/search` (see [[square-class-bookings]]). Creating Y2K Mom's Night Out etc. was done in the Appointments UI — the API only uploaded their images. **Correction:** earlier session memory claiming the class was "created via API" was wrong.
- **Personal Events** (non-bookable calendar time-blocks) — also UI-only.

**Hard limit hit:** custom-attribute *definitions* are capped at **10 per app_id and ALL 10 ARE USED** (`flow, enrollmentType, ageMin, ageMax, scheduleDays, scheduleTime, totalHours, pricePerHead, maxCapacity, programDates`). Cannot create new ones — reuse existing keys (e.g. Open Studio reuses `flow='display'` + `programDates`).

**Why it matters:** Kaden wants all admin via API ([[feedback_square_via_api]]). Anything modeled as a Class or Personal Event breaks that. Browser automation of `app.squareup.com` is ALSO blocked by the Claude-in-Chrome extension (financial-site safety restriction), so classes must be added by Kaden manually in the UI. Relates to [[offering-model-jun2026]].
