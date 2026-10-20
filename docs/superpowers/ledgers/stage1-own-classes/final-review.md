# Stage 1 final whole-branch review (19 Oct 2026)

Branch `kaden/own-booking-system` @ 09af914 against `origin/main` (production). 289 files, about 38.7k lines added. Read only: nothing committed or pushed, no live service called.

**Checks run**
- `npx vitest run`: 301 files, **3902 passed**, 0 failed.
- `npx tsc --noEmit`: **0 errors**.

**Verdict: Ready for the sandbox E2E run.** Nothing here blocks the sandbox run. Fix the 3 Important findings before the real-money tests (checklist part C) and before merging to `main`.

Counts: **Critical 0 · Important 3 · Minor 9**. There are 54 deferred minors, triaged below: 2 to check during real-money/E2E, 6 cheap to fix now, the rest fine to leave.

---

## Critical

None found. The money path is sound end to end:
- The server prices every booking itself.
- Seats are held with a CAS write before the order is made.
- One Square order, then one charge with the order's total.
- A retry with the same attempt id never charges twice. The keys are the attempt id plus `order`/`pay`, and a paid replay returns the stored answer.
- A declined card releases the seats. When the outcome is unknown, the seats are kept.

The webhook signature is checked with a timing-safe compare. Every admin, staff and job route checks its sign-in or job key.

---

## Important

### I1. A paid online booking whose answer was lost can quietly lose its seat after 24 hours
- **What breaks:** suppose the charge's answer never arrives (`unknown_outcome`), or the payment goes through but the ledger write fails ("PAID CLASS SEATS NOT RECORDED"). The seats are then held for 24 hours and the owners get one text. Nothing ever turns that hold into a booking unless the customer retries from the same browser tab:
  - The webhook and the nightly catch-up skip every order whose `reference_id` starts with `bkg_`, so they never confirm it.
  - /admin shows the booking as "Paying now", with no refund panel and no way to confirm it.
  - It is not in To decide or the warnings.
  - When the 24 hours end, the hold lapses. The booking vanishes from /admin and its seat can be sold again, even though the customer paid.
  - The owners' text says "Add them by hand". The only by-hand tool is a comp, and a comp has no payment link, so the booking could never be refunded later through /admin or matched to a Square refund.
- **Where:**
  - `src/lib/classes/square-events.ts:265` (`bkg_` orders skipped)
  - `src/pages/api/classes/book.json.ts:353-371` and `:373-390` (extend hold + alert only)
  - `src/lib/classes/admin-actions.ts:701` (lapsed holds dropped from the view)
- **Fix:**
  1. In `handleOrder`, when a paid order (COMPLETED, or a COMPLETED payment) carries `reference_id` `bkg_…`, look up its class from the order's variation ids. If that class's ledger has `held` lines for the booking, call `confirm(classId, bookingId, { orderId, paymentId, chargedCents: order total })`. `confirm` already converts expired, unswept holds. If there are no held or paid lines, write a `paid-unrecorded` flag to To decide. The webhook and the reconcile then settle the booking without anyone acting.
  2. List any `held` line older than `HOLD_MINUTES` as a "payment unclear" warning and To decide item, with an "It was paid, confirm" action.
  3. The sandbox E2E cannot produce a lost answer, so cover this with a unit test.

### I2. A preview that isn't namespaced writes real seats into the live seat ledger, and real POS items into live Square
- **What breaks:** after this merges to `dev`, the `dev` branch deploy has no `STORE_NAMESPACE` and uses production Square. It also has `DEV_BYPASS_PAYMENT=true`; the memory notes say the dev preview simulates payments. On that preview:
  - A test booking of one of our classes is "paid" with `sim-…` and confirmed into the **live** seat ledger. It counts against live seats left, shows on the live /staff roster and print sheet, and sends a real confirmation email.
  - Saving a class on the dev /admin runs `syncClassToSquare`, which makes a real item in the live POS. The class shows on the live public list, because the store is shared.
  - This is newer and riskier than the old pattern. Simulated legacy workshop bookings never touched Square's seat count, but these change what real customers can buy.
- **Where:**
  - `src/pages/api/classes/book.json.ts:87,180-187`
  - `src/lib/dev-flags.ts:20`
  - `src/lib/blob-store-name.ts:11-19` (only refuses sandbox without a namespace, not simulated payments without one)
