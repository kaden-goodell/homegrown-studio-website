---
name: square-class-schedule-create
description: "The undocumented buyer/dashboard endpoint that CREATES an Appointments class schedule (the dated instance the website reads) — closes the gap that Classes were 'UI-only'"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 2c522605-cdf5-44fc-91b1-cd64621dda34
---

Captured 2026-07-08 from the Square dashboard "Create class" flow (Kaden pasted the real curl). This is the WRITE counterpart to the read endpoint in [[square-class-bookings]], and it corrects [[square-admin-api-capabilities]]: class **schedules** ARE creatable via API after all — just not through the official SDK.

## Endpoint
`POST https://app.squareup.com/appointments/api/class-schedules`

## Auth is DASHBOARD SESSION ONLY — the API key does NOT work (verified 2026-07-08)
Tested with a valid body: `Authorization: Bearer <SQUARE_ACCESS_TOKEN>` → **401 UNAUTHORIZED** (`AUTHENTICATION_ERROR`). Only the session cookie authenticates this endpoint. Also: the SDK won't create the underlying `CLASS_TICKET` item at all — `catalog.batchUpsert` rejects `productType: 'CLASS_TICKET'` ("Expected enum"). So class ITEMS must be made via the dashboard too (browser UI, or the `/api/v3/items/process-batch` endpoint with the same session cookie). Net: everything class-related needs the dashboard session, not the API key.

## Auth details (dashboard session)
- Full browser **cookie** from a logged-in `app.squareup.com` session.
- Header `x-csrf-token` **== the `_js_csrf` value inside that cookie** — so parse `_js_csrf=([^;]+)` from the cookie and reuse it; the user only pastes the cookie.
- Also send `x-requested-with: XMLHttpRequest`, `content-type: application/json`, `origin`/`referer` = the dashboard.
- Session expires → 401/403 → user re-pastes a fresh cookie. This is the one non-hands-off part (same tradeoff as any dashboard-session automation).

## Body shape
```json
{"class_schedule":{
  "duration_minutes":60,
  "item_token":"<CLASS_TICKET item id>",
  "item_variation_token":"<that item's variation id>",
  "item_variation_version":<variation.version as number>,
  "location_id":"LTHCH1W1J3Y4Q",
  "rrule":"",                       // "" = one-off; RRULE string = recurring series
  "start_at":"2026-07-09T01:00:00.000Z",   // UTC ISO; convert from America/Chicago
  "status":"CLASS_SCHEDULE_ACTIVE",
  "team_member_id":"TMeIN-kxF-ZVhTVj",     // Kaden Goodell
  "total_capacity":10,
  "class_bookings":[]
}}
```
`item_token`=item.id, `item_variation_token`=item.itemData.variations[0].id, `item_variation_version`=Number(variation.version) — all fetchable via SDK `catalog.object.get`.

## Full "add a workshop" flow (all via API now)
1. SDK `catalog.batchUpsert` to create (or `catalog.list` to find) the CLASS_TICKET item + variation → gives the three tokens.
2. POST above to attach the dated schedule → this is what makes the workshop appear on the site (site reads `class_schedule_instances`).
3. `scripts/upload-workshop-image.ts --role card|flyer` to attach images (see [[square-class-bookings]] flow).

## Implementation
`scripts/create-class.ts`. Session cookie read from gitignored `captures/.square-session` (or `SQUARE_DASHBOARD_COOKIE` env). This is step 1 of the future [[project_admin_site]] — same endpoint will back the admin page.

## UPDATE / reschedule an existing class (found 2026-10-06)
`PUT https://app.squareup.com/appointments/api/class-schedules/<clssch_id>` with the same `{class_schedule:{…}}` body shape (GET the same URL first, change `start_at` etc.). **Delete the empty `resource_id` field before sending** — leaving `resource_id: ""` returns 404 `NOT_FOUND field class_schedule.resource_id`. PATCH/POST on that URL both 404.

