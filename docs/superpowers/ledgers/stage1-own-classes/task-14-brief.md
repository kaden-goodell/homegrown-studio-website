### Task 14: Staff console on the new ledger

**Files:**
- Modify: `src/lib/events.ts` (our classes become `StudioEvent`s: id = class id, days = session dates, seats/capacity from ledger per session; legacy kept)
- Modify: `src/pages/api/staff/roster.json.ts` (bookings from ledger for our classes; counter sales show as "Counter sale, no name yet"; names filled from waiver at check-in via `setNames`)
- Modify: `src/pages/api/staff/comp-seat.json.ts` (for our classes: `hold`+`confirm` with source comp/door-counter, no Square dashboard; door-card path opens the class checkout on the iPad)
- Modify: `src/components/staff/CompSeatSheet.tsx` (for our classes: pass/ticket/session pickers; "Pay on the iPad" opens `ClassBookingPanel` in door mode with `source: 'door-card'`)
- Create: `src/components/staff/StaffCalendar.tsx` (read-only version of the admin calendar) + a "Calendar" entry on /staff nav
- Modify: `src/lib/warnings.ts` (our classes: oversold shows "41 of 40", minimum-to-run short, unmatched POS sales, refund flags)
- Test: extend `tests/api/staff-*.test.ts`, `tests/lib/events.test.ts`, `tests/lib/warnings*.test.ts`

- [ ] **Step 1: Failing tests** for each modified behaviour, including a multi-day class showing on each of its days in This week with that day's seats.
- [ ] **Step 2–4:** run, implement, pass.
- [ ] **Step 5: Commit** `feat(staff): staff console reads and writes the class seat ledger`.

