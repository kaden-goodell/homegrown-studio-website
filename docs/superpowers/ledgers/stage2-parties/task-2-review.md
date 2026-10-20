# Task 2 review — shared refund runner (commit 4e27d42)

Verdict: **Approved** (no Critical/Important defects in the moved behaviour). Two Important items are design hardening to do before / in Task 10, not fixes to this commit.

## Verification
- `npx vitest run tests/api/class-refund.test.ts tests/lib/classes tests/lib/booking-core tests/components/shared` → 27 files / 489 tests pass.
- `tests/api/admin-classes.test.ts`, SettingsSheets, PrivateEventForm → 79 pass. `npx tsc --noEmit` → exit 0.
- `git show --stat 4e27d42 -- tests/api tests/lib/classes tests/components/shared` is empty: the pinned class tests are unedited.

## Line-by-line: old refundClassBooking / claimSquareRefund / clearRefundRequest vs runner + classRefundBook
| Item | Result |
|---|---|
| inputHash | `inputHashOf(cls.id, req)`; book built with `classId = cls.id`, same args. Same. |
| tokenId / request id | `hashOf('refund-again', classId, bookingId, of, token, inputHash)` / `hashOf('refund-attempt', inputHash, attempt)`; fallback id `hashOf('refund-attempt', inputHash, randomUUID())`. Same. |
| Idempotency key | `refundKey(bookingId, plan.lines ids, totalCents, prior, failures)` at save; `failures + 1` on FAILED/REJECTED. Same args, same order; planRefund/refundKeyRaw/priorRefunds untouched. **No double-refund risk from key drift.** |
| Saved request before Square | saveRefundRequest (seen/againOf) before `refundPayment`; waiting/changed/stale/done-replay branches identical. |
| Same ask matches forever | exact token → sameAsk unfinished → doneAsks latest → "Already refunded"; identical. |
| again {of, token} | retired+again → SAVED_SPLIT_NO_LONGER_FITS; stale `of` → AGAIN_IS_STALE; identical. |
| Turned-down resend | stillFits (same ledger check) → retire + 409, else resendRefundRequest; identical. |
| No answer | 502 SQUARE_NO_ANSWER, nothing changed, same key; log line text identical (`[classes/refund]` via logTag). |
| Write fails after Square | 500 same text; markRequestSent happened first so a retry only writes. Same. |
| Done / afterWrite / email / audit order | run: done → afterWrite(freeSeat) → email → audit-if-first (audit still uncaught as before); webhook: write → done → audit → afterWrite → email; check: done → afterWrite-if-first → email → audit+check-if-first. Same. |
| One email per request (R30) | canEmail before claimRequestEmail, claim winner sends, release on false/throw, loser reads emailedAt. Same. |
| "I checked Square" | claim via changeRefundRequest + isWaiting; went-through write failure restores pending; replies `{status:'turned-down',lines:[]}` / `{status:'done',lines}` unchanged; audit `class-refund-checked` fields unchanged. |
| Caps, register-only refusal (m7 AT_THE_REGISTER), SQUARE_REFUND_CAP, bookingCap | in planRefund, untouched. |
| refund-unfinished / refund-unconfirmed flags | square-events/to-decide unchanged; they read the same saved-request store (format unchanged). |
| Webhook claim | matching identical; book resolved via refundBookFor (always a class book for a non-'party' scope; getClass errors swallowed). |
| Message strings | none changed (all still defined in classes/refunds). |

Differences found (all harmless):
1. Webhook label: was `b.label` (ctx class name) falling back to `getClass`; now always `getClass(...).catch(() => null)`. Same value normally; if the class read fails, the email says class name '' where before it used ctx's name (before, a getClass throw after the write would have thrown out of the claim — so now strictly safer). Minor: pass `b.label` through as a label hint.
2. `claimSquareRefund` on an already-done request now does one extra getClass read. Harmless.
3. `clearRequest` also returns `emailed`; adapter ignores it.
4. An empty class name now audits with label = classId (was ''). Cosmetic.

## Concerns judged

