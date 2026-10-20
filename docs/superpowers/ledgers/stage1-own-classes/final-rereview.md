# Stage 1 final re-review: fix round 09af914..cc544c6 (19 Oct 2026)

Read only. Nothing committed or pushed.

**Checks:** `npx vitest run tests/lib/classes tests/api tests/components/admin`: 101 files, **1457 passed**, 0 failed. `npx tsc --noEmit`: **0 errors**.

**Verdict: Ready.** I1–I3 and M1–M6 and M8 are fixed. M7 and M9 are left, as triaged. There are no new Critical or Important findings. Five new Minors are listed below. N1 is the only one worth fixing before real money, and it is a one-line change.

## Findings

| # | Verdict | Where |
|---|---|---|
| I1 / R42 | **Fixed.** A `bkg_` order goes to `handleOwnOrder` (`square-events.ts:306`). It acts only on a paid order: COMPLETED, a payment event with status COMPLETED, or a tender that Square shows COMPLETED (`:456`). An unpaid OPEN order (a sold-out probe, M7) is skipped. `confirmBooking` runs inside the ledger CAS (`seat-ledger.ts:232`), so only one caller gets `changed`. A replay, the reconcile, or the customer's own late request gets `changed:false` and does nothing more (`square-events.ts:470`). A double confirm can't happen. An expired hold whose seat was resold is confirmed with `overCapacity` (`seat-ledger.ts:260-267`). It never confirms silently over capacity. Paid with no seat leads to one `paid-not-seated` record (`putOnce`), one owners' text and nothing refunded. `openPaidNotSeated` drops the item once that order's seats are recorded. Only `book.json` makes `bkg_` orders (`:330`), and door-counter seats have no order, so I found no path that creates a false "Paid, no seat". | `square-events.ts:431-505`, `seat-ledger.ts:224-269` |
| I2 / R41 | **Fixed.** See "Can R41 block production?" below. | `test-site-guard.ts:25-45` |
| I3 / R43 | **Fixed** in print, the ClassSheet cancel list, Text everyone and the booking count, /staff, `seatsTaken`, waiver reminders, prep and the warnings. **One screen was missed: N1.** | `seat-status.ts`, `day.json.ts:69-72`, `ClassSheet.tsx:258,375` |
| M1 | **Fixed.** The calendar takes party starts off `ownSpansBetween`, the same spans the picker uses. If those spans can't be read, it shows no party time. | `calendar.json.ts`, `party-availability.ts` |
| M2 | **Fixed. No data is dropped.** `mapLimit` keeps the results in input order, and a failed read rejects the whole run, as the old serial loop did. The refunds list is read first, and the payment index is built only when there are refunds. The order pass doesn't need the index. `squareFetch` times out at 8 s (20 s for uploads) and lets a caller's own signal override that. Every write it carries already treats a throw as "unknown". | `square-events.ts:600-622,887-907`, `square-api.ts:33-46` |
| M3 | **Partly fixed, as scoped.** The seat rules are shared. The `isPaidLine` check is still written inline in 6 places (`seat-ledger.ts:233`, `staff-seats.ts:65,94`, `square-events.ts:452,515`, `reports.json.ts:33`, `book.json.ts:132`). Each says "paid", which is correct, so there is no drift risk today. The id makers were left alone. | — |
| M4 | **Fixed.** The Slack note goes out for `booking.*` events only. | `webhooks/square.json.ts` |
| M5 | **Fixed.** A rule switch is on only for `true` or `"true"`. | `validate.ts:52` |
| M6 | **Fixed.** `publicRules` is applied. | `public-view.ts:66` |
| M7 | Left, as triaged. These orders are unpaid, so `handleOwnOrder` skips them. | — |
| M8 | **Fixed.** Netlify CDN cache header, 1 hour. | `sitemap.xml.ts` |
| M9 | Left. It goes on the switch-over checklist. | — |
| Deferred cheap fixes | **Done:** Undo only when there is something to undo, "Seat freed" for a $0 free-seat, one confirmation per booking (T8), and one clock for door retries. | — |

## Can R41 block production?

**No.** Here is how the context is decided (`deploy-context.ts:16-30`), in order:
1. `import.meta.env.DEV`.
2. Netlify's runtime `Netlify.context.deploy.context`.
3. `process.env.CONTEXT`.
4. The request host.
5. Otherwise `'unknown'`.

On Netlify, `'unknown'` is refused (`test-site-guard.ts:30`).

