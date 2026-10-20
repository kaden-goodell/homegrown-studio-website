# SDD ledger — plan: docs/superpowers/plans/2026-10-19-stage2-parties.md

Spec: docs/superpowers/specs/2026-10-18-own-booking-system-design.md. Worktree: /Users/catherine/source/homegrownStudio-admin (branch kaden/admin-d). Stage-1 ledger with rulings R1–R39 (precedents): /Users/catherine/source/homegrownStudio-booking/.superpowers/sdd/2026-10-18-stage1-own-classes/progress.md
Owner: Kaden, FULL AUTONOMY ("DO IT ALLLLL Hurry up!!!", 2026-10-19). Never push prod; push only kaden/own-booking-system (sandbox preview).
- OWNER-1/2/3 → plan defaults adopted (party lines untaxed; no host reminders built now — checklist step; admin "Another time" allowed within schedule/hours/no-midnight).
Task 0: partial — plan committed, dev (466a650) merged into kaden/admin-d; 11b-C merge pending (lands on kaden/own-booking-system, then merged here).
Task 1: dispatched (BASE dda611c)
- Stage 3 + 4 plans drafted (docs/superpowers/plans/2026-10-19-stage3-staffing.md, -stage4-extras.md); OWNER defaults adopted (see plan files). Kaden later: confirm Square app for POS callbacks + set SQUARE_POS_CLIENT_ID; READER_ENABLED off until $1 prod test; promo codes off in prod until sandbox S4-1 (half-cent rounding) passes.
Task 1: implementer DONE (5a21237; 3900 pass; class book tests unedited). Concern: 2 screen-test timeout flakes under load (SettingsSheets, PrivateEventForm) → fix in a test-stability task. Review dispatched.
Task 1: review → Approved (minors: CREATE_KEY_RE duplicate → import once; explicit decline tag for parties; unit tests for recovered/paymentId; escape drift email HTML) — carry minors into Task 2
Task 1: complete (dda611c..5a21237)
Task 2: dispatched (BASE 1bd9c6e)
Task 2: implementer DONE (4e27d42; 3918 pass ×3; protected class tests unedited). Concerns: bigger RefundBook interface; 'party' scope needs module registration on webhook path (Task 10 MUST import it); runner⇄classes/refunds circular import; flaky tests fixed via faster queries. Review dispatched.
- Task 10 MUST: import the party refund book on the webhook/reconcile path (else party refunds made in Square aren't matched to saved requests).
Task 3: dispatched (BASE 4e27d42) in parallel with Task 2 review (disjoint files: party settings)
Task 2: review → Approved (Important hardening for Task 10: split refund-words.ts to break runner⇄classes/refunds cycle; static booking-core/refund-books.ts registry holding claimSquareRefund, unknown scope throws, square-events imports it directly. Minors: keep one scoped getByRole per element; pass list name on webhook path; comment refundBookFor scope-only)
Task 2: complete (4e27d42)
Task 3: implementer DONE (179ba06; 3993 pass). Accepted: past dated days kept but not validated (validatePartySettings {now}); closed weekdays checked only against midnight (owner one-off party days allowed). Review dispatched.
Task 4: dispatched in parallel (BASE 179ba06)
Task 3: review → Approved (Important for Tasks 11/12: pass now to validatePartySettings and show the times.dates.2026-10-24 error on its field — live config's Oct 24 7 PM start ends 9:30 PM past the 9 PM close; changing prod config needs Kaden's OK. Minors: add Oct 9 to equivalence nows; confirm owner bookings refuse dates before first party day (Task 11).)
Task 3: complete (179ba06)
Task 4: implementer DONE (4045106; 4038 pass). Handoffs: Task 9 pass {packageId} to orderLineItems; Task 7 add 'itm' to idFor; line notes = internal ids (check receipts in sandbox Task 14). Review dispatched.
Task 5: dispatched in parallel
Task 4: review → Approved (Important before Task 11: per-guest extras quota derived by qty/guests breaks on guest edits)
- Ruling S2-R4a: PartyItem stores count (chosen units) set at pricing; quota sums counts; when guests rise, owners add the per-guest extra for the NEW guests only (quoteAddOn takes forGuests); orderLineItems packageId becomes required; quoteAddOn errors carry field; empty party id refused.
Task 4: fix round 1 queued (after Task 5 commits, to avoid concurrent commits)
Task 5: implementer DONE (6699015; 4064 pass). Handoffs: Task 7 always passes endIso to confirmTime (R6); moveTime caller updates record + releases old time; overlap only vs other party holds (caller runs clashes). Review dispatched. Task 4 fix round 1 dispatched.
Task 4: fix round 1/5 (bbb7341; 4069 pass) — controller-accepted (scoped, tests cover reviewer's two cases)
Task 4: complete (179ba06..bbb7341)
- COPY FOR KADEN (pre-prod): top-up refusals 'Add <label> for every guest first.' / 'Every guest already has <label>.' / 'Only N guests don’t have <label> yet.' / 'Say how many new guests it’s for.'
Task 6: dispatched (BASE bbb7341) alongside Task 5 review
Task 5: review → Needs fixes (I1 same-start move deletes the hold; I2 extendHold can shorten/drop holds; M1–M7)
- Ruling S2-R5a: holds only ever get longer; paid party time never lost; Task 7 holds with no expiry on unclear outcome + owner path for paid-unclear parties (see review notes).
Task 5: fix round 1/5 sent (concurrent with Task 6; disjoint files)
Task 5: fix round 1/5 (6c687b2; 4077 pass). Re-review dispatched. Task 7 extras written (task-7-extra.md). NOTE: machine load ~157 during parallel full suites — cap parallel implementers at 2.
Task 5: re-review 1 → Approved
Task 5: complete (4045106..6c687b2)
- Tasks 9/13: 'Party hold with no party' warning also covers holds of CANCELLED parties (late extendHold can rebuild them). Task 11: moveTime timeout → tell owner to retry / name the extra hold.
Task 6: implementer DONE (bae0412; lib/api/netlify 2673 pass; screen-test timeouts under load avg 47–240 = machine overload, not this task). Handoffs: Task 7 deletes legacyBookingHeldBy + removes R10 'book on check error' in old route; Task 11 uses legacyRemaining(); Task 13 class-over-party scan for our classes. Stage-1 bug fixed here (checkClashes ±1h for party cleanup) — reaches booking branch at merge. POLICY: reviewers run targeted tests only; one full suite per merge. Review dispatched.
Task 6: review → Approved (minors: batch/skip party labels on public reads; accept any party-item variation; confirm no other Square service books the room)
Task 6: complete (6c687b2..bae0412)
Task 7: dispatched (BASE bae0412)
Task 7: implementer DONE (283f886; 4106 pass). New store party-checkouts (archived); To decide 'party-paid-unclear'; party-only test-site guard copy (merge with stage-1 R41 guard at branch merge). COPY FOR KADEN: 'That craft isn’t available any more. Nothing was charged. Pick another craft.' / 'That party was cancelled. Nothing was charged. Start a new booking, or text us.' Review dispatched.
Task 7: review → Needs fixes (I1 unclear party with refused-key order can never be resolved; M1–M6). Fix round 1/5 sent. Notes: Task 9 handle link-payment orders before 'paid by another order' check; Task 8 new attemptId when package/add-ons change, KEEP id on in_progress (M3 ruling).
- Task 9: handle link-payment orders before the 'paid by another order' check in handlePartyOrder.
Task 7: fix round 1/5 (42caf7b; 4112 pass). COPY FOR KADEN (owner): Confirm-refused message (see report). Re-review dispatched.
Task 7: re-review 1 → Needs fixes (N1 Important: changed choices reuse old order → wrong charge/theme; N2–N4 minor). Fix round 2/5 sent.
Task 7: fix round 2/5 (a2f96e5; 4116 pass). COPY FOR KADEN: 'Something changed. Nothing was charged. Please try again.' Re-review 2 dispatched.
Task 7: re-review 2 → Needs fixes (N5 Important: paid party can get no confirmation after a save that wrote-then-threw; N6, N7 minor). Fix round 3/5 sent.
Task 7: fix round 3/5 (6b1b19e; 4119 pass). Re-review 3 dispatched.
Task 7: re-review 3 → Approved
Task 7: complete (bae0412..6b1b19e)
- Carry to Task 13: show stale checkouts whose record has no confirmation noted (M1); fix 'nothing here to book it from' wording for retired attempts (M2); tests for payment event on retired checkout + 7-day prune (M4).
Task 8: dispatched (BASE 6b1b19e)
Task 8: implementer DONE (e192106; 4155 pass). index/policies now SSR with 5-min SWR cache (Netlify cost note for Kaden). COPY FOR KADEN: Task 8 drafts (Package/Extras steps etc., see report). Review dispatched.
Task 8: review → Needs fixes (I1 package change keeps old times; I2 link+extra time trap; quirks). Rulings S2-R8a (non-fitting extra time disabled on fixed-time links), S2-R8b (index/policies static, price loaded client-side). Fix round 1/5 sent.
Task 8: fix round 1/5 (1cfc79b; 4166 pass). Note: first visual check used real .env — reads only, no writes (agent-reported). COPY FOR KADEN: Task 8 round-1 drafts (see report). Re-review dispatched.
Task 8: re-review 1 → Approved (minor → final review: shared request counter for late times responses in PartyModal; price-facts cache not purged on save)
Task 8: complete (6b1b19e..1cfc79b)
Task 9: dispatched (BASE 1cfc79b)
Task 9: implementer DONE (4e657df; 4201 pass). Carry to Task 13: unclear link payments in To decide; 'hold with no party' covers cancelled. Task 11: share one-payment-at-a-time claim for owner card. Concern 4 (pay key ?k= and host ?key= leak to GA/PostHog) → must fix. Review dispatched.
Task 9: review → Needs fixes (I1 charge may differ from shown amount; I2 ?k=/?key= leak to GA4/PostHog/Meta — host page part is LIVE on prod). Ruling S2-R9a (no analytics on /party/*, strip key, referrer same-origin). Fix round 1/5 sent.
- PROD ISSUE to prepare on dev (needs Kaden's go): host page ?key= reaches GA/PostHog/Meta on live /party/* pages.
Task 9: fix round 1/5 (c647593). NOTE: dev has 1bac82d (party pages: no analytics at all) — at stage merge, keep the branch's stronger version (key stripped + sessionStorage) and reconcile Layout. Re-review dispatched.
Task 9: fix round 2/5 (437e18e: ph-no-capture on key links + PostHog before_send strips key/k; same-attempt retry keeps order) — controller-accepted (focused tests 392 pass)
Task 9: complete (1cfc79b..437e18e)
Task 10: dispatched (BASE 437e18e)
Task 10: implementer DONE (75261fd; 4251 pass). Review dispatched.
Task 10: review → Needs fixes (I1 party refund email class wording; I2 party flags show as 'A class'). Fix round 1/5 sent (+ minors 1,2,3,6).
Task 10: fix round 1/5 (4017535; focused 670 pass) — controller-accepted (copy/labels/record fixes)
Task 10: complete (437e18e..4017535)
- COPY FOR KADEN: party refund email lines (see task-10-report Fix round 1)
Task 11: dispatched (BASE 4017535)
- 2026-10-19 18:32 Kaden: 'pause all changes to the site while my wife is talking to you' — Task 11 implementer STOPPED mid-task (check admin worktree for uncommitted work before resuming). No pushes, no live writes until Kaden says resume.
