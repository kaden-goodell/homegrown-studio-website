# Private Event Quotes: Spec

> **PRD:** docs/plans/2026-11-17-event-value-quote-prd.md
> **PRD rev:** A
> **Design:** https://claude.ai/artifact/HkGgP7AZV8GKChJAA7ZMFi (artboard "C · The Invitation")
> **Tier:** Full · **Branch:** kaden/event-value-quote (off dev)
> **Reviewed:** spec swarm (blast-radius, data-dependency, ui-conflict, state-completeness), 38 findings, folded in below.

## 1. Overview
Owners turn a private-event request into a quote: up to three priced packages on a private, invitation-style page. Sending holds the date under the party id the quote will become. The customer pays a deposit through the existing pay-link payment path; the quote becomes a booked party of ours with the balance left due on the same pay link.

## 2. Background
See the PRD. Built on: party book holds (`src/lib/parties/party-book.ts`), the pay-link charge path (`pay-balance.ts`), party records (`party-store.ts`), the private-event request inbox (`event-requests.ts`, `components/admin/inbox/*`).

## 3. API contract

Common: admin routes require `adminAuthorized` (401 `{error:'Sign in first.'}`), actor `adminActor`, `recordAudit` on writes. Every route that writes a quote, a party record or the party book returns 503 with `partyWritesRefusal(request)` when set. **Every quote write runs inside `withPartyLock(quote.partyId)`** (the same lock all party actions use), re-reading the quote inside the lock.

### Admin
- `GET /api/admin/quote-menu.json` → `{data:{items, packages, settings}}`. If the menu has never been synced, runs `sync-square` first.
- `POST /api/admin/quote-menu.json` `{action}`:
  - `sync-square`: every catalog ITEM in every category, every variation, merged by variation id. Keeps owner `costCents`, `tags`, `hidden`, `per`. Updates name, cents, photo. A variation missing from a **complete** sync gets `gone:true`; a returning one clears it. A failed or partial sync changes nothing and returns 502.
  - `save-item {item}` (create or update; 400 empty name / negative cents), `hide-item {id, hidden}`, `save-package {pkg}`, `delete-package {id}`, `save-settings {settings, expectedUpdatedAt}` (409 `stale`).
- `POST /api/admin/quotes/draft.json {requestId, targetCents?}` → creates the request's quote (status `draft`) or returns the existing open one. If the existing quote is withdrawn or expired, creates a new one (old one kept, index points to the new). Request already `booked` → 409 `why:'booked'` unless `force:true`.
- `GET /api/admin/quotes/by-request.json?requestId=` → `{data:{quote|null, view:{status, views, ...}}}`
- `POST /api/admin/quotes/save.json {quote, version}` → 409 `stale` (version mismatch), 409 `paid` (paid or paying), 409 `over_cap` when a sent quote's visible tier is past the cap and `overCapOk` not true, 409 `time_taken` when a time/place/expiry change can't be held (old hold kept). Bumps `version` and `priceKey` on owner edits only.
- `POST /api/admin/quotes/send.json {id, text, email, overCapOk?, noHold?}` → 400 `no_tiers`, 400 `incomplete` (no start time / guests / place address for away), 409 `over_cap`, 409 `time_taken {clash:{label,startIso}}`, 409 `closed` (owner time rule `ownerTimeRefusal` refuses the start). Holds, messages, status `sent`, request `quoted` (never downgrades `booked`).
- `POST /api/admin/quotes/action.json {id, action}`: `resend` (sent/picked only; else 409 `why:<status>`), `withdraw` (not on paid/paying → 409 `paid`), `reopen` (withdrawn or expired → new expiry, re-hold, status `sent`, clear `expiryTold`; 409 `time_taken` on clash).
- `GET /admin/quote/[id]/flyer` (Astro page; no admin cookie → 302 `/admin`).