- **Live requests.** `src/middleware.ts:14` calls `deployContext(context.request)` on every SSR request, including API routes. The host `ourhometownstudio.com`, the old domain and `iridescent-croissant-494fc3.netlify.app` all resolve to `production`, and that result is remembered for the function instance. So the store-level guard calls that pass no request (`seat-ledger.ts:119`, `class-store`, `blocked-time`, `library-store`, `studio-settings`, `square-catalog`, `to-decide`) still see `production`, even if the Netlify global were missing.
- **Scheduled jobs.** `reconcile-classes`, `cafe-windows`, `daily-warnings`, `signup-emails`, `waiver-reminders` and `tax-report` don't write the stores themselves. Each one POSTs to `${context.site.url ?? process.env.URL}/api/jobs/…`, which is the live primary domain. So the work runs in the SSR function as an ordinary request on the production host, and the middleware has set the context before any write. `CONTEXT` being absent there doesn't matter.
- **`archive-records`** (and the old programs `send-rosters`) only reads stores through `blobStoreName` and calls no guard.
- **The Square webhook** arrives on the production host (`SQUARE_WEBHOOK_URL`), so it resolves the same way.
- **The only way to be refused on live** is a request that reaches the SSR function under a host matching none of the patterns, with no Netlify runtime context. No such host exists on our live site.

## New findings

**Critical:** none. **Important:** none.

**Minor:**

- **N1 (R43 gap, fix before real money; one line).** To decide › Below minimum › "Text the people booked" builds its phone list with `bookings.filter((b) => b.state !== 'held' && b.state !== 'refunded')` (`src/components/admin/inbox/ToDecideSheet.tsx:414`). This is the I3 rule that the fix round replaced everywhere else.
  - A goodwill refund that kept the seat (booking state `refunded`) is left out, so that person is never texted that the class may not run.
  - Fix: `.filter(isComingBooking)` from `../classes/labels`. Add a test like the ClassSheet one.
- **N2 (R42).** The marker is claimed before the send, and when Square's notice sends the email, a failure isn't retried or reported.
  - In `confirmByEmail` (`square-events.ts:410-428`), the owners' text "Class booked from Square's payment… confirmed" goes out *before* the email. If the send then fails, the marker is released (`releaseConfirmation`), but in R42's main case (the customer's request died) nobody comes back:
    - A replay and the reconcile both get `changed:false` and stop at `:470`.
    - The customer gets no confirmation and no waiver link. The class-day waiver reminder is the backstop.
    - The owners aren't told the email failed.
  - `book.json` has a "Confirmation email didn't send" alert (`book.json.ts:478-483`). The webhook path does not.
  - A crash between claim and send leaves the marker claimed forever. That is rare.
  - Fix: send the owners' text after the email and add "the confirmation email didn't send; please send them the details" when `sent` is false. A retry isn't needed.
  - Side effect: release followed by a later live request means a second owners' text. That is harmless.
- **N3 (R41 scope).** A deploy with a `STORE_NAMESPACE` is allowed every write, including `syncClassToSquare`, whatever `SQUARE_ENVIRONMENT` is.
  - If someone gives the `dev` branch a namespace but leaves it on production Square, saving a class on that preview creates a real item in the live POS.
  - The hand-off already says "namespace **and** the sandbox".
  - Optional hardening: in `square-catalog.ts:108,214`, refuse when the context is not production and Square is not the sandbox.
- **N4.** Two pre-existing context-detection edge cases. Neither touches production writes.
  - A preview opened through its permanent deploy link (`<hex>--site.netlify.app`) resolves to `production` when the Netlify runtime context is missing (`deploy-context.ts:40`), so the R41 guard would allow writes there. I believe Netlify's runtime context is present in the Astro v6 adapter's functions, which makes this theoretical.
  - Under `netlify serve` locally, the context is unknown and `NETLIFY` may be set, so local writes would be refused. That costs only dev convenience.
- **N5.** The /admin class list's booking count still counts fully freed bookings. `classesBetween` uses `bookings: views.length` (`admin-actions.ts:217-219`), while the ClassSheet count now uses `isComingBooking`. The list and the sheet can show different numbers after a free-seat refund. This is display only.

## Notes
- **Receipt link.** When Square's notice beats a live request, the customer's email has no receipt link. The report already says so. This is acceptable: Square emails its own receipt.
- **Hand-off line for Kaden (unchanged).** On a preview without `STORE_NAMESPACE`, /admin saves and test bookings are refused with "This test site has no store of its own. Set STORE_NAMESPACE first." To use one, give the `dev` branch-deploy context its own namespace and the sandbox (see N3).
