# Task 10 report: Admin API (library, scheduling, blocked time, bookings)

Status: DONE. Commit 3fd3afa `feat(admin): class library, scheduling, blocked time and bookings API`.

## Files
- `src/lib/classes/admin-actions.ts` (new): all orchestration, plus `reply()`/`json()` used by the routes. `ADMIN_BY = { id: 'admin', name: 'Owner' }` (the admin cookie has no name). Audit actor `{ ...ADMIN_BY, role: 'owner' }`.
- `src/lib/classes/class-store.ts`: `updateClass` patch now also takes `libraryId` / `libraryVersion` (needed for alsoUpdateLibrary).
- Routes under `src/pages/api/admin/classes/`: `library.json.ts`, `classes.json.ts`, `blocked.json.ts`, `bookings.json.ts`, `photo.json.ts`.
- `tests/api/admin-classes.test.ts` (23 tests, `@vitest-environment node` because jsdom's FormData hangs undici's `request.formData()`).

## API shapes (for Task 11)
- `GET library.json?archived=1` → `{ data: { library: LibraryClass[] } }`
- `POST library.json` `{ action: 'save', id?, content, note }` | `{ action: 'restore', id, version }` | `{ action: 'archive', id, archived? (default true) }` → `{ data: { library } }`
- `GET classes.json?from=&to=` (ISO) → `{ data: { classes, seatsTaken: { [sessionId]: n } } }`
- `POST classes.json`
  - `{ action: 'create', libraryId? , content?, sessions, status? (default draft) }` — with libraryId and no content, the latest library version's content is used; libraryVersion recorded. Sessions without an id get a `ses_` id.
  - `{ action: 'duplicate', id, sessions, status? }` — content copied, every session gets a fresh id, no ledger lines; status defaults to the source's (cancelled source → draft).
  - `{ action: 'update', id, content?, sessions?, status?, alsoUpdateLibrary?, confirmMove? }` → `{ data: { class, peopleToTell? }, warning? }`
  - `{ action: 'cancel', id }` → `{ data: { class, booked: [{ bookingId, name, email, phone, seats, paidCents }] }, warning? }`
- `GET bookings.json?id=` → `{ data: { class, bookings: BookingView[] } }` (bookingId, customer, source, passId, seats per ticket type, sessionIds, picks [{seat, ticketTypeId, answers}], addOns, paidCents (chargedCents ?? sum), refundedCents, refunds, state held|confirmed|refunded|part refunded, overCapacity, lineIds, at). Released lines and lapsed holds left out.
- `GET/POST blocked.json` — GET `?from=&to=`; POST `{ action: 'add', startIso, endIso, reason }` | `{ action: 'remove', id }`.
- `POST photo.json` multipart `file` (jpeg/png/webp, magic bytes checked, ≤ 8 MB) → `{ data: { url } }` absolute `<origin>/api/admin/classes/photo.json?id=<24 hex>`. `GET photo.json?id=` serves it.
- Errors: `{ error }` plain sentence; 400 validation, 401 'Sign in first.', 404 unknown, 409 clash / bookings rule / concurrent save, 503 storage or schedule unreadable. The confirmMove 409 also carries `peopleToTell`.

## Rules implemented
- Clash check (`busyBetween` over the session range + `clashes`, ignoreIds = class id on update) on create, duplicate, and any update touching content or sessions; refusal = `clashMessage`. canShareRoom honoured by `clashes`.
- Edit with bookings: capacity below `seatsTaken` refused naming the session ("Sat Apr 3 5 PM has 4 seats taken. Capacity can't go below 4."); removing a session / pass / price cell with booked seats (confirmed, refunded-kept, or an unexpired hold) refused; price changes allowed (ledger untouched); moving a session with booked people needs `confirmMove: true`, returns peopleToTell `{ name, email, phone, sessions: [old start phrase] }` one per booking.
- A cancelled class can't be updated (409, "Duplicate it to run it again"); status 'cancelled' via update is refused (use cancel).
- Square: open/closed → `syncClassToSquare` then save `square` via `updateClass`; draft → not synced, and if it already has a POS item it is hidden with `archiveClassInSquare` (sync re-shows it when published). Failure keeps our save and returns `warning: "Saved. The POS item didn't update. Try Save again."`. Cancel failure warning: "Cancelled. The POS item didn't come off. Try Cancel again." Cancelling again retries the archive.
- alsoUpdateLibrary: saves a library version (note `Updated while scheduling <Sat Apr 3>`), creating a library entry when the class has none, and points the class at the new libraryId/version.
- Cancel never touches the ledger and makes no Square refund call (tested: ledger unchanged, squareFetch never called).
- Every action audited (`class-library-save/restore/archive/unarchive`, `class-create/duplicate/update/cancel`, `blocked-time-add/remove`, `class-photo-upload`).

