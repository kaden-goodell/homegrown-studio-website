# Task 17 review (d499982..5a1caa3)

Verdict: Approved

Ran: `npx tsx scripts/sandbox-e2e.ts --dry-run` (23 scenarios, no network), `npx vitest run tests/scripts/sandbox-e2e.test.ts` (37 pass), `npx tsc --noEmit` (clean). Live script never run; no passcodes fetched.

## Checked and fine
- All 16 brief scenarios plus the Additions (R29-R31 refund again, comp/door-counter, import dry run, closed-day settings restore, To decide minimum, variation omission, cancel-hide, create retry) are present (23). Each checks the API reply, the ledger via admin bookings.json and, with the token, the Square order/payment. 11 and 22 skip without the token (accepted).
- Host safety: assertAllowed needs https, no userinfo, exact host; PreviewClient builds `new URL(path, PREVIEW_ORIGIN)` so `//evil` and absolute URLs are refused; redirect: 'manual' on both preview and Square calls (a redirect is never followed); Square host is connect.squareupsandbox.com only. The token is sent only there. Tests cover these.
- Secrets: read from env only; missing -> one-line hint with RUN_LINE, no values. Every console/log path goes through redact (ctx.log, scope.note, summary, setup failure, runner details and cleanup errors). Dry-run runs before readSecrets and prints nothing secret. Passcodes are only POSTed to the preview.
- Preview must report sandbox (seed-sandbox GET, a read-only endpoint) before anything is booked.
- Cleanup: runs after every scenario, pass, fail or throw; LIFO so cancel runs before library archive; one failing step doesn't stop the rest; a failed cleanup turns the scenario FAIL. Classes are "E2E <run>" and link-only (scenario 1 public briefly, by design). Refunds only in 10 and 17, sandbox. Scenario 19 restores settings with the saved updatedAt (loud FAIL if it can't); 13 unblocks.
- Run line in script header, RUN_LINE, and checklist step 1 match the brief exactly. Checklist env var names match src (SQUARE_CLASSES_CATEGORY_ID, SQUARE_CLASS_TAX_ID, SQUARE_WEBHOOK_SIGNATURE_KEY, SQUARE_WEBHOOK_URL); the six webhook events are the ones the handler uses; "Webhook received" matches the log text. Six real-money tests (steps 8-13), amounts check out ($7.63 = 5.45+1.09+1.09). Numbered 1-14, plain words, "what to look at" after each step.

## Important
None.

## Minor
- No SIGINT/exit handler: Ctrl-C or a crash mid-run (scenario 5 waits ~2 min) skips cleanup, leaving E2E classes (far-future, link-only) and possibly the "E2E closure" day in studio settings. Neither the script nor the checklist says how to clear up after an aborted run.
- Setup failure (`return 1` in main) and the sandbox-refused path don't sign out the admin/staff sessions.
- Top-level `Stopped:` handler in sandbox-e2e.ts is not passed through redact (low risk: only reachable from unexpected throws that carry no secret).
- Checklist "about 10 minutes" is an estimate; with the 4/min booking gate and ~20 bookings plus scenario 5's wait it may run longer.
- Checklist step 4 refers forward to step 5 for the signature key, so order is 5 then 4's last bullet; fine but slightly confusing.