- **Fix:** do either of these:
  - (a) Refuse simulated class bookings unless `STORE_NAMESPACE` is set: `if (simulated && !process.env.STORE_NAMESPACE) return fail(503, 'unavailable', 'Test bookings of our classes only run on the sandbox preview.')`.
  - (b) Give the `dev` branch-deploy context its own `STORE_NAMESPACE` and the sandbox, as the booking-system preview has.

  Whichever is chosen, say in the hand-off to Kaden that /admin on any non-namespaced preview is the live system, Square POS included.

### I3. "Refunded, kept their seat" people drop off the print sheet, the cancel list and Text everyone; freed seats still count on the print sheet
- **What breaks:** a booking refunded in full but with its seat kept (a goodwill refund) has every line in state `refunded`, so `groupBookings` labels it `'refunded'`. Two screens then decide who is coming from that label instead of from the seat:
  - **Print a day** (`src/pages/api/admin/classes/day.json.ts:70`) filters out `state === 'refunded'`. That person is missing from the paper roster and the prep count.
  - In the same file a `part refunded` booking counts every line, including the one whose seat was freed. "N of M seats" then disagrees with /admin and /staff, which both use `seatsTaken`.
  - **Class sheet** (`src/components/admin/sheets/ClassSheet.tsx:257`) builds `live` the same way. The Cancel confirm ("These people are booked"), Text everyone (`:374`) and the not-refundable list all leave the kept-seat person out. They would not be told the class was cancelled.
  - The /staff roster is right: it uses `staff-view.holdsSeat`.
- **Fix:** decide "is coming" per line with one shared predicate: confirmed, or refunded with no `freedSeat`. Add `seatsHeld` (or a `holdsSeat` flag per line) to `BookingView`. In `day.json` and `ClassSheet`, filter and count on that, not on `state`. Add a test: a full refund that keeps the seat still appears on print and in the cancel list. Finding M3 is about the same duplicated rule.

---

## Minor

| # | What | Where | Fix |
|---|---|---|---|
| M1 | The public /calendar can show a party time over **blocked time**, a **draft** class or a **link-only** class. The party picker refuses those times, because it uses `studio-schedule`. A customer taps a time on the calendar and the picker then shows nothing for it. | `src/pages/api/calendar.json.ts:122-127,151-156` | Remove party starts with `ownSpansBetween`/`classSpansOrNone`, as the picker does. |
| M2 | The nightly catch-up reads every class's ledger one after another to build its payment index, for every class ever made, even when Square lists no refunds. `squareFetch` has no timeout. It is fine today, but grows toward the function time limit. | `src/lib/classes/square-events.ts:643-651`; `src/lib/classes/square-api.ts:33` | Skip the index when the refunds list is empty, read ledgers with `Promise.all`, and add an `AbortSignal.timeout(8000)` to `squareFetch`. |
| M3 | The same seat rules are copied in 4 to 5 places: `counts`/`isBooked`/`holdsSeat`/`paidOn`/`leftOn` in `seat-ledger`, `admin-actions`, `staff-view`, `square-events`, `refunds` and `checkout`. Client id makers are copied 3 times (`checkout-attempt.newAttemptId`, and `ClassSheet`/`NewClassSheet` `new*`). There are 3 different server id patterns: `CREATE_KEY_RE`, refunds `okId`, `isAttemptId`. I3 is this drift happening already. | listed | Export the predicates once from `seat-ledger.ts`. Use `newAttemptId` everywhere, and one `isClientToken` for the regex. |
| M4 | Every handled webhook (each café sale makes 3 to 4 events) still posts a Slack note before replying. It only adds noise (it now holds ids only), and nothing happens if `SLACK_WEBHOOK_URL` is unset. | `src/pages/api/webhooks/square.json.ts:77-97` | Notify only on `booking.*`, or drop the note. |
| M5 | `validate.ts` turns booleans into true/false with `!!`, so `"false"` becomes true. Only /admin's own form sends these, so the risk is low. | `src/lib/classes/validate.ts:52` | `raw[k] === true`. |
| M6 | The public class payload sends all of `rules` to the browser: minimum to run, decide-by, waitlist cutoff. That is the studio's own business, not the customer's. | `src/lib/classes/public-view.ts:66` | Send only what the panel uses (cutoff, made to order, max per booking, drop-off, join partway). |
| M7 | Every genuine sold-out makes an unpaid OPEN Square order, because the sold-out recovery path creates the order to ask whether it was paid. The catch-up skips these orders; they only clutter Square. (T8 deferred) | `src/pages/api/classes/book.json.ts:204,336-341` | Fine to leave. Or call `paidEarlier` only when this booking id had lines before. |
| M8 | The sitemap is now built on every request and reads the class store on each crawl. | `src/pages/sitemap.xml.ts` | Fine to leave. Add a short cache header. |
| M9 | Square-class-era code to remove at switch-over, not now, because legacy classes still run: `square-dashboard` comps, `guest-seats`, `CLASS_BOOKING_APP_ID` + `WorkshopBookingModal`, `scripts/create-class.ts`, the legacy branch of `comp-seat.json.ts`, `providers/square/workshop.ts` class reads. | — | Put it on the switch-over checklist. The spec already says these go "once the last Square class has run". |