## Tests
- `tests/api/admin-classes.test.ts`: 23 pass. Full suite: 255 files, 3192 tests pass. `npx tsc --noEmit -p .` = 0.
- Square catalog, square-api, providers, party-store and audit are mocked; stores are the real fs-backed kv.

## Concerns / judgment calls
1. Photo GET is public (no admin cookie) though it lives under /api/admin: the image is shown on public cards and Square fetches it when uploading. Uploading still needs the cookie.
2. Photo URL is absolute to the uploading origin. A photo uploaded on a preview deploy points at the preview host (its stores are namespaced anyway).
3. Square catalog images accept JPEG/PNG/GIF; a WebP upload to Square may fail. That failure is already only logged in `syncClassToSquare` (the item still saves), so a WebP class may have no POS photo. Task 11's crop could export JPEG to avoid it.
4. Blocked time isn't clash-checked against existing classes/parties (not asked for); owners can block over a booked class.
5. Adding a session to a class that already has 'all' pass bookings doesn't touch those bookings (their sessionIds are fixed); not covered by the brief.
6. Duplicate keeps the source's libraryId/libraryVersion.

## Fix round 1 (commit 93bdb8f)

### Changes
1. Stale saves: `updateClass(id, patch, by, change, { expectedUpdatedAt? })` checks it INSIDE the CAS loop against the freshly read record and throws `StaleClassError` ("Someone else changed this class. Reload to see their changes."). `updatedAt` is now strictly increasing (max(now, last + 1 ms)) so one value names one version even for same-millisecond saves. `update` and `cancel` REQUIRE `expectedUpdatedAt` (missing → 400 "Reload the class and try again."; mismatch → 409, checked up front and again in the CAS). Moves go through `update`, so they are covered. Internal follow-up writes (POS ids, library pointer) don't pass it, because they run after our own save.
2. Move detection and peopleToTell use `holdsSeat` (booked or unexpired hold), so someone mid-checkout counts and is named.
3. alsoUpdateLibrary failing after the class saved → 200 with the saved class and `warning: "Saved. The library didn't update. Try again."` (joined with the POS warning if both fail).
4. Photos: MAX 4 MB ("The photo is too large. It can be up to 4 MB."); GET adds `X-Content-Type-Options: nosniff`.
5. Blocked time (R18): `add` checks `busyBetween` for our class sessions, legacy classes and parties by plain overlap (café/closures/other blocks ignored). It returns 409 `{ error: clashMessage, clashes }` unless `confirm: true`. With confirm it saves and replies `{ data: { blocked, clashes } }`. The reply shape changed from `{ blocked }` to `{ blocked, clashes }`. If the schedule can't be read → 503.

### Tests
- stores.test.ts: + "refuses a save made from an older copy (expectedUpdatedAt)".
- admin-classes.test.ts: test helpers now send `expectedUpdatedAt`; + stale update/cancel refused (missing → 400), held-seat move needs confirm and names the holder, library failure keeps the save with the warning, 4 MB message, nosniff header, block over a class (409 then confirm saves with clashes), block over a party (409), block over nothing (no clashes).

### Command and output
`npx vitest run tests/api/admin-classes.test.ts tests/lib/classes/stores.test.ts` → 2 files, 40 tests passed.
`npx tsc --noEmit -p .` → exit 0.
`npx vitest run` → 255 files, 3199 tests passed.