### Public
- Page `GET /quote/[token]`: bare layout (no site nav/footer), `noindex noReferrer`, no analytics, no Meta Pixel; `/quote/` added to the private-path checks in `Layout.astro` (`privateParty`, `posthogPagePrivacy`).
- `GET /api/quote/view.json?t=` → public view (no cost, margin, owner names, history). States: `open`, `paying`, `paid` (receipt read live from the party record; cancelled party → "cancelled" state), `closed` (expired, withdrawn, draft, or unknown token: identical response). Counts a view (best effort, no `version` bump) unless a valid admin cookie is present. Rate limit 60/min/IP.
- `POST /api/quote/pick.json {t, tierId}` → sets `pickedTierId`, status `picked` (from `sent`/`picked`). 410 `closed`, 404 `tier_unavailable`. No `version` bump. Rate limit 20/min.
- `POST /api/quote/pay.json {t, tierId, priceKey, attemptId, pay:{paymentToken, verificationToken?, sourceKind?}}` → `{data:{partyId}}`. Refusals (nothing charged): 410 `closed`, 404 `tier_unavailable`, 409 `price_changed` (priceKey mismatch), 409 `time_taken`, 409 `busy` (a payment is being checked), 402 `declined`. Repeat after success → 200 same `partyId`. Unclear outcome → 202 `why:'checking'`. Rate limit 5/min/IP. Not behind the bookings gate.

### Status × action guard table (server-enforced)
| status | view | pick | pay | save | send | resend | withdraw | reopen |
|---|---|---|---|---|---|---|---|---|
| draft | closed | 410 | 410 | ok | ok | 409 | ok | 409 |
| sent | open | ok | ok | ok | ok (=resend) | ok | ok | 409 |
| picked | open | ok | ok | ok | ok (=resend) | ok | ok | 409 |
| paying | paying | 410 | 409 busy / resume | 409 | 409 | 409 | 409 | 409 |
| paid | paid | 410 | 200 same party | 409 | 409 | 409 | 409 | 409 |
| expired (derived) | closed | 410 | 410 | ok (read-only UI) | 409 | 409 | ok | ok |
| withdrawn | closed | 410 | 410 | 409 | 409 | 409 | 409 | ok |

## 4. Data model

- `quote-menu` store (Blobs, owner-only writes, CAS), keys `menu`, `packages`, `settings`:
  - `MenuItem {id, source:'square'|'own', squareItemId?, squareVariationId?, name, photoUrl|null, cents, per:'person'|'event', costCents|null, tags[], hidden, gone?, updatedAt}`
  - `SavedPackage {id, name, photoUrl|null, lines: QuoteLine[], savedAt, by}`
  - `QuoteSettings {capPct, yellowFromPct, depositPct, expiryDays, updatedAt}`; every reader falls back to defaults 25 / 20 / 50 / 14.
