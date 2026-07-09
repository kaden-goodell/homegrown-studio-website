# Browse-First Party Flow + Copy Refresh

**Goal:** Let people see the craft options (photos + descriptions + price) and get
excited BEFORE entering the booking modal, then book. Refresh stale marketing copy
to match the current model. Keep calendar deep-links working.

## Current state (as of 2026-07-09)
- `/book` (`src/pages/book.astro`) = a "Book a Party" hero + a single **Book a Party**
  button that opens `PartyModal`.
- `PartyModal` (`src/components/party/PartyModal.tsx`) is a 5-step modal:
  **Date → Craft → Guests → Info → Payment**. The exciting craft photos/descriptions
  are buried inside the **Craft** step (image cards + Read-more accordion).
- Crafts come from `/api/party/service-info.json` → `{id, name, perHeadCents,
  perHeadMaxCents, description, imageUrl, personalized}`.
- Deep-link today: calendar (`WhatsOnCalendar.tsx`) links bookable party slots to
  `/book?start=<ISO>`. `PartyModal` prop `initialStart` preselects the date+slot and
  **jumps to the Craft step** (see the prefill `useEffect`, ~line 183).
- Payment model: $200 studio fee charged online (deposit); craft paid per-head at the
  register. Personalized crafts require a non-refundable acknowledgment checkbox
  (Craft step) before Continue. Multi-variant crafts show a price range ("$30–$40").

## Recommended UX (the design)
Turn `/book` into a **showcase → book** page:
1. **Hero** with refreshed copy (see Copy below).
2. **Craft gallery** — a grid/stack of the craft cards (big image, name, price or
   range, short description). This is the inspiration. Reuse the modal's image-forward
   card look for visual consistency. Each card has a **"Book this craft"** button.
3. Keep/refresh the **How It Works** + **The Whole Studio Is Yours** sections.
4. A general **"Book a Party"** button for people who just want to start.

Two entry intents, one modal:
- **Craft-first** (browse gallery): click a craft → open modal with that craft
  preselected → start at **Date** (Craft step skipped/shown as chosen).
- **Time-first** (calendar): click a slot → `/book?start=` → preselect date+time,
  skip **Date**, land on **Craft** (as today).

## Deep-linking design (answers "how do we deep-link now")
Support two query params on `/book`, and compute the modal's starting step from
whatever is preselected:
- `?start=<ISO>` (from **calendar**) → preselect date+slot, skip Date. **Unchanged** —
  the calendar keeps working exactly as-is.
- `?craft=<catalogItemId>` (from a **shared/external** craft link) → preselect craft,
  skip Craft.
- Both present → skip both → land on **Guests**.
- For same-page gallery clicks, pass the craft directly as a prop (`initialCraftId`)
  instead of a round-trip through the URL.
So: the calendar stays time-first; the gallery adds craft-first; they share one modal.

## Implementation phases

### Phase 1 — Copy refresh
- `src/pages/book.astro` hero + supporting sections: match the current model — private
  **whole-studio** rental, **$200 studio fee** to book + **craft paid per person at the
  studio**, pick your craft, hours Thu–Sun. Remove anything implying full upfront craft
  charge or the old table-reservation model.
- Check the homepage `src/pages/index.astro` (and any offerings/hero components) for
  stale offering copy (parties/workshops/open-studio) and align. This is the "main page
  copy doesn't match" item.

### Phase 2 — Craft gallery on `/book`
- Fetch `service-info` and render the crafts as a gallery on `/book` (SSR shell +
  client fetch, matching the workshops pattern; or reuse a shared card component).
- Extract the modal's craft-card JSX into a shared component so the gallery and the
  modal's Craft step render identically (image, name, `perPersonLabel`, description,
  Read-more).
- Each card: **"Book this craft"** button.

### Phase 3 — Craft preselection in `PartyModal`
- Add `initialCraftId?: string` prop. On load (once `info` is fetched), if set,
  `setSelectedCraft(matchingCraft)` and start past the Craft step.
- Generalize the starting-step logic: currently the prefill `useEffect` hardcodes
  jumping to step 1 (Craft) when `initialStart` matches. Replace with a helper that
  computes the first step: has craft? skip Craft. has slot? skip Date. → land on the
  earliest un-satisfied step.
- **⚠️ Personalized-acknowledgment edge case (important):** the non-refundable checkbox
  lives on the Craft step. If we preselect a personalized craft and skip that step, the
  gate is bypassed. Fix by EITHER (a) showing the acknowledgment on the gallery card
  before its "Book this craft" is enabled, OR (b) surfacing the acknowledgment on the
  first modal step when the preselected craft is `personalized`. Don't lose this gate.
- Range crafts: no special handling needed — `perHeadMaxCents` already flows through.

### Phase 4 — Wire deep-link params
- `/book` (`book.astro`) parse `?start=` (existing) and new `?craft=`; pass to
  `PartyModal` as `initialStart` / `initialCraftId`. (Confirm where `initialStart` is
  currently sourced — grep showed it's a prop; find the mount site.)
- `WhatsOnCalendar.tsx` party slots keep `?start=` links (no change needed). Parties
  aren't craft-specific on the calendar, so no `?craft=` from there.

### Phase 5 — Verify (drive the live `/book`)
- Gallery renders all crafts with images/descriptions/prices (incl. a range craft).
- Click "Book this craft" → modal opens with craft chosen, Craft step skipped.
- Personalized craft → acknowledgment still enforced (not bypassed).
- Calendar slot → `/book?start=` → modal preselects time, Craft step shown.
- Copy on `/book` and homepage matches the current model.

## Notes / gotchas carried from this session
- `service-info` is `no-store` (live price + personalized flag). Don't cache it.
- Party schedule is config-driven (`party-slots.ts` + `partyDays`); Square appointment
  interval is 30 min so half-hour starts book.
- Demo craft **"Pottery Painting"** ($30–$40, item `6H3P6JRMGWDL6FQKFX3TFTPR`) is
  currently live as a range example — delete it before launch (or when done demoing).
- Deposit model: `book.json` charges only `basePriceCents`; craft settled at register.
