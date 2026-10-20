### Task 11: Admin screens

**Files:**
- Modify: `src/components/admin/AdminApp.tsx` (tabs: Calendar, Classes, Library, Block time + existing Events/Messages/Teachers)
- Create: `src/components/admin/classes/CalendarView.tsx` (week/month; legacy classes, our classes, parties, café, blocked, closures; tap opens)
- Create: `src/components/admin/classes/ClassEditor.tsx` (one form; collapsible sections Sessions, Passes & prices grid, Ticket types, Questions, Add-ons, Rules; photo upload with crop to 4:3; live card preview using the public card component; Save offers "Just this date" / "Also update the library" when scheduled from the library)
- Create: `src/components/admin/classes/LibraryList.tsx`, `ScheduleDialog.tsx`, `BlockTimeForm.tsx`, `ClassBookings.tsx` (with Refund buttons from Task 12), `PrintDay.tsx` (print stylesheet; rosters, prep counts, waiver status)
- Test: `tests/components/admin/classes/*.test.tsx`

- [ ] **Step 1: Failing tests:** editor validates and shows server errors in place; price grid adds/removes cells; schedule dialog shows clash message; calendar renders each kind with its colour and opens the right panel; block time form; print day lists rosters.
- [ ] **Step 2–4:** run, implement, pass (phone width 400px works; buttons ≥ 44px).
- [ ] **Step 5: Commit** `feat(admin): calendar, class editor, library, block time, print day`.