**Copy:** no "birthday" or "Open Studio" in added customer or staff text. No colon labels in the class panel or class page. The plain-text email labels ("When:", "Your dates:") follow the existing email format.

**Accessibility (/admin):**
- Sheets are `role=dialog` with `aria-modal`, close on Escape and return focus to the button that opened them; the background is `inert`.
- The tab bar uses `aria-current`, the toast region uses `role=status`/`aria-live`, and errors use `role=alert`.
- Inputs sit inside `<label>`, and radio groups are in a `fieldset` with a `legend`.
- No gaps found.

---

## Audit (19 Oct) closure check

| Item | State |
|---|---|
| B1 waiver link | Closed: `getEvent` resolves `cls_` ids, and `waiver-event.ts` also says when a class was cancelled. |
| B2 R26 plain refunds as money | Closed: `recordPlainRefund`. |
| B3 catalog call per order | Closed: one batched catalog lookup per run, and the webhook keeps a 1-hour cache. |
| B4 R25 refunds pass | Closed: `GET /v2/refunds` over 48 hours. |
| B5 webhook settings and old domain | Closed in code and docs (`square-setup-guide.md`, `.env.example`). The live settings are Kaden's step; see the checklist. |
| B6 category and tax missing | Closed: a taxable class with no tax setting can't go on the POS (fails closed). |
| I1 crew refunds | Closed: the /staff Roster uses `class-refund.json` through the shared `RefundPanel`. |
| I2 flags shown | Closed: warnings plus /admin To decide. |
| I3 cancel list before confirm, Refund everyone | Closed, apart from the kept-seat gap in I3 above. |
| I4 who changed it | Closed: X-Admin-Who on a fixed list of owners, and `content-diff`. |
| I5 minimum to run | Closed: decide-by has a time, and texts plus emails go out. |
| I6 waitlist cutoff field | Open as planned (stage 4). |
| I7 R28 | Closed. |
| I8 print waivers | Closed with B1. |
| I9 /admin redesign | Closed (11b A/B/C). |
| I10 force, split tenders, per-class flags | Closed. |
| N1 /staff on the ledger | Closed. |
| N2 jobs and archive | Closed. |
| N3 tax report | Closed. |
| N4 E2E script and checklist | Closed (the run itself is owed). |
| N5 | Closed. |
| N6 import from Square | Closed (Task 17a). |
| M1 sandbox panel on live | Closed: GET `seed-sandbox` hides it. |
| M2 performance | Mostly closed: class index added. Remainder is M2 above. |
| M3 pruning | Open, fine to leave. |
| M4 Slack note | Open (M4 above). |
| M5 OPEN orders | Closed. |
| M6 calendar invite covers every session | Closed. |
| M7 sitemap | Closed. |
| M8 past sessions re-checked on edit | Closed. |
| M9 `.env.example` | Closed. |
| M10 clock tests | Closed. |
| M11 deferred minors | See the triage below. |

---

## Deferred-minor triage (ledger)

**Must fix or verify before real money:** 2 items. **Fix now, cheap:** 6. **Fine to leave:** the rest.

