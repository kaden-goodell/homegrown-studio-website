# SDD ledger — plan: docs/superpowers/plans/2026-10-18-stage1-own-classes.md

Spec: docs/superpowers/specs/2026-10-18-own-booking-system-design.md (reachable). Worktree: /Users/catherine/source/homegrownStudio-booking (branch kaden/own-booking-system). Main checkout on dev for live fixes.

## Preflight scan
| Pair / task | Produces → consumes | Finding |
|---|---|---|
| T1 → T2,T3,T4,T6,T9,T10 | types.ts ClassContent/ScheduledClass/Session/Pass/TicketType; validate Result | consistent names |
| T2 → T4,T8,T9 | quote(): Quote{sessionIds,seats,lines(variationKey)} | T4 hold consumes Quote; ok |
| T3 → T5,T8,T10,T14 | listClasses/getClass/updateClass, blocked-time | ok |
| T4 → T8,T12,T13,T14,T15 | hold/confirm/release/recordRefund/setNames, seatsTaken | T4 `hold` input lists "answers/addOns per seat" loosely → Ruling R1 |
| T5 → T10,T11 | busyBetween/clashes/clashMessage | T5 modifies party-availability; T14 events.ts separate; ok |
| T6 → T8,T10,T13 | syncClassToSquare returns square ids; classIdFromVariation | variation keys `${passId}:${ticketTypeId}` and `addon:${id}` match T2 variationKey; ok |
| T7 → T8 | createClassOrder | ok |
| T8 → T9,T14,T17 | /api/classes/book.json body | T9 lists body fields; ok |
| T10 → T11 | admin routes | ok |
| T12 → T11 | refund API used by ClassBookings | T11 says Refund buttons "from Task 12" but T11 runs before T12 → Ruling R2 |
| T13 → T14 | unmatched-pos, refund-flags kv | ok |
| Each task self-consistency | tests vs files | T6 config env names new; T9 file list consistent; T17 needs preview deploy + passcodes |

## Rulings
- Ruling R1: T4 `hold` per-seat input shape = `seats: { answers: Record<string,string>; addOns: Record<string,number> }[]` aligned with BookingRequest.seats — the plan elided it — cost if wrong: a rename in T8.
- Ruling R2: Run T12 (refunds API) before T11 (admin screens), so T11 can wire Refund buttons to a real endpoint — order swap only — cost if wrong: none.
- Ruling R3: Implementers work in the worktree path above; never push to dev/main; push only the branch.