**No cookie copying needed:** run the fetch from INSIDE a logged-in app.squareup.com tab via the Chrome `javascript_tool` with `credentials:'include'` + `x-csrf-token` = `_js_csrf` cookie (JS-readable). The HttpOnly session cookie goes along automatically. Kaden signs in himself (never type his password); the Chrome extension does reach app.squareup.com (the old "Chrome blocks Square dashboard" note is stale). The API key still gets 401 on these endpoints.


**Seller-side class bookings, NO payment (found 2026-10-08 by watching the dashboard's "Add attendee" flow, verified by direct call):**
- `POST https://app.squareup.com/appointments/api/class-bookings` body `{"class_booking":{"class_schedule_id":"clssch_…","customer_id":"<Customers API id>","start_at":"<instance start ISO>"},"client_message":{"send_email":false,"send_sms":false,"custom_client_message_body":"","send_custom_client_message_body_to_client":false}}` → 200 `{class_booking:{id:"clsbk_…",status:"CLASS_BOOKING_ACCEPTED",order_id,…}}`. Seat shows "Not yet paid" in the dashboard; "Take payment" is optional. **This is the comp/free-seat path.**
- `POST …/appointments/api/class-bookings/<clsbk_id>/cancel` with the same `client_message` → `CLASS_BOOKING_CANCELED_BY_SELLER`.
- `GET …/appointments/api/class-schedules/<clssch_id>` lists `class_bookings[]` (id, customer_id, order_id, status, refunded). The schedule object has NO name/description — those live on the CLASS_TICKET catalog item, so renames are plain catalog updates (`scripts/update-class-description.ts --name`).
- Same auth as create-class: must run from a signed-in app.squareup.com tab (`credentials:'include'` + `x-csrf-token` = `_js_csrf` cookie); our API key gets 401. A `/staff` "comp a seat" button therefore needs the staff iPad logged into Square, same as the class snippet.
- Dashboard clients are Customers API customers (same id); the Appointments UI creates them via `POST /appointments/api/clients`.

**Session refresh (checked 2026-10-08):** nothing refreshes it. The July `captures/.square-session` cookie is EXPIRED (401). The in-tab way works because Kaden is signed in to Chrome. A server-side "comp a seat" would need a saved Square session on our server plus a way to re-save it when Square signs it out; Kaden wants comps WITHOUT opening Square (10/8), decision on that pending.

**Removing a class session from the calendar (2026-10-09, Fall Embroidery 101 Oct 18):** API attempts fail — PUT status: only CLASS_SCHEDULE_CANCELED is a valid enum but it is silently ignored; DELETE /class-schedules/<id> = 404. What works: Square dashboard → open the session → ⋯ → Edit → Actions → **Cancel class** (confirm says "removed from your calendar… will not affect any attendees" when empty). The CLASS_TICKET item stays (class saved for rescheduling). Site list drops it within ~1 min.

**HIDE / take a dated class off the calendar (found 2026-10-09):** `POST …/appointments/api/class-schedules/<clssch_id>/cancel` with body `{}` (a `client_message` field is REJECTED here) → 200, schedule cancelled, catalog item + photos kept. Scripts (use the saved session in captures/.square-session, no Chrome needed): `scripts/hide-class.ts --workshop clssch_…` and `scripts/move-class.ts --workshop clssch_… --start YYYY-MM-DDTHH:mm` (Chicago time). Both REFUSE a class with bookings. Used 10/9: Fall Earring Bar hidden (waiting on acrylic, maybe a later Friday), Kinusaiga moved to Sat 10/17 7pm.

**Replacing a class photo (10/9):** `upload-workshop-image.ts` APPENDS and the site shows imageIds[0]; the SDK can't upsert CLASS_TICKET items ("Expected enum"), so don't reorder — upload the new one, then `catalog.object.delete` the OLD image object id. Item keeps description; new image becomes the only/first one. Done for Needlepoint 101.