| Task | Deferred minor | Triage |
|---|---|---|
| T8 | verificationToken (SCA) not passed to the payment call | **Verify before real money.** Real-money tests C1 and C2 (card, Apple Pay) must pass. If a card asks for verification, pass the token as parties would. |
| T6 | archiveClassInSquare re-sends read-only fields; removal by omission; create-retry idempotency | **Verify in the sandbox E2E** (scenarios already listed). |
| T1 | `!!` booleans | Fix now, cheap (M5). |
| T15 / 11b-C | M3 Undo offered when there is nothing to undo | Fix now, cheap (hide when the entry id is missing). |
| T13 | unmatched-pos / pos-needs-days / resolved flags never pruned; linesForPayment scans all ledgers | Fix now, cheap: the scan part (M2). Pruning is fine to leave. |
| T12 | free-seat-only shows as "refunded $0" | Fix now, cheap (label it "Seat freed"). |
| T8 | concurrent duplicate finish → two confirmation emails | Fix now, cheap: send the email only from the call that changed held to confirmed (`confirm` can return `changed`). |
| T14 | n1: a retry hitting a millisecond clock race answers 500 | Fix now, cheap (use one `now`). |
| T1 | fixed-pass ids not de-duplicated or checked; choices not de-duplicated; no length caps; imageUrl not checked; untested bounds | Fine to leave (owner-only input). |
| T2 | fixed pass drops unknown sessionIds; add-ons on a class with none; missing mixed-type tests | Fine (add-ons are refused today by `quote`). |
| T3 | CAS race test; updateClass validation; JSON.parse without try; archiveLibrary not audited | Fine. |
| T4 | recordRefund `new Date()`; passId not asserted; fallback class id; no kv timeout in lock; raw answers | Fine (`cleanSeats` + `quote` validate answers). |
| T5 | daysBetween caps at 400; partyBusy fan-out | Fine. |
| T6 | non-image upload / 'card' caption; seed tax matched by name | Fine. |
| T7 | order discount semantics | Stage 4 (promo codes). |
| T8 | reportBooking pre-tax amount | Fine (matches workshops). |
| T8 | findOrderPayment before card_declined | Fine (R17). |
| T8 | no tests for IDEMPOTENCY_KEY_REUSED / the unreachable sold-out message | Fine. |
| T8 | sold-out leaves an open Square order | Fine (M7). |
| T9 | analytics lowest price; sr-only counter text; Pay disabled with no reason when the day fills | Fine. The last is worth a line of copy later. |
| T10 | edit check not atomic; updatedAt RangeError | Fine (overCapacity covers it). |
| T11 | no unauthenticated-refusal test for day.json | Fine (the route refuses). |
| T12 | preview not capped; double 0-cent free-seat; swallowed failure-count write; refundFailures not pruned | Fine. |
| T13 | mixed café + class plain refund lands on seats; split-tender admin refund to first card; 1-hour catalog cache; 48-hour window by created time; extra order lookup per open tab; OPEN order losing a line keeps seats; same-amount register refund attributed to ours | Fine. Each is flagged or rare, and the money stays correct. |
| T13 → T14 | repeat shows "Refunded twice"; two owners repeating in flight | Fine. |
| T14 | n2 candidate sort; n3 retry after cancel answers Added; m5 no-session day; m2 a different person replays | Fine. |
| T15 | comment placement; no test for one family in two sittings | Fine. The "sending" marker is now timed (15 min), so that item is closed. |
| 11b-C | M1 move-nothing records success; M2 before-list outside lock | Fine. |

---

## Production safety if merged to `main`

- **Parties:**
  - The picker and booking now also avoid our classes, blocked time, and closed days saved on /admin. If our class store or blocked time can't be read, they **fail closed** and offer no time. Before, a failed read never blocked a party.
  - The pre-charge re-check keeps "book anyway on error" (R10).
  - The party and kit payment SDKs now follow `SQUARE_ENVIRONMENT` instead of being forced to production, so prod must keep `SQUARE_ENVIRONMENT=production`.
- **Craft Café:**
  - **New: a nightly live Square write.** `netlify/functions/cafe-windows.ts` runs at 06:15 UTC and rewrites the café item's windows from the saved settings, or from the config until someone saves. It only writes when the windows differ, which in practice is every night, as past days roll off.
  - Saving hours on /admin also writes, but only on production (R39: `deployContext==='production'` or `CAFE_WINDOWS_WRITE=1`). Previews and local dev never write.
  - A failure emails the owners once.
  - The public /craft-cafe and home pages now load their hours from `/api/cafe-hours.json`.
