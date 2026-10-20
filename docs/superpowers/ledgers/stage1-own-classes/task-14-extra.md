# Task 14 additions (from the full audit, audit-2026-10-19.md)
- B1: /waiver?workshop=cls_… and /api/waiver/sign.json must resolve our classes (events.ts getEvent('workshop', cls_…) → our class as a StudioEvent); print-day waiver status then fills in. Test: a cls_ waiver link renders and a signature files under ('workshop', cls_id).
- I1: /staff refund button (crew, reason required, logged with crew name) using /api/staff/class-refund.json and the shared RefundPanel.
- I2: /staff warnings show refund flags, unmatched POS sales and pos-needs-days (read-only for crew; decisions are on /admin › Inbox › To decide).
- I7 ruling R28: when a class does NOT allow joining partway, ALL passes (including choose-N and single-day) close at the first session's start minus cutoff. Update pricing.ts + tests.
- M6: the confirmation email's calendar invite covers every session (one VEVENT per session).
- M7: /classes/<id> pages for open, non-link-only classes go in sitemap.xml.
- M8: editing content only (not sessions) never re-checks clashes on sessions that already ended.
- From Task 13 reviews: (a) flag a half-finished "It went through" (money saved, request not marked done) in the nightly check/to-decide; (b) RefundPanel: when an "Already refunded" reply's latest.requestId is the repeat's own id, show "Refunded $X." and call onDone (refresh); (c) bind the "Refund again" request id to inputHash (refuse a reused {of, token} with a different amount/seats); (d) /staff refund UI must use again:{of, token} (one token per "Already refunded" answer, reused across retries) and the "I checked Square" actions (went through / didn't go through, crew reason required).