Task 1: dispatched (BASE e552888)
- Ruling R4: Kaden bumped the Square app API version (prod + sandbox) to latest on 2026-10-18. New code uses ONE constant SQUARE_API_VERSION (src/lib/classes/square-api.ts, value = latest dated version confirmed against sandbox in Task 6) for every raw REST call; existing legacy calls keep '2025-01-23' untouched (live behaviour unchanged). Webhook handlers (Task 13) parse the latest payload format — cost if wrong: a field rename caught by sandbox E2E.
Task 1: review → Needs fixes (1 Important: session/decideBy times not normalised to UTC ISO)
Task 1: minor (deferred): booleans coerced with !! ("false"→true) in validate.ts rules
Task 1: minor (deferred): fixed-pass sessionIds not de-duplicated / not checked against real sessions (later task)
Task 1: minor (deferred): question choices not de-duped; no length cap on description/ages; imageUrl not URL-checked
Task 1: minor (deferred): untested bounds — signupCutoffHours, waitlistCutoffHours, minimumToRun, maxPerSeat, defaultMinutes
- Ruling R5: Kaden asked to watch progress; push the BRANCH (its sandbox preview) after each task's review is clean — never dev — cost if wrong: none.
Task 1: fix round 1/5 (1 addressed, 0 open; commits 2a673af..df5229a)
Task 1: complete (commits e552888..df5229a, review clean)
Task 2: dispatched (BASE df5229a)
Task 2: review → Needs fixes (1 Important: add-on qty>1 collapsed into one line; Square gets qty-1 lines → total mismatch)
Task 2: minor (deferred): fixed pass silently drops unknown sessionIds (should refuse)
Task 2: minor (deferred): add-ons supplied for a class with none are dropped, not refused
Task 2: minor (deferred): no tests for mixed ticket types with answers, or non-integer/negative counts
Task 2: fix round 1/5 (1 addressed, 0 open; commits 1d0c9d8..654fbe6)
Task 2: complete (commits df5229a..654fbe6, review clean)
Task 3: dispatched (BASE 654fbe6)
Task 3: minor (deferred): CAS retry test doesn't model a competing write (fs backend can't race); library mutate + removeBlocked retries untested
Task 3: minor (deferred): updateClass doesn't validate status/square and overwrites square wholesale
Task 3: minor (deferred): list* JSON.parse without try/catch (one corrupt record breaks listing)
Task 3: minor (deferred): archiveLibrary records no audit (no history field)
Task 3: complete (commits 654fbe6..b2b213f, review clean)
Task 4: dispatched (BASE b2b213f)
- Ruling R6: confirm() must never throw for a booking whose payment succeeded — if its hold expired/was swept/released, re-create the lines as confirmed (allowOverCapacity) and mark them `overCapacity: true` (shown as "41 of 40" + warning) — money taken always means a seat recorded; never auto-refund — cost if wrong: an occasional oversold seat the owners see and handle.
- Ruling R7: recordRefund `cents` is per listed seat (implementer's reading) — Task 12 must pass per-seat amounts — cost if wrong: a refund helper rename.
- Ruling R8: one hold per bookingId (retries can't double-book); adding seats later = new booking id — cost if wrong: none for stage 1.
- Ruling R9: in-process per-class lock added on top of CAS is acceptable (protects fs/dev; CAS protects across servers).
Task 4: review → Needs fixes (1 Important: repeat confirm after refund resurrects seats)
Task 4: minor (deferred): recordRefund uses new Date() not injected now
Task 4: minor (deferred): passId from caller not derived from quote / not asserted
Task 4: minor (deferred): confirm fallback doesn't check fallback.cls.id === classId
Task 4: minor (deferred): no timeout on kv inside per-class lock
Task 4: minor (deferred): answers copied from raw input (callers must validate via quote())
Task 4: fix round 1/5 (2 addressed, 0 open; commits ae25643..726f683)
Task 4: complete (commits b2b213f..726f683, review clean)
Task 5: dispatched (BASE 726f683)
- Ruling R10: party pre-charge re-check keeps its existing "book anyway if the check errors" rule in stage 1 (party booking is rewritten in stage 2, where it fails closed) — cost if wrong: during a blob-store outage a party could be booked over one of our classes (owners see it in warnings).
- Ruling R11: blocked time keeps the 60-min party buffer in the party picker (more conservative than clashes()) — cost: a few fewer party times next to blocked time.
Task 5: review → Approved with 1 Important (sequential kv reads in listClasses/listBlocked on the public party path) — entering fix loop
Task 5: minor (deferred): daysBetween silently caps at 400 days (should throw)
Task 5: minor (deferred): partyBusy unbounded parallel getPartyRecord fan-out (matches class-guard)
Task 5: fix round 1/5 (3 addressed, 0 open; commits 489f99f..dc45733)
Task 5: complete (commits 726f683..dc45733, review clean)
- Ruling R12: sandbox seeding runs as an admin-only API route on the preview (uses the branch's sandbox token; refuses unless SQUARE_ENVIRONMENT=sandbox) instead of a local script — no sandbox secret ever needed locally — cost if wrong: none.
- Ruling R13: SQUARE_API_VERSION constant = the Square-Version string the installed square SDK sends (read from node_modules/square) so it is guaranteed valid; bump with the SDK — cost if wrong: one constant.
  R13 value: SQUARE_API_VERSION = '2026-01-22' (the version square SDK 44 sends on every live call today)
Task 6: dispatched (BASE dc45733)
- Sandbox checks owed (Task 17 E2E must cover): variation removal by omission in item upsert; cancel-hide by re-sending the full read object; create retry idempotency.
Task 6: review → Needs fixes (1 Important: create retries not idempotent → duplicate POS item)
Task 6: minor (deferred): archiveClassInSquare re-sends read-only fields (sandbox check in Task 17)
Task 6: minor (deferred): uploadImage doesn't skip non JPEG/PNG/GIF; meaningless 'card' caption
Task 6: minor (deferred): seed route matches tax by name only (doesn't check 9%)
Task 6: fix round 1/5 (4 addressed, 0 open; commits 093cefd..4b84bf8)
Task 6: complete (commits dc45733..4b84bf8, review clean)
Task 7: dispatched (BASE 4b84bf8)
- Note for stage 4 (promo codes): Square applies ORDER discounts before tax, apportioned across lines — quote() must model that exactly (sandbox-verify) before promo codes ship.
Task 7: review → Needs fixes (1 Important: line mapping assumes Square's response order; empty/malformed response not refused)
Task 7: minor (deferred): with an order discount, line totals vs total semantics differ; mock doesn't apportion discount (stage 4)
Task 7: fix round 1/5 (1 addressed, 0 open; commits d2e3e03..6f3b535)
Task 7: complete (commits 4b84bf8..6f3b535, review clean)
Task 8: dispatched (BASE 6f3b535)
- Ruling R14 (OWNER DECISION, Kaden 2026-10-18 "not charging based on a cent is a no-go"): source of truth — prices = our class record (synced to Square on save); amount charged = Square's order total. Charge when Square ≤ quote or ≤ quote + $1 (email owners on any upward drift); refuse only when Square > quote + $1 (text owners). Threshold PRICE_DRIFT_TOLERANCE_CENTS = 100.
- Note for Task 9: the panel must make a NEW attemptId after any definite failure (decline, sold out, not_open, price refused) and treat 409 'in_progress' as a known outcome.
- Note: verificationToken (SCA) accepted but not passed to processPayment (parties don't either) — deferred minor; revisit if a card needing verification fails in sandbox/real test.
Task 8: review → Needs fixes (1 Important: unknown-outcome hold expires in 10 min → retry says "Nothing was charged" and seats resold)
Task 8: minor (deferred): reportBooking amountCents = pre-tax quote subtotal (confirm matches workshops)
Task 8: minor (deferred): verificationToken not passed to processPayment
- Ruling R15: unknown-outcome / paid-but-unrecorded → extend that booking's hold for 24 h (ledger extendHold) AND on a retry that finds no lines or sold out, re-create the order with the same idempotency key + findOrderPayment; paid → confirm and 200. Also store the charged amount on confirm.
- Ruling R16 (OWNER OK 2026-10-18): Stage 4 adds 'Charge on the reader' to /staff door sales via Square Point of Sale API (web → POS app with amount+note, callback returns transaction id → seat marked paid, linked). Needs Kaden to register the /staff callback URL in the Square app. Sandbox-test.
- Done 2026-10-18: POS API web callback URLs registered (production): https://ourhometownstudio.com/staff/pos-return and https://kaden-own-booking-system--iridescent-croissant-494fc3.netlify.app/staff/pos-return. POS API is NOT supported in sandbox → stage 4 feature gets a real $1 test. Webhook subscriptions to be created at Task 13 (sandbox → preview), Kaden copies the signing key.
Task 8: fix round 1/5 (6 addressed, 0 open; commits db63752..afdce99)
- Ruling R17: accepted implementer deviation — no paid-check on "no lines" first attempts (cost: a Square order+lookup on every booking otherwise); covered by idempotency-key-reused → findOrderPayment path — cost if wrong: a rare retry answered card_declined without asking Square first.
Task 8: minor (deferred): call findOrderPayment before replying card_declined (cheap guard)
Task 8: minor (deferred): concurrent duplicate finish → two confirmation emails/owner messages
Task 8: minor (deferred): no tests for order-create IDEMPOTENCY_KEY_REUSED and sold_out "Square unreachable" message
Task 8: minor (deferred): every genuine sold-out leaves an unpaid open Square order
Task 8: complete (commits 6f3b535..afdce99, review clean)
Task 9: dispatched (BASE afdce99)
Task 9: review → Needs fixes (1 Important: stale seats-left after sold-out reply)
Task 9: minor (deferred): analytics item price = lowest price
Task 9: minor (deferred): sr-only counter text recipe incomplete
Task 9: fix round 1/5 (6 addressed, 0 open; commits 8b55603..5b2be81)
Task 9: minor (deferred): if the picked day fills while on the pay step, Pay stays disabled with no explanation
Task 9: complete (commits afdce99..5b2be81, review clean)
Task 10: dispatched (BASE 5b2be81)
- Ruling R2 REVISED: run Task 11 (admin screens) BEFORE Task 12 so Kaden can see something; Task 12 adds the Refund buttons to ClassBookings afterwards. CHECKPOINT after Task 11: push, then give Kaden a hands-on list (log in to preview /admin → Set up sandbox → create class → book with sandbox card 4111 1111 1111 1111).
- Ruling R18: blocking time over an existing class/party must warn: 409 listing the clashes unless `confirm: true` (blocking is owner intent, but never silent) — goes into Task 10's fix round.
- Ruling R19: Task 11 crop saves JPEG so Square accepts class photos.
Task 10: review → Needs fixes (1 Important: stale-form save overwrites another owner's edits)
Task 10: minor (deferred): edit checks vs write not atomic (ms window; overCapacity covers)
Task 10: fix round 1/5 (5 addressed, 0 open; commits 3fd3afa..93bdb8f)
Task 10: minor (deferred): monotonic updatedAt would RangeError on an unparseable stored updatedAt
Task 10: complete (commits 5b2be81..93bdb8f, review clean)
Task 11: dispatched (BASE 93bdb8f)
- Ruling R20: pushed Task 11 to the branch preview BEFORE its review finished so Kaden can look at the checkpoint (preview only; fixes follow) — cost if wrong: he may see a bug the review fixes.
- Done: sandbox seeded (category 27VGIAHD4S5BJNVUKKLRMTZK, tax MJIXGHJ5666SZWZDU4MBA4P7), env set on branch, redeployed.
Task 11: review → Needs fixes (3 Important: maxPerBooking NaN lock; Detail keeps confirm across items (one-tap delete); phone detail off-screen)
- Carry to Task 14: /waiver?workshop=cls_… fails — getEvent('workshop', id) only knows Square workshops; our confirmation emails link there. events.ts must resolve cls_ ids (and waivers file under ('workshop', cls_id)) so print-day waiver status works.
Task 11: minor (deferred): day.json lacks an unauthenticated-refusal test (if not fixed in round 1)
- Found live 2026-10-19: preview calendar/schedule fail — legacy Square Classes buyer API is production-only (422 No matching location) → busyBetween fails closed. Fix (in Task 11 round 1): sandbox → legacy workshop provider returns empty.
- R20 again: pushed Task 11 fix round to preview before re-review (Kaden waiting).
Task 11: fix round 1/5 (10 addressed, 0 open; commits a5581fc..eb307ef)
Task 11: complete (commits 93bdb8f..eb307ef, review clean)
Hotfix (owner report): ages label on our class cards → commit 6cb7458; pushed before review (R20).
Hotfix ages label: review clean (eb307ef..6cb7458).
Task 12: dispatched (BASE 6cb7458)
- Found live 2026-10-19 (owner): public /calendar on preview 'incomplete' (sandbox lacks live-only café/party catalog items) AND it never showed our own classes (gap not in plan). Hotfix dispatched before Task 12.
Hotfix public calendar → 9623c23 (pushed before review, R20)
Hotfix public calendar verified live on preview (complete; our class shows).
- OWNER FEEDBACK 2026-10-19: "the entire Admin UI/UX sucks"; "a new class isn't added to the library — I shouldn't have to think about it". Ruling R21: every new class auto-creates/links a library entry; admin redesign → UX review (widened to all of /admin) → 3 clickable mock-up directions (A one home screen, B calendar first, C like /staff) as an artifact → Kaden picks → one rebuild pass (new task 11b). Task 12 (refunds, API-first) proceeds in parallel; its UI buttons attach to whichever layout wins.
- LIVE change 2026-10-19 (deploy 18, 8488b49): Thanksgiving closure now Thu–Fri only (Nov 26–27); café windows rewritten in Square (Nov 28 added). Branch must merge dev before stage-1 E2E to pick up closures.ts + tests.
- Ruling R22: one-session refunds default "free seat" OFF (freeing frees the whole pass line); whole/one-person default ON.
- Ruling R23: add "Free their seat" with no money (e.g. kept-seat refund later, or a no-show swap) as its own confirmed action, audited.
- Ruling R24: refund.updated FAILED handling belongs to Task 13 (flag on /admin, never auto-undo).
Task 12: review → Needs fixes (Important: R22 missing, R23 missing, 502 text could prompt a manual double refund)
- Note: tests/lib/events.test.ts has 3 clock-dependent failures since Oct 19 (pre-existing; fail with Task 12 stashed) → fix in Task 14 (it owns events.ts).
Task 12: fix round 1/5 (6 addressed, 2 new Important open — per-booking failure count can change a retry's key; capped whole-booking refund drops 0-cent seats so they stay held; commits fd5db1b..50399cf)
Task 12: minor (deferred): panel preview not capped for one person/one session; free-seat-only shows as "refunded $0"; concurrent free-seat double 0-cent entries; swallowed failure-count write
Task 12: fix round 2/5 (3 addressed, 0 open; commits 50399cf..507c156)
Task 12: minor (deferred): refundFailures map never pruned (small in practice)
Task 12: complete (commits 9623c23..507c156, review clean)
Task 13: dispatched (BASE 507c156)
- Ruling R25: nightly reconcile must also catch missed refunds via the documented ListPaymentRefunds (GET /v2/refunds, begin_time = now−48h, location) using the same refund handler (idempotent by squareRefundId).
- Ruling R26: a plain amount refund made in Square is recorded in the ledger immediately as money (freeSeat false, spread over the booking's lines in seat order like a custom refund, with its squareRefundId) so caps stay right; only the SEAT decision goes to refund-flags.
- Ruling R27: Task 14 owns resolving flags (free seat via freeSeatOnly) and a setter for pos-needs-days.
Task 13: review → Needs fixes (Important: per-order catalog call can time out reconcile; R25 missing; R26 missing)
Task 13: minor (deferred): plain-refund flag only against first class when a payment spans classes
Task 13: minor (deferred): unmatched-pos / pos-needs-days never pruned; linesForPayment scans all ledgers
- 2026-10-19 Kaden: 'slow' — stopped the Task 13 fix-round agent mid-round to focus on mock-up D; resume Task 13 fix round 1 later (check worktree for uncommitted changes first).
- ADMIN REDESIGN STATE (pre-compaction): Kaden chose "your best of all" = D: A's Home inside a 5-tab bar (Home · Calendar · Classes · Inbox · More); Home = Today/This week/Needs you (incl. To decide: POS to match, Square refunds to decide, below-minimum)/+ New class, + Book a party, Block time; Calendar = B's week/month with + per day; Classes = Upcoming/Drafts/Past/Library; Inbox = Requests/Messages/Teachers/To decide; More = Parties setup, Hours & Craft Café (screen), Closed days (screen), Staff (stage 3), Promotions (stage 4), Reports. One sheet deep max. iPad: sidebar tabs, two-column Home, week grid, right-side panel. Mock-up: https://claude.ai/artifact/Pu123yENkG5pLdcaa2AzyN (file scratchpad/admin-directions.html). Awaiting Kaden's final OK on D → then new Task 11b "Admin rebuild to D" (+ Hours & Café and Closed days screens, library auto-add) after Task 13.
- Task 13 fix round 1 in progress (agent a37b279…): perf cache/batch, R25 refunds reconcile, R26 record Square plain refunds as money, split tenders, ?force=1, drop event.data from notification.
- OWNER APPROVED D (2026-10-19 'D looks great. Go on it!!!!'). Task 11b brief written (task-11b-brief.md). Dispatch after Task 13 fix round lands (avoid two agents committing in one worktree).
- 2026-10-19 Kaden: FULL AUTONOMY for all remaining tasks + stages; 'completely tested', fix every UI/UX quirk, 'smoking hot and easy to use'. Order: full audit → T13 fix → 11b-A shell/Home/Calendar/Inbox/More → 11b-B Classes+sheets+library auto-add → 11b-C Hours/Closed days stores + To decide → T14 → T15 → T16 → T17 E2E → final review → stage 2 plan…
- 2026-10-19 Kaden: finish ALL STAGES (1–4), 'excellent and production level/priority'. Briefs written: task-13-fix1, task-11b-common/A/B/C (mock-up copied as admin-mockup-D.html). Waiting on full audit (audit-2026-10-19.md) before dispatching T13 fix.
Task 13: fix round 1/5 dispatched to a fresh implementer (BASE 69dec94; previous agent stopped with no changes). Merged origin/dev (Thanksgiving) as 69dec94.
- Ruling R28: if a class does not allow joining partway, every pass (incl. single days / choose-N) closes at the first session — spec: 'sign-ups close before the first session, or people can join partway' — cost if wrong: a single-day buyer can't join day 3 of a camp unless the owner turns on join-partway.
- Audit (audit-2026-10-19.md): 6 Broken, 10 Incomplete, 7 Not started, 11 Minor — every item assigned: T13 fix (B2–B6, I10, M4, M5, M9), 11b-A (I4 who, M1), 11b-B (I3, I4, I5, I6), T14 (B1, I1, I2, I7/R28, M6–M8, N1), T15 (N2, I5 alerts), T16 (N3), T17 (N4), new T17a import (N6).
Task 13: fix round 1/5 (12 addressed per implementer; commits 69dec94..5248558; concerns: mixed café+class plain refunds land on seats, split-tender admin refunds go to first card only) — re-review dispatched
- LIVE SECURITY (found by stage-2 planner): /api/booking/cancel.json on prod cancels any Square booking id with no sign-in; create.json unused. Fix committed LOCALLY on dev 466a650 (routes deleted + guard test), NOT pushed — needs Kaden's go for dev:main (Kaden 10/19: no prod pushes).
- Stage 2 plan drafted: docs/superpowers/plans/2026-10-19-stage2-parties.md (11 tasks, rulings S2-R1…R20) — uncommitted; review + commit after stage 1.
Task 11b-A: dispatched in worktree ../homegrownStudio-admin (branch kaden/admin-d from 5248558) to run alongside T13 re-review; merge back into kaden/own-booking-system after review.
Task 13: re-review 1 → Needs fixes (12/12 addressed; NEW Important N1: retried owner refund can refund twice — split recomputed after webhook/failed save). Fix round 2/5 sent to same implementer (persist pending refund request, reuse split+key).
Task 13: minor (deferred): mixed café+class plain refund lands on seats; split-tender admin refund goes to first card; webhook catalog cache up to 1h; refund pass window 48h by created time; extra order lookup per open café tab update; open counter order losing a line keeps seats
Task 13: fix round 2/5 (N1 + batch-failure memo addressed; commit ae081a1)
- Ruling R29: while a booking has an unconfirmed refund request, refuse different new refunds (409) until an owner marks it 'went through' / 'didn't go through' — never refund twice beats convenience — cost: one extra tap after a Square timeout.
- Ruling R30: refund finalized by webhook/reconcile/'went through' emails the customer exactly once.
Task 13: minor (deferred): same-amount register refund during an unconfirmed request is matched as ours (money right, attribution wrong)
Task 13: fix round 3/5 sent (R29, R30)
Task 13: fix round 3/5 (R29, R30; commit 2a9c843) — re-review 2 dispatched
Task 13: re-review 2 → Needs fixes (N1,N2,R29,R30 addressed; NEW Important I1: same refund re-entered after reload/24h refunds again; Minors M1–M6). Fix round 4/5 → fresh implementer (task-13-fix4-brief.md), includes M1–M6.
Task 13: fix round 4/5 (I1, M1–M6; commit 07e07dc) — re-review 3 dispatched
Task 11b-A: implementer DONE (commits 24f79d9..5039325 on kaden/admin-d; 3411 pass) — task review dispatched
Task 13: re-review 3 → Needs fixes (6/6 addressed; NEW Important N1: retry of 'Refund again' after timeout makes a 3rd refund)
- Ruling R31: 'Refund again' carries {of: latest finished requestId, token} reused across retries; exact token match always wins; request id deterministic; stale 'of' → 409.
Task 13: minor (→T14): half-finished 'It went through' not flagged overnight; /staff refund UI must use again.of shape
Task 13: fix round 5/5 sent (R31 + m1, m4)
Task 13: fix round 5/5 (R31, m1, m4; commit 5e4b167). Accepted deviation: plain same-token retry of a finished request shows the earlier success, not 'Already refunded' — clearer to the owner, no money risk.
Task 13: re-review 4 → Approved (no Important)
Task 13: minor (→T14): retried repeat already finished by Square shows 'Refunded twice already' with live Refund again (should show success + refresh); repeat id not bound to inputHash (API-only); two owners repeating in flight continue one request
Task 13: complete (commits f7a7131..5e4b167, review clean)
Task 11b-A: review → Needs fixes (3 Important: toasts render off-screen; iPad Home two-column overflow; iPad week grid scrolls sideways hiding tapped day; 17 UX quirks; 10 minor)
- Rulings R-A1…R-A7 (tablet icon rail 768–1023, no sideways week grid, closed-day folding + 'closed today' Home, legacy classes in Classes tab tagged 'In Square', one time formatter, per-tab/sheet error boundaries, sheet scroll lock)
Task 11b-A: fix round 1/5 sent (all Important + all quirks + minors)
Task 14: dispatched (BASE 5e4b167) in main worktree, in parallel with 11b-A fix round in admin worktree (disjoint files: no src/components/admin/**)
Task 11b-A: fix round 1/5 (all addressed per implementer; commit 3ecfb1e) — re-review dispatched
Task 11b-A: re-review 1 → Needs fixes (2 Important: iPad toast over panel footer; smooth-scroll glide on sheet close; 14 quirks). Fix round 2/5 sent.
Task 14: implementer DONE (19 commits 5e4b167..ef669cf; 3474 pass, 0 fail; clock tests fixed). Concerns: RefundPanel duplicated into shared/ (admin must switch in 11b-B), 11b-C must reuse setPosDays/decideRefundFlag + new flag kind refund-unfinished, counter payment pays oldest unpaid door seat, daily email repeats undated flags, cancelled class waiver link 'not recognized'. Review dispatched.
Task 11b-A: fix round 2/5 (commit abfbb83). Accepted deviation: week-grid threshold 720px (landscape iPad 756px keeps grid; portrait 708px gets list). Leftover minor: closed half-column header 'Mon…' at 1024. Re-review 2 dispatched.
Task 14: review → Needs fixes (Important: I1 counter sale pays wrong person's door seat; I2 crew refund reason field invisible/disabled confirm unclear; 12 quirks; 9 minor)
- Ruling R32: a POS sale pays an unpaid door seat only for the same class/pass/ticket on the sale's own Chicago day; unpaid door seats after their session → 'door-unpaid' warning + to-decide.
Task 14: fix round 1/5 sent (all Important + quirks + Task-14 minors)
Task 11b-A: re-review 2 → Approved (0 Important; 4 polish quirks + 5 minors carried into 11b-B brief)
Task 11b-A: complete (commits 24f79d9..abfbb83 on kaden/admin-d, review clean) — merge into kaden/own-booking-system after Task 14 fix round lands
Task 16: complete (commit 37ae073 on kaden/admin-d; controller-reviewed small diff: classes by SQUARE_CLASSES_CATEGORY_ID, party fee by 'Whole Studio Party' prefix, use-tax total unchanged, safe fallback + caveat; 3456 pass)
Task 14: fix round 1/5 (6 commits ef669cf..7bf0de5; 3490 pass 0 fail; M8 left — index later). Handoff: 11b-C lists door-unpaid via listDoorUnpaid (src/lib/classes/door-unpaid.ts). Re-review dispatched.
Merged kaden/own-booking-system@7bf0de5 into kaden/admin-d → cc81826 (1 conflict in admin refund route resolved: adminActor + GET requests; 283 files pass). Task 11b-B: dispatched in admin worktree (BASE cc81826).
Task 14: re-review 1 → Needs fixes (Important N1 multi-day pass counter match; N2 retry reports Added for held-only seat; 7 quirks)
- Ruling R33: join-partway-off classes: door hides closed passes and points owners to /admin.
- Ruling R34: >1 unpaid door seat candidates for a counter sale → match oldest + 'counter-match-check' warning/to-decide.
Task 14: fix round 2/5 sent
Task 14: fix round 2/5 (6 commits 7bf0de5..68a8514; 3502 pass). Handoff 11b-C: listCounterMatchChecks + markCounterMatchChecked. Re-review 2 dispatched.
Task 14: re-review 2 → Needs fixes (all round-1 items fixed; Important I1: R34 false check for one family's own 2 seats; minors m1–m8). Fix round 3/5 sent (I1 + m1–m4, m6–m8; m5 accepted fail-safe).
Task 14: fix round 3/5 (4 commits 68a8514..96cd073; 3508 pass). Re-review 3 dispatched.
Task 14: re-review 3 → Approved
Task 14: minor (deferred → final review): n1 retry clock mismatch (500 on ms race); n2 candidate sort relies on ledger order; n3 retry after cancel answers Added; m5 door seat on a no-session day (fail-safe); m2 gap: lost reply + different hand-typed person replays first seat
Task 14: complete (commits 5e4b167..96cd073, review clean)
Task 11b-B: implementer DONE (f5de5be, 9d5922a, 16e4ff1 on kaden/admin-d; 3607 pass). Review dispatched.
Task 15: dispatched (BASE 96cd073) in main worktree with task-15-extra.md (min-to-run alerts, archive coverage test, daily email first-seen, waiver reminders, signup emails, class index)
Task 15: implementer DONE (5 commits 96cd073..f593c1f; 3543 pass). Review dispatched.
Task 11b-B: review → Needs fixes (Important: I1 Add not retry-safe (dup library/class/POS); I2 unlinked class never gets a library link; I3 unpaid counter seats shown as paid + counted in totals; 16 quirks; 9 minor)
- Ruling R35: createKey minted per New class sheet; server idempotent create (also schedule/run again/duplicate).
- Ruling R36: saving/opening an unlinked class links it to a new library v1.
Task 11b-B: fix round 1/5 sent
Task 15: review → Needs fixes (Important: I1 class index can hide a moved class during a concurrent rebuild; I2 reminders only first sitting of the day; minors M1–M6 incl. archive namespace + skip passed decideBy). Fix round 1/5 sent.
Task 15: fix round 1/5 (4 commits f593c1f..c0387e7; 3554 pass). Re-review dispatched.
Task 15: re-review 1 → Approved
Task 15: minor (deferred): comment placement in minimum-to-run; no test for one family in two sittings; untimed 'sending' marker
Task 15: complete (commits 96cd073..c0387e7, review clean)
Task 17a: dispatched (BASE c0387e7) — server + API only; the /admin More row goes into 11b-C
Task 17a: implementer DONE (3e4be23; 3564 pass). Review dispatched.
Task 17a: review → Needs fixes (Important: drop-off lost when event-meta exists). Fix round 1/5 sent (+ flags for missing photo/price differences/tax-free, full-name compare, audit failure non-fatal).
Task 11b-B: fix round 1/5 (0f0d3b5, b267c20, 717f45a; 3638 pass). Accepted: cancelled unlinked classes also link on open. Re-review dispatched.
Task 17a: fix round 1/5 (4558d3c; 3571 pass) — controller-verified (dropOff OR, taxFree only at 0%, photo fill only on untouched import)
Task 17a: complete (commits c0387e7..4558d3c, review clean)
Task 11b-B: re-review 1 → Needs fixes (all round-1 items fixed; NEW Important N1 Run it again prefills a past date; minors N2–N6; quirks QN1–QN4; flake not reproduced)
- Ruling R37: copied dates shift forward by whole weeks to the next open day from today; server refuses sessions starting in the past.
Task 11b-B: fix round 2/5 sent
Task 11b-B: fix round 2/5 (0f66aab, e35305d; 3650 pass). Re-review 2 dispatched.
Task 11b-B: re-review 2 → Approved
- Ruling on RM1: R37 literally — Run it again shifts to the first matching weekday on/after the next open day from TODAY (not today+7). Fix in 11b-C with RM2 (duplicate self-clash → replay) and RM3 (linkToLibrary passes expectedUpdatedAt).
Task 11b-B: complete (commits cc81826..e35305d on kaden/admin-d, review clean)
Fast-forwarded kaden/own-booking-system to kaden/admin-d @5700765 (11b-A, 11b-B, 16 + merges; 3731 pass, tsc 0). Pushed to preview. Admin work continues on kaden/admin-d worktree or main worktree — next 11b-C.
Task 11b-C: implementer DONE (7 commits 5700765..d499982; 3830 pass). Concerns: set-cafe-windows script writes config hours (would undo saved settings); Square holds ~11 café windows (255-char limit) so windows run out; 60s cache lag; counter-match via recordPos + 2 new ledger setters. Review dispatched.
- Ruling R38: scripts/set-cafe-windows.ts reads the saved settings (same merged source as the site); a nightly job rolls the café windows forward (rewrite only when the computed windows differ) so Square never runs out.
Task 17: dispatched in admin worktree (kaden/admin-d ff to d499982) — builds script + checklist; Kaden runs the live E2E via the ! one-liner (no secret fetching by us).
Task 17: implementer DONE (ccfa89b, 5a1caa3 on kaden/admin-d; 3867 pass). Accepted: S5 uses a session starting ~2 min ahead (R37 forbids past); R29 sandbox-untestable (unit only); Square-side checks skipped without SQUARE_SANDBOX_ACCESS_TOKEN. Review dispatched.
Task 17: fix round 1/5 (dc2ab0f: signal cleanup, --cleanup-only, sign-out, redaction, checklist order/time; 3873 pass)
Task 17: complete (commits d499982..dc2ab0f on kaden/admin-d, review approved + minors fixed). Live E2E run = Kaden's ! one-liner after 11b-C lands.
Task 11b-C: review → Needs fixes (4 Important: R38 not done; naming step lost after Match; decided counter sales still 'unresolved' in staff/email; empty weekly café shows stale hours; 14 minors/quirks)
- Ruling R39: café Square write only on the live site (CONTEXT=production or CAFE_WINDOWS_WRITE=1); local/preview skip with a message.
Task 11b-C: fix round 1/5 sent
- Stage 2 started in admin worktree (ledger /Users/catherine/source/homegrownStudio-admin/.superpowers/sdd/2026-10-19-stage2-parties/progress.md); Task 1 dispatched. dev 466a650 merged into kaden/admin-d.
Task 11b-C: fix round 1/5 (57a05ed, 02a6574, 7303f6d; 3853 pass). Re-review dispatched.
Task 11b-C: re-review 1 → Needs fixes (all prior fixed; NEW Important N1 Undo free-seat can overbook; minors N2–N7)
- Ruling R40: 'Texted' never silences minimum alerts; only 'Keep it running'.
Task 11b-C: fix round 2/5 sent
Task 11b-C: fix round 2/5 (59adc1c; 3863 pass ×3). Re-review 2 dispatched.
Task 11b-C: re-review 2 → Approved (minors M1 move-nothing records success; M2 before-list outside lock; M3 Undo offered when nothing to undo → final review)
Task 11b-C: complete (5700765..59adc1c)
Stage 1: all tasks complete. Task 17 (ccfa89b, 5a1caa3, dc2ab0f) cherry-picked + dev (466a650 security fix) merged; 3902 pass, tsc 0; pushed 09af914. Final whole-branch review dispatched.
Final review (stage 1): Ready for sandbox E2E; 0 Critical, 3 Important (I1 lost-answer paid booking loses seat after 24h; I2 dev preview writes live ledger/POS; I3 refunded-but-kept people missing from print/cancel lists), 9 Minor.
- Ruling R41 (I2): on any non-production deploy (CONTEXT != production), class booking writes, simulated payments and class POS sync are refused unless STORE_NAMESPACE is set (clear message).
- Ruling R42 (I1): webhook/reconcile confirm held seats of our own online orders Square shows as paid (same attempt/booking id); if seats can't be confirmed, a To decide item 'paid-not-seated'.
- Ruling R43 (I3): one shared seat-status helper ('coming' = confirmed, not freed) used by print, cancel list, Text everyone, seat counts everywhere.
Final fix round dispatched (I1–I3 + cheap minors).
Final fix round: 7 commits 09af914..63e5b2a (I1–I3, M1–M6, M8, cheap deferred). Follow-up sent: R41 guard extended to blocked time/library/settings/decisions + fail-safe on unknown Netlify context; webhook-confirmed bookings always get one confirmation; Paid-no-seat in warnings.
Final fix follow-up cc544c6 (R41 everywhere + fail-safe; one confirmation per booking via marker; Paid-no-seat in warnings; 3935 pass ×2). Minor: webhook-sent confirmation lacks receipt link. Final re-review dispatched.
Final re-review → Ready (0 Important; N1–N5 minor). Last polish sent (N1, N2, N3, N5; N4 accepted).
STAGE 1 COMPLETE: last polish 63d1722 (N1,N2,N3,N5); 3940 pass; pushed to preview. Awaiting Kaden: sandbox E2E run (one-liner), then real-money checklist + prod go.