- **Legacy Square classes:** unchanged on production. The sandbox shortcut applies only with `SQUARE_ENVIRONMENT=sandbox`. Comp and Sell a seat for legacy classes still use the saved Square sign-in.
- **Waivers:** the page and sign route now also resolve `cls_` ids. Party and legacy links are unchanged, except that a cancelled class now hides the form.
- **Kits:** untouched apart from the payment-SDK environment line. The flag and `BOOKINGS_OPEN` still keep them hidden.
- **Stores:** `blobStoreName` prefixes stores only when `STORE_NAMESPACE` is set. It **throws on Netlify when the sandbox has no namespace**, so check the `dev` branch-deploy context's `SQUARE_ENVIRONMENT` before merging to dev. `class-alerts` is shared by the café roll and minimum-to-run, with different keys (`cafe-windows-failing` / `min-…`), so they don't collide.
- **Scheduled functions on production after the merge:**

  | Function | When | What it does | Safe to repeat? |
  |---|---|---|---|
  | `reconcile-classes` | 08:00 and 09:00 UTC (acts only at 3 AM studio time) | Writes only class stores. | Yes: keyed by order, line uid, unit and refund id. |
  | `cafe-windows` | nightly | Writes the Square café item. | Writes only on change. |
  | `daily-warnings` | daily | Now also texts and emails minimum-to-run alerts. | Yes: CAS marker, 15-minute stuck retry. |
  | `signup-emails` | as before | Now includes our classes. | — |
  | `waiver-reminders` | as before | Now includes our classes. | — |
  | `archive-records` | weekly | Now includes the class stores (photos capped at 300 KB). | — |

  All of them need `LOOKUP_SIGNING_SECRET`.
- **Open endpoints (on purpose):**
  - `/api/classes/[id].json`: drafts and cancelled classes are 404.
  - `/api/workshops.json` and `/api/calendar.json`.
  - `/api/cafe-hours.json`.
  - `GET /api/admin/classes/photo.json?id=`: a random 24-hex id, needed so Square and the public cards can load the picture.
  - The webhook (signed).
  - `/api/classes/book.json`: rate limited, gated by `BOOKINGS_OPEN`. Door mode needs the /staff sign-in.
- **Auth:**
  - Every `/api/admin/**` route checks `adminAuthorized`, and every `/api/staff/**` route checks `staffAuthorized`. Cookies are HttpOnly, SameSite=Lax, and Secure on production.
  - Jobs need the HMAC `x-job-key`. Reconcile also accepts an owner session with `?force=1`.
  - `X-Admin-Who` only names who did something, from the fixed list; it gives no extra access.
  - The webhook HMAC (URL + body) is checked timing-safe.
  - No secrets in logs. Slack and webhook notes carry ids only. Owner texts carry customer contact details, to owners only.

## Live env checklist (production context)

| Setting | Needed | If missing or wrong |
|---|---|---|
| `SQUARE_ENVIRONMENT=production` | yes (set) | If it is `sandbox` without a namespace, every store throws. Party and kit payments would also go to the sandbox. |
| `SQUARE_ACCESS_TOKEN`, `SQUARE_LOCATION_ID`, `SQUARE_APPLICATION_ID` | yes (set) | Payments, catalog and reconcile all fail. Reconcile throws "location is not set up". |
| `SQUARE_CLASSES_CATEGORY_ID` | **new, before the first class** | Every class save fails to reach the POS, so booking is refused with "isn't on the POS yet". POS matching falls back to the `cls_` sku. The tax report files our classes under Craft Café (with a caveat line). |
| `SQUARE_CLASS_TAX_ID` | **new, before the first class** | A taxable class can't be put on the POS, so it can't be booked (fails closed, never untaxed). |
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | **new** (after subscribing order.*, payment.*, refund.*) | The webhook answers 500 and only the nightly catch-up records POS sales and refunds, up to a day late. |
| `SQUARE_WEBHOOK_URL` = `https://ourhometownstudio.com/api/webhooks/square.json` | **new**, exactly | Every event answers 403 (the signature includes the URL). The old domain redirects, and Square won't follow that. |
| `LOOKUP_SIGNING_SECRET` | yes (set 11 Jul) | Every scheduled job is refused: no catch-up, no café roll, no warnings email, no sign-up emails. |
| `ADMIN_PASSCODE` | yes | Nobody can sign in to /admin. |
| `STAFF_PASSCODE` | yes | /staff and door sales stay closed. |
| `BOOKINGS_OPEN` includes `workshops` | yes (parties,workshops) | Our classes show but can't be booked online. |
| `STORE_NAMESPACE` | **must be unset** on production | Production would read empty stores (all records "gone"), and every email and text would go to Kaden. |
| `DEV_BYPASS_PAYMENT` | must not be `true` in production | Ignored on production anyway (`isPreviewOrDev`). |
| `CAFE_WINDOWS_WRITE` | leave unset | Only needed to force café writes off production. |
| `SLACK_WEBHOOK_URL`, email (Gmail) and text (Quo) settings | existing | As today. |
| **`dev` branch-deploy context** | check `SQUARE_ENVIRONMENT` | If it is the sandbox with no `STORE_NAMESPACE`, every store throws. If it is production with bypass, see I2. |
