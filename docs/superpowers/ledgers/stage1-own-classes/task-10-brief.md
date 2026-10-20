### Task 10: Admin API — library, scheduling, blocked time, bookings

**Files:**
- Create: `src/pages/api/admin/classes/library.json.ts` (GET list; POST save version {id?, content, note}; POST restore {id, version}; POST archive)
- Create: `src/pages/api/admin/classes/classes.json.ts` (GET range; POST create {from library or content, sessions, status}; POST duplicate {id, sessions}; POST update {id, content?, sessions?, status?, alsoUpdateLibrary?}; POST cancel {id})
- Create: `src/pages/api/admin/classes/blocked.json.ts`
- Create: `src/pages/api/admin/classes/bookings.json.ts` (GET by class: ledger lines grouped by booking)
- Create: `src/pages/api/admin/classes/photo.json.ts` (multipart upload → stored image; returns URL; reuse the approach in `src/pages/api/admin/application-photo.ts`)
- Create: `src/lib/classes/admin-actions.ts` (pure-ish orchestration so routes stay thin)
- Test: `tests/api/admin-classes.test.ts`

Rules: every route `adminAuthorized(request)` (owners). Create/update/move run `clashes()` and refuse with `clashMessage`. **Edit with bookings:** refuse lowering a session's capacity below seats taken; refuse removing a session or pass or price cell that has confirmed seats; price changes allowed but only affect new bookings (ledger keeps paid prices); changing session times with bookings requires `confirmMove: true` and returns the list of people to tell. After every create/update, `syncClassToSquare` and save returned ids; a Square failure keeps our change and returns a warning ("Saved. The POS item didn't update; try Save again."). Cancel sets status cancelled, archives the Square item, returns everyone booked, never refunds. Audit every action with `recordAudit`.

- [ ] **Step 1: Failing tests** for auth, each action, clash refusal, edit-with-bookings rules, duplicate copies content and new sessions with no bookings, alsoUpdateLibrary appends a version, cancel never calls refund.
- [ ] **Step 2–4:** run, implement, pass.
- [ ] **Step 5: Commit** `feat(admin): class library, scheduling, blocked time and bookings API`.