- `quotes` store: **added to `PG_STORES`** (race-critical: pick, pay, save, withdraw). Keys:
  - `q-<id>`: `Quote {id, requestId, partyId (minted at draft: idFor('pty', 'quote-'+id)), token (32 hex crypto random), version, priceKey, status:'draft'|'sent'|'picked'|'paying'|'paid'|'withdrawn', place:'studio'|'away', address, startIso|null, endIso|null, guests, crafters:'kids'|'adults'|'both', targetCents, note, depositPct, expiresAt, tiers: Tier[], held:boolean, sentAt?, sentBy?, updatedAt?, views, lastViewedAt?, pickedTierId?, paying?:{attemptId, at}, paidAt?, expiryTold?, history:{at,by,what}[]}`
  - `t-<token>` → id, `r-<requestId>` → current quote id. Write order: `q-` first, then `t-`, then `r-`. A missing `r-` is repaired by scanning `q-` keys for the request; a missing `t-` means the link reads `closed` until the next save rewrites it.
  - `Tier {id, key:'simple'|'pick'|'all'|'custom', name, photoUrl|null, hidden, lines: QuoteLine[], priceCents}` (price per person)
  - `QuoteLine {itemId|null, label, photoUrl|null, cents, per, costCents|null}` (snapshot: later menu edits don't change sent quotes)
  - Derived: `normalPerPerson = Σ person cents + ⌈Σ event cents ÷ guests⌉`; `offPct = 1 − price ÷ normal`; `total = price × guests`; `deposit = round(total × depositPct/100)`; `expired = status ∈ {sent, picked} && now ≥ expiresAt`; `priceKey` = hash of (visible tiers' price and lines, guests, depositPct, startIso, place).
- `PartyRecord` additions (optional; old records unchanged): `origin?: 'quote'`, `quote?: {quoteId, tierName, lines: string[], guests}`, `place?: 'studio'|'away'`, `address?`. `kind` untouched. Quote parties set `craftName` = tier name, `title` = "<first name>'s private event", `durationMinutes`, `endIso`, `dropOff:false`, no `packageId`/`craftId`/`craftPerHeadCents`.
- `PartyItem.kind` gains `'quote'` (deposit and balance lines).
- Café costs: `scripts/data/cafe-costs.json` (53 items, exported from the café pricing artifact).

## 5. Business logic

**Draft**
- Target = budget midpoint ÷ guests, rounded to the dollar (midpoints: under-1000 $500, 1000-2500 $1,750, 2500-plus $3,000). No budget → the normal per-person of the drafted Our pick.
- Tiers 80 / 100 / 130% of target, rounded. Each tier greedily takes the best-scoring visible, non-gone items (tag match to crafters kids/adults/both, theme words, `holiday` for Nov–Dec dates; crafts first by price) while `normalPerPerson ≤ price ÷ (1 − cap)`. Empty tiers are omitted.
- From the request: guests, date, `place` (`yours` → `away`), address, crafters (`''` → `both`), start time (empty → `startIso:null`, Send blocked with `incomplete`), length parsed in hours (default 2 h).

**Meter**: green `< yellowFromPct`, yellow `yellowFromPct..capPct`, red `> capPct`.

**Hold (studio quotes; all under `quote.partyId`, always a finite TTL to `expiresAt`)**
| change on a sent/picked quote | hold action |
|---|---|
| send | `holdTime` (TTL to expiry); clash → 409 `time_taken`, nothing sent |
| start moved | `moveTime`; clash → 409, old hold kept |
| end changed | `resizeTime`; clash → 409, old kept |
| studio → away | `releaseTime` |
| away → studio | `holdTime`; clash → 409, stays away |
| expiry later | `extendHold`; `held:false` → 409 `time_taken` |
| expiry earlier | release, then hold with the new TTL |
| withdraw | `releaseTime` |
| expiry reached | nothing (expired holds stop counting) |
| reopen | `holdTime` with the new TTL |
- `noHold` send: no hold; `held:false`; pay tries a 15-minute hold first.
- Labels: `partyBusy`/`studio-schedule` resolve a hold id with no party record through the quote (`"Quote hold: <name>"`) so the admin calendar and print schedule name it.
- Warnings: TTL holds are already skipped by `partyWarnings`, To decide and `freeOrphanHold` (verified with a test, no code change). The send-time clash check and the class guard (`findPartyClashes`) treat a live quote hold as a clash to warn about.

**Pay (inside `withPartyLock(partyId)` except where noted)**
1. Load by token; apply the guard table; check `priceKey`; tier visible.
2. Party record exists? Has a paid deposit item → return its id. Has `paying` → 409 `busy`. Otherwise reuse it.
   No record → create it (`origin:'quote'`, `status:'booked'`, `payToken`, `hostToken`, host from the request, `guestCount`, `place`, `address`, `quote{...}`, one item: deposit `kind:'quote'`, unpaid). Quote → `paying {attemptId}`.
3. Studio: make sure the hold is live for at least 15 minutes (`extendHold`, or `holdTime` when there is none). Clash → delete the just-created record if it has no charges, quote back to `picked`, 409 `time_taken`.
4. Charge through the pay-link core (`payBalance` with the record's `payToken`, `expectedCents` = deposit, the same `attemptId`). It charges only the unpaid deposit item, with its one-payment-at-a-time claim, unclear handling and replay. (If `payBalance` takes the party lock itself, step 4 runs after releasing ours; its claim keeps it single.)
5. Paid → `confirmTime(partyId)` (same id: no overlap), add the balance item (`kind:'quote'`, unpaid, total − deposit), quote `paid`, request `booked`, owners email + text "Private event booked: <name>, <date>, deposit $X". The customer gets the payment confirmation from the pay-link path, with private-event copy.
6. Declined → delete the record if created in this request and it has no charges; quote back to `picked`; 402.
7. Unclear → keep everything; quote stays `paying`; the page says "We're checking your payment. We'll text you." The existing party-payment-unclear To decide item and sweep cover it. When it settles: paid → steps 5; not paid → quote back to `picked`, record removed if it has no charges.
- Never refunds or cancels anything automatically.

**Consumers of quote parties** (each branches on `origin === 'quote'` or item kind `'quote'`)
- `pricing.ts` order line names: "Private event: <label>".
- `payment-link.ts` and `email.ts` pay-link copy: "Your private event on <date>: $X still due", no "crafts are paid at the studio", no "held for you".
- `balance.json` / `PartyPayPanel`: list quote lines by label; no "extras added since" wording.
- Refund line: the party's cancellation terms (d3) with the deposit as the base, not the $300 studio-fee default.
- `PartySheet` (admin): Details shows the package lines and deposit/balance; no "+ Add an extra"; no "crafts rung up on the POS" line.
- `staff-money.ts` `crewPartyMoney`: "Crafts included" (no ring-up); staff `Upcoming`/roster show a "Private event" badge, the package lines, the guest count, and the address for away events.
- `party-terms.ts` / `party-register.ts` / host `PartyDashboard`: no studio fee, no craft minimum for quote parties.
- `admin-actions.ts`: guest-count edits and remove-item refuse `'quote'` items with a plain message.
- The quote receipt reads date, paid and due live from the party record, so owner moves on the party show up there.

**Other rules**
- Sent-quote save past the cap needs `overCapOk` (same confirm as Send). Quotes keep their own `depositPct`.
- Hiding or removing the picked tier clears `pickedTierId` and reverts `picked` → `sent`.
- Request status: send → `quoted`; pay → `booked`; withdraw → back to `new` only if it was `quoted`; never downgrades `booked`.
- Expiry sweep: the 10-minute scheduled job route also scans open quotes past `expiresAt` with no `expiryTold`. It sets `expiryTold` by CAS first and texts the owners only if that write won. `reopen` and later expiry dates clear `expiryTold`.
- Make a quote on a request already Quoted or Booked asks first (UI) and the API needs `force` for Booked.
- Studio start must pass `ownerTimeRefusal` (8 AM to 8 PM start, any day) at Send.
- Café costs import: matches `cafe-costs.json` names to synced items by normalized item name (and variation name when present); unmatched stay null; re-sync never clears `costCents`.

## 6. Entry points
- A. Admin inbox → request sheet → **Make a quote** / **Open quote** (beside the status control; the status chip sits under it) → quote sheet `#quote-<requestId>` (form sheet, homed under Inbox). Close returns to the request sheet. The quote sheet shows the customer's name, phone and email.
- B. Admin More → **Quote menu** (`#more-quote-menu`).
- C. Customer link → `/quote/<token>`.
- D. Quote sheet → **Flyer** → printable page in a new tab.

## 7. UI states
- **Request sheet**: Make a quote (no quote) / Open quote (has one) + quote chip (Draft, Sent, Viewed ×n, Picked, Paying, Paid, Expired, Withdrawn); "Next:" hint in `describe.ts` updated ("Make a quote", "Waiting on them: quote sent <date>").
- **Quote sheet** (Catherine-first, centred card on iPad): facts (date, start, length, guests, place/address; each editable); Target $/person (editing re-drafts after an in-sheet confirm); tier cards (name, photo, lines with remove, normal → price, total, meter, hide toggle); Add item (search the menu) / Add saved package / Add one-off line / Save as package; note; deposit %; expiry date; actions: Send (text + email toggles) / Resend / Withdraw / Reopen / Flyer / Preview (opens the customer page without counting a view). Over-cap: one in-sheet confirm, asked before calling Send and remembered for that send. Time taken: a panel naming the clash with "Pick another time" and (studio only) "Send without holding". States: draft, sent/picked (editable; save warns "The customer will see Updated"), paying/paid (read-only, link to the party), expired (editable + Reopen), withdrawn (read-only + Reopen).
- **Quote menu** (More): search + tag filter, Load from Square, item editor (photo upload via `/api/admin/classes/photo.json`, name, price, per person/event, cost, tags, hidden), saved packages (rename, delete), settings.
- **Customer page** (Invitation artboard): polaroids, "An Evening of Making", facts, ticket picker (Our pick preselected), menu with dotted leaders and normal prices, normal crossed vs price, "Always included", reserve card (total, deposit, "Kindly reply by <date>", party terms link), "Questions? Text us at (256) 464-1710". States: open, updated ("Updated <date>"), paying-in-form, declined (try again inline), price changed ("This quote just changed. Reload to see it."), time taken, checking, paid receipt (package, paid, due, Pay the rest via the pay link, date, host page link), cancelled, closed ("This quote is no longer available. Text us at (256) 464-1710.", tap-to-text).
- **Flyer**: one US Letter page, Invitation look, visible tiers, QR to the link (`qrcode` SVG), no cost; Print button ("On an iPad: tap Share, then Print").

## 8. Component behavior
- Customer picker calls pick.json once per change. `PaymentForm` with `wallet` (Apple/Google Pay) and card, `amount` = deposit. Closing the wallet sheet is not an error.
- Leaving the quote sheet with unsaved edits uses `useSheetDirty`. Never `window.confirm`.

## 9. Settings
Cap 25%, yellow from 20%, deposit 50%, expiry 14 days. Per quote: deposit %, expiry, place, address, date/time, length, guests, note.

## 10. Open questions
None blocking.

## 11. Out of scope
Customer add-on toggles, customer expiry reminders, online balance without the pay link, editing a paid quote, automatic refunds or cancels, server-rendered PDF (the printable page prints to PDF), quotes for regular weekend parties.

## 12. Acceptance checklist

### Data
- [ ] S-1 [DATA] `quote-menu` store holds items, packages and settings with CAS writes; readers default settings to 25/20/50/14 (MVP.1, MVP.5)
- [ ] S-2 [DATA] `quotes` is in `PG_STORES`; keys `q-`, `t-`, `r-` written in that order; token is 32 hex from crypto random (MVP.6)
- [ ] S-3 [DATA] PartyRecord accepts `origin:'quote'`, `quote`, `place`, `address`; PartyItem kind `'quote'`; existing records and tests unaffected (MVP.8)
- [ ] S-4 [DATA] Quote lines snapshot label, photo and cents; menu edits don't change sent quotes (MVP.4)

### API
- [ ] S-5 [API] Every admin quote route returns 401 without the admin cookie (MVP.1)
- [ ] S-6 [API] `sync-square` lists every item variation in every category, keeps owner cost/tags/hidden, clears `gone` on return, changes nothing on a partial sync (MVP.1)
- [ ] S-7 [API] First menu GET with no prior sync runs the sync (MVP.1)
- [ ] S-8 [API] `save-item` validates name and cents and stores photo, per, cost, tags (MVP.1)
- [ ] S-9 [API] Saved packages add to a quote at today's menu prices (MVP.2)
- [ ] S-10 [API] `draft.json` returns the open quote on repeat, makes a new one after withdrawn/expired, and needs `force` on a Booked request (MVP.3)
- [ ] S-11 [API] Guard table enforced for view, pick, pay, save, send, resend, withdraw, reopen (MVP.6, MVP.9)
- [ ] S-12 [API] `save.json` refuses stale versions and over-cap without `overCapOk` on sent quotes (MVP.4, MVP.5)
- [ ] S-13 [API] `send.json` refuses no tiers, incomplete, over cap, closed time, and time taken (naming the clash) (MVP.5, MVP.6)
- [ ] S-14 [API] `send.json` holds under `partyId` with TTL to expiry, texts and emails the link, sets `sent`, request `quoted` (MVP.6)
- [ ] S-15 [API] `withdraw` releases the hold; `reopen` re-holds with a new expiry and clears `expiryTold` (MVP.6)
- [ ] S-16 [API] `view.json` never returns cost, margin, owner names or history; draft/expired/withdrawn/unknown return the same closed body (MVP.7)
- [ ] S-17 [API] `view.json` counts a view only without a valid admin cookie (MVP.10)
- [ ] S-18 [API] `pick.json` sets picked without bumping `version`; 410 when closed; 404 for a hidden tier (MVP.10)
- [ ] S-19 [API] `pay.json` refuses closed, hidden tier, price changed, busy and time taken with nothing charged (MVP.9)
- [ ] S-20 [API] A repeat `pay.json` after success returns the same `partyId` and charges nothing (MVP.9)
- [ ] S-21 [API] Public routes are rate limited and return 503 on `partyWritesRefusal` (MVP.8)

### Logic
- [ ] S-22 [LOGIC] Target = midpoint ÷ guests: 25 guests at 1000-2500 → $70 (MVP.3)
- [ ] S-23 [LOGIC] Tier prices 80/100/130% → $56/$70/$91 (MVP.3)
- [ ] S-24 [LOGIC] Each tier's normal per person ≤ price ÷ (1 − cap); empty tiers omitted (MVP.3)
- [ ] S-25 [LOGIC] Draft prefers items tagged to the crafters and `holiday` in Nov–Dec (MVP.3)
- [ ] S-26 [LOGIC] Draft maps `yours` → away, empty crafters → both, length default 2 h, empty start → Send blocked (MVP.3)
- [ ] S-27 [LOGIC] Meter thresholds from settings: <20 green, 20–25 yellow, >25 red (MVP.5)
- [ ] S-28 [LOGIC] Normal per person adds per-event lines ÷ guests, rounded up (MVP.5)
- [ ] S-29 [LOGIC] Deposit = round(total × depositPct), default 50 (MVP.8)
- [ ] S-30 [LOGIC] Hold transitions follow the table (move, resize, place switch, expiry later/earlier, withdraw, reopen) (MVP.6)
- [ ] S-31 [LOGIC] Every quote write runs inside `withPartyLock(partyId)` and re-reads first (MVP.9)
- [ ] S-32 [LOGIC] Pay creates the party record first, then charges only the deposit item via the pay-link core (MVP.8)
- [ ] S-33 [LOGIC] Paid: `confirmTime` under the same id reports no overlap; book has exactly one entry for the slot (MVP.8)
- [ ] S-34 [LOGIC] Paid: balance item added unpaid; the pay link then charges only the balance (MVP.8)
- [ ] S-35 [LOGIC] Paid: quote `paid`, request `booked`, owners email + text, customer confirmation (MVP.8)
- [ ] S-36 [LOGIC] Declined: record created in this request is removed, quote back to picked, nothing charged (MVP.9)
- [ ] S-37 [LOGIC] Unclear: quote stays paying, page says checking, nothing auto-refunded (MVP.9)
- [ ] S-38 [LOGIC] TTL quote holds raise no party warnings, To decide or orphan items (test only) (MVP.6)
- [ ] S-39 [LOGIC] Admin calendar and print schedule label a quote hold "Quote hold: <name>" (MVP.6)
- [ ] S-40 [LOGIC] Class guard warns when a class would land on a live quote hold (MVP.6)
- [ ] S-41 [LOGIC] Expiry sweep texts owners once per expired unpaid quote (CAS before text) (MVP.10)
- [ ] S-42 [LOGIC] Request status never downgrades `booked`; withdraw returns `quoted` → `new` (MVP.10)
- [ ] S-43 [LOGIC] Hiding the picked tier reverts picked → sent (MVP.4)
- [ ] S-44 [LOGIC] Away quotes never hold the studio and book with `place:'away'` and the address (MVP.12)
- [ ] S-45 [LOGIC] Café cost import fills `costCents` on matching items, leaves others null, and re-sync keeps them (MVP.1)
- [ ] S-46 [LOGIC] Quote-party consumers: order line names, pay-link and email copy, refund line, register/terms (no studio fee or craft minimum), crew money "crafts included", guest-edit and remove-item refusals (MVP.8)

### UI
- [ ] S-47 [UI] Request sheet shows Make a quote / Open quote, the quote chip and the updated Next hint (MVP.10)
- [ ] S-48 [UI] Quote sheet opens at `#quote-<requestId>` as a centred card on iPad and Close returns to the request (MVP.4)
- [ ] S-49 [UI] Quote sheet edits: facts, target re-draft, swap/add/remove lines, one-off line, saved package, rename, photo, price, hide, note, deposit %, expiry (MVP.4)
- [ ] S-50 [UI] Over-cap confirm is in-sheet, asked once per send; time-taken panel names the clash and offers Send without holding (studio) (MVP.5, MVP.6)
- [ ] S-51 [UI] Quote menu under More: search, tags, Load from Square, item editor with photo upload, saved packages, settings (MVP.1, MVP.2)
- [ ] S-52 [UI] Customer page matches the Invitation artboard at 390px with no sideways scroll, bare layout, no analytics (MVP.7)
- [ ] S-53 [UI] Customer page shows Updated, declined, price changed, time taken, checking, paid receipt, cancelled and closed states (MVP.4, MVP.7, MVP.9)
- [ ] S-54 [UI] Apple Pay / Google Pay / card for the deposit; closing the sheet keeps the packages (MVP.8)
- [ ] S-55 [UI] Printable flyer fits one US Letter page with a QR to the link and no cost (MVP.11)
- [ ] S-56 [UI] Admin party sheet and staff views show the private-event badge, package lines, guest count, crafts included, and the address for away events (MVP.8, MVP.12)
- [ ] S-57 [UI] Owner can set At the customer's place with an address (MVP.12)

## Concerns walk-through
- **i18n**: N/A. The site is English only.
- **Responsive** (manual): customer page phone-first at 390px (S-52); owner screens on iPad as centred cards (S-48); flyer at US Letter (S-55).
- **Error handling** (specialist at code review): every refusal has a named `why` and a one-sentence customer message (S-53); charge outcomes follow the pay-link path (S-36, S-37).
- **Security** (specialist at code review): 32-hex random tokens, identical closed responses for unknown/draft/withdrawn, no cost or owner data in public JSON (S-16), rate limits (S-21), admin cookie on every admin route (S-5), test-site write refusal.
- **Test strategy** (manual): vitest on the temp-dir stores; Square and messaging mocked as in `tests/lib/parties/checkout.test.ts`; one end-to-end test from draft to paid to balance paid; a $1 card deposit on the dev preview before m3 is ticked; test texts only to Kaden.
