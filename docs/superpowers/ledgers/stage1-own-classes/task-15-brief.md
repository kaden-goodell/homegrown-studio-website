### Task 15: Jobs — waiver reminders, sign-up emails, minimum to run, archive

**Files:**
- Modify: `src/lib/waiver-reminders.ts` (our classes: families from confirmed ledger lines; still-booked = line confirmed and not refunded-with-free)
- Modify: `src/pages/api/jobs/signup-emails.json.ts` (our classes open/sold out)
- Create: `src/lib/classes/minimum-to-run.ts` + run inside `daily-warnings` (on `decideByIso` day and the day before: text + email owners "Potholders has 4 of 6 by Thu 5 PM"; never cancels)
- Modify: `netlify/functions/archive-records.ts`, `scripts/archive-records.ts` (add `classes`, `class-library`, `seat-ledger`, `blocked-time`, `seat-choices`)
- Test: extend the matching tests

- [ ] **Steps 1–5** as usual; commit `feat(jobs): reminders, sign-up emails, minimum-to-run alerts and archive cover our classes`.

