# Task 17 report: sandbox end-to-end suite + real-money checklist

Status: DONE (built, unit tested; the live run is Kaden's, per the brief)
Worktree: /Users/catherine/source/homegrownStudio-admin, branch kaden/admin-d (base d499982). Not pushed.

## Commits
- ccfa89b docs(classes): stage 1 real-money checklist for Kaden
- 5a1caa3 test(e2e): sandbox end-to-end suite for our own classes

(Docs first: a unit test checks the run line is in the checklist.)

## Files
- scripts/sandbox-e2e.ts: entry; header has the exact run line; --only N[,M], --dry-run, --help; exit 0 only when nothing FAILs.
- scripts/lib/sandbox-e2e/core.ts: host allowlist (preview host exactly, https, no userinfo; Square = connect.squareupsandbox.com only), readSecrets (ADMIN_PASSCODE/STAFF_PASSCODE from env only, one-line hint when missing, never echoed), redact, cookie jar, PreviewClient (redirect: manual), SquareSandbox, RateGate (4 bookings/min under the endpoint's 5/min), assertions, Cleanup (LIFO, keeps going), runner (PASS/FAIL/SKIP, a failed cleanup = FAIL), summary table, dry-run plan, Chicago-time helpers, SlotAllocator (5 AM slots 90-300 days out, skipping closed and café days), tax per line.
- scripts/lib/sandbox-e2e/scenarios.ts: 23 scenarios.
- tests/scripts/sandbox-e2e.test.ts: 37 tests, mocked fetch (incl. scenarios 2, 6, 8 run against a fake preview + sandbox; a wrong per-line tax fails scenario 2; main() --dry-run/no-passcode/not-sandbox paths make no booking call and print no passcode; bookingIdOf == bookingIdFor; version == SQUARE_API_VERSION; lineTax == taxCents).
- docs/superpowers/plans/stage1-real-money-checklist.md: A sandbox run, B live setup (4 env vars, webhook with the 6 events, Bring in Square classes dry run), C the spec's 6 real-money tests on hidden $5/$1 classes with expected totals ($7.63, $5.45, $1.09) and what to look at, then clearing up.

## Scenarios
1 library class scheduled, link-only absent then public with "$20 adult · $15 kid"; 2 one price x3; 3 Adult+2 Kids (ticket types); 4 camp full/one-day/choose-2 (+ wrong pick 400); 5 join partway; 6 sold out; 7 concurrent last seat; 8 declined + bad CVV; 9 gift card; 10 refund one seat frees it + goodwill keeps it; 11 POS sale via sandbox order+payment → reconcile → counter seats, replay no duplicate, naming via To decide, pick-the-day flag set; 12 cancel; 13 clashes (blocked, café, party); 14 link-only; 15 capacity below sold; 16 staff comp (+ retry replay) and pay-at-the-counter; 17 Already refunded / Refund again / retry / stale (R30-R31); 18 import dry run shape; 19 closed day via settings, restored in cleanup; 20 To decide below-minimum (seeded by data); 21 variation removal by omission; 22 cancel-hide keeps the full item; 23 create retry (same createKey twice at once, then again) → one class, one item.

Each class: "E2E <run> …", link-only (scenario 1 public for a moment by design), cancelled and library-archived in cleanup. Only 10 and 17 refund (sandbox).

## Verification
- npx vitest run: 297 files, 3867 tests, 0 failures.
- npx tsc --noEmit: 0 errors.
- npx tsx scripts/sandbox-e2e.ts --dry-run: prints the plan, no network. Without passcodes: one-line hint, exit 2.
- Live E2E NOT run (brief: Kaden runs it). Passcodes not fetched.

## Concerns
1. Scenario 5 can't move session 1 into the past: R37 (noPastStarts) refuses it. It schedules session 1 about 2 minutes out and waits; that session is today, so it can clash with anything on the studio's schedule at the moment of the run (café hours, a class), which would show as a FAIL with the clash message.
2. Scenario 13's party clash needs a party booked in the sandbox in the next 6 weeks (read from /api/admin/classes/calendar.json); without one it notes "not checked". Café clash likewise needs a café window in that range.
3. R29 (a different refund refused while one waits on Square) can't be provoked in the sandbox (Square always answers); covered by unit tests only.
4. Scenarios 11 and 22 SKIP without SQUARE_SANDBOX_ACCESS_TOKEN (11 must ring up a sandbox sale; 22 is only about the Square item). The other Square-side checks are skipped with a note. The brief's run line has no token; the checklist says how to add it.
5. Gift card assertion uses card_details.card.card_brand = SQUARE_GIFT_CARD (Square reports gift card payments as source_type CARD); unverified against the sandbox until the run.
6. No /admin button runs the reconcile now (the script POSTs ?force=1 with the admin cookie). Checklist step 11 falls back to the 3 AM run or "ask me".
7. The run sends ~15 confirmation emails (default kaden+e2e@ourhometownstudio.com, override E2E_EMAIL) and owner booking texts; customer phone is Kaden's (402) 980-2907 per his rule. If DEV_BYPASS_PAYMENT is on for the branch, every paid scenario FAILs with a message saying so; if BOOKINGS_OPEN doesn't include workshops on the branch, bookings FAIL with that hint.
8. Scenario 19 writes the preview's studio settings (adds then removes one closed day). If its cleanup fails, the table says so; the closure is named "E2E closure <run>".
No missing APIs: every scenario uses routes that exist.

## Fix round 1 (commit dc2ab0f)
- (1) `onStop` in core.ts: SIGINT (exit 130), SIGTERM (143), uncaughtException / unhandledRejection (1) run the running scenario's pending cleanups LIFO once (the runner points `pending.current` at each scenario's Cleanup and clears it after), sign out, then exit; a failed step says to run --cleanup-only. Handlers are removed when main ends. New `--cleanup-only` (refuses --only; same env-only passcodes, preview-only client, sandbox check first): cancels non-cancelled classes named "E2E …", archives library entries whose latest name starts "E2E ", removes blocked time with reason "E2E block…", and saves settings without closures named "E2E closure…". `--cleanup-only --dry-run` prints that plan with no network.
- (2) Admin and staff sessions are signed out in a `finally` on every exit path (setup failure, not-sandbox, error, normal end) and in the stop handler.
- (3) main catches and redacts "Stopped:"; the top-level fallback also redacts using the env's passcodes/token.
- (4) Checklist: "about 20–25 minutes"; new step 4 "If a run stops part way" (--cleanup-only, what to look at); webhook (now step 5) comes before the live settings (step 6), and the "Send test event" check moved into step 6 after the key is set; later steps renumbered (8–15) with cross-references updated.
- Tests: +6 (signal runs cleanups once LIFO + sign-out + exit 130, secrets redacted; uncaught error exit 1 with --cleanup-only hint; handlers removed; runner sets/clears pending; --cleanup-only --dry-run no network; --cleanup-only touches only E2E items, exact calls) and sign-out asserted on the not-sandbox early exit. 43 in the file.
- npx vitest run: 3873 passed, 0 failed. npx tsc --noEmit: 0 errors.