### Circular import runner ↔ classes/refunds — safe today; Important to break before Task 10 (cheap)
Safe now: neither module touches the other's bindings at top level (runner uses RefundError/messages/refundKey/classRefundBook only inside functions; refunds.ts only does `export { claimSquareRefund }`, a live re-export). ESM live bindings, Vite/Rollup SSR bundling and vitest all handle that; tests pass. Fragile because:
- `square-events.test.ts` does `vi.mock('@lib/classes/refunds', async (orig) => ({ ...await orig(), onSeatFreed }))` — the runner now imports the *mocked* module. Works only because the factory spreads `orig`. Any future test that mocks `@lib/classes/refunds` with a bare factory silently breaks the runner (RefundError undefined → `instanceof` throws).
- Task 10 adds a top-level `registerRefundScope(...)` in parties/refunds, plus `class X extends RefundError`-style code is one edit away from a TDZ crash depending on entry order.
Cheap fix (recommend in the fix wave or as Task 10's first step): move `RefundError`, the shared message constants, `refundKey`/`refundKeyRaw`, `RefundPlan` into `src/lib/booking-core/refund-words.ts` (runner imports from there; classes/refunds re-exports them so no test edits), and stop the runner importing `classRefundBook` by moving the registry out (next item). Then the runner depends on nothing in classes except refund-requests.

### 'party' scope registration — Important for Task 10; propose explicit registry now
Side-effect registration means: if `parties/refunds.ts` isn't in the webhook's module graph, `refundBookFor({classId:'party'})` returns null, `claimSquareRefund` returns false and the caller records Square's refund as plain party money **while our saved request stays pending**. Later "It went through" writes the same money again with `squareRefundId: null` → **recorded twice** (no money moved twice, but books show double and refundableOn under-reports; the R29 block also lingers until someone clears it). Returning false never loses money (hard rule 3 holds) but breaks "recorded once".
Safer design:
- New `src/lib/booking-core/refund-books.ts`: static `refundBookFor(scope)` = `scope.classId === 'party' ? partyRefundBook(...) : classRefundBook(...)` with both imported explicitly, and `claimSquareRefund` living there (it is the only runner function that needs scope → book). No `registerRefundScope`, no import-order dependence. square-events imports `claimSquareRefund` from refund-books directly (classes/refunds must NOT re-export it from there, or the cycle returns) — note square-events.test is pinned unedited only for Task 2; Task 10 already edits it.
- Until parties exist, `refundBookFor` for an unknown/unregistered 'party' scope should **throw** rather than return false, so a wiring miss surfaces (webhook 5xx → Square retry / nightly catch-up) instead of silently double-recording. If returning false is kept, Task 10 needs a test that the production webhook import graph claims a party request (not just a unit test that imports parties/refunds itself).
Do it: the registry module + throw in Task 10 (parties/refunds doesn't exist yet); the refund-words split can be done now.

### Test-query replacement (SettingsSheets, PrivateEventForm) — Minor, acceptable with one tweak
The diagnosis (whole-document `getByRole` name computation polled by findBy) is right and the HoursForm effect-race fix (`act` flush) is a real find. Coverage loss: the helpers check `fieldset > legend` / `aria-label` / textContent, not the computed accessible name — they would pass a button whose name comes only from aria-hidden text or miss aria-labelledby, and don't exclude hidden elements. These files are behaviour tests, not a11y tests, and `<button>`/`<fieldset><legend>` are the semantic elements, so the loss is small. Recommend keeping one real role assertion per distinct accessible thing where it documents accessibility, scoped to the sheet/form container (fast — the cost was the whole page): e.g. in each file's first test `within(container).getByRole('group', { name: 'Saturdays' })`, `getByRole('button', { name: 'Save café hours' })`, `getByRole('group', { name: /Where is it/ })`; keep the cheap helpers for repeated interaction lookups.

## Minors
- Webhook label: pass `b.label` into the book (or as fallback) to keep the old precedence exactly.
- `RefundBook.kind` is `string` and `inputHash` is `''` for scope-only books; `plan()` on such a book throws 400 'Pick what to refund.' — fine, but a comment on `refundBookFor` that its books are write-side only would stop Task 10 calling `runRefund` with one.
- `clearRequest` validates `outcome` twice (adapter + runner); harmless.
- The brief's interface grew (kind, logTag, unreachable, current, describe, canEmail, auditCheck); all justified by verbatim moves. Task 10's party book must implement all of them — the plan's Task 10 file list should say so.
