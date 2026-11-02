---
name: party-data-rebuild
description: "Real party data (2026-07-08): crafts are now catalog ITEMS not modifiers; Whole Studio Party service + Party Crafts category; TEST data + all junk deleted; open studio item needs rebuild"
metadata: 
  node_type: memory
  type: project
  originSessionId: 2c522605-cdf5-44fc-91b1-cd64621dda34
---

On 2026-07-08 the whole Square catalog was wiped of junk and party data was rebuilt REAL (was all `TEST —` prototype data before). Supersedes the modifier-based craft model in [[offering-model-jun2026]].

## Current real party objects (production Square)
- **Whole Studio Party** — bookable `APPOINTMENTS_SERVICE`, $200 flat / 2h. `catalogItemId: ZMSLASCRBGJ7JE3MJVOVJUSA`.
- **Party Crafts** category — `YJYZ5FAHKRCFH634JSDJEZVQ`. Crafts live here.
- **Junk Journaling** craft — `AWQTIIWL4Q7ISM4D6ZYBKL6K`, $15/head, has description, NO image yet.

## Architecture change: crafts are ITEMS, not modifiers
Party crafts used to be modifiers in a modifier list (no description/image possible). Now each craft is a **catalog ITEM** in the Party Crafts category: name + per-head price (its variation) + `descriptionHtml` + optional image (`imageIds`). Booking is unchanged — `book.json` just needs `{id, name, perHeadCents}` and computes line items itself; the service item ($200 base) is what's actually booked.
- `service-info.json` lists items in `partyCraftCategoryId`, returns `{id, name, perHeadCents, description, imageUrl}`.
- `PartyModal.tsx` craft step shows image thumbnail + a **Details accordion** for the description.
- Crafts needing customization (e.g. embroidery name + thread color) will attach modifier lists to that craft ITEM — modifiers are still the right tool for per-craft options, just not for the craft list itself.

## Scripts (API key, no cookie)
- `scripts/seed-party.ts` — find-or-create Party Crafts category + Whole Studio Party service; prints config IDs.
- `scripts/add-party-craft.ts --name --price --description` — add/update a craft item. Then `upload-workshop-image.ts <itemId> <img> --role card` for its picture.

## Party schedule (config-driven, 2026-07-08)
Slots are GENERATED from `partyDays` in party.config.ts, not filtered from Square availability (that only surfaced on-the-hour times). 90-min parties, 1-hr gaps: **Sat 9:00/11:30/2:00/4:30** (wrap by 7pm), **Sun 1:00/3:30** (wrap by 6pm). `party-slots.ts` = `partyStartsForDate`/`partyStartsInRange`/`removeBooked`; used by availability.json, available-dates.json, calendar.json. Booked slots dropped via `listBookings`.
- **Square hours/interval — RESOLVED 2026-07-08.** `bookings.create` validates against Kaden's Appointments availability. His hours already covered the windows (Sat 9am–evening, **Sun open from noon** — the "Sunday starts 2pm" worry was wrong). The real blocker was **Appointment intervals = 60 min** (Online booking → Settings → Scheduling → Schedule windows), which made half-hour starts (11:30/4:30/3:30) unbookable. **Changed to 30 min** → verified all 6 party starts now returned by searchAvailability. Setting is `app.squareup.com/dashboard/appointments/booking/settings`.

## Personalized (made-to-order) crafts
Tagged via a Square marker category **"Personalized"** (`personalizedCategoryId: FD7DGZWHHJ76KF7YWAWKDWYS`). `add-party-craft.ts --personalized` adds the item to it; service-info returns `personalized: true`; PartyModal shows a required non-refundable acknowledgment checkbox that blocks Continue. Patch & Personalize is tagged; Junk Journaling isn't. Adding future personalized crafts = just pass `--personalized`, UI reacts automatically.
- `service-info.json` is now **`Cache-Control: no-store`** + modal fetches `{cache:'no-store'}` — DON'T re-add caching; the live price + personalized flag must reach the booking flow immediately.

## Payment model — deposit + pay-at-register (BUILT 2026-07-08)
**$200 studio fee charged online to book; per-head craft cost settled at the Square register day-of for actual attendance** (invoice only as a fallback). Kills the no-show refund problem (never charge per-head until people are present). Personalized crafts (Patch) are the exception — ring up the committed/monogrammed count since bags are pre-made. No gift cards.
- `book.json` charges only `partyConfig.basePriceCents`; craft recorded on the booking (specialRequests) but not charged. `party-pricing.craftTotalCents` used client-side for the estimate display only.
- PartyModal: guest count is an "estimate", summary shows "Studio fee — due today $200" + craft as an estimate paid at the studio, pay button "Pay $200 studio fee", confirmation notes crafts paid on the day (+ email note when `personalized`). Verified end-to-end.
- Day-of: cashier rings up the craft item × headcount on the Square register (items already priced per-head).
- **No online volume discount** (priceBreakTiers = single flat 0% tier). If a group discount is wanted, apply it at the register (a saved Square discount).
- **Multi-variant crafts show a price RANGE, not a variant step.** A craft item with >1 ITEM_VARIATION → service-info returns min/max per-head; PartyModal shows "$30–$40/person" and notes the exact variant/price is chosen at the register. No variant-selection screen needed (checkout is at the counter). Feature verified 2026-07-08 with a throwaway "Pottery Painting" craft (since deleted).

## ⚠️ Broken / TODO
- **Open Studio is broken**: `partyConfig.openStudioItemId` (`3ACHZ6GJKU4SVCF6RN3QJZE4`) was deleted in the cleanup — needs a real rebuild.
- Only real workshop items kept: **Brisket 101**, **Y2K Mom's Night Out** (+ images). Y2K still has one leftover Aug-21 schedule that Square's UI errored on cancelling — harmless, workshops are on hold ([[project_homegrown-launch-date]]).
- Junk Journaling (and future crafts) need image assets uploaded.
- Verified 2026-07-08 in the live `/book` flow: service + craft + accordion + availability (3 slots) all work.

**Parties Only marker (2026-10-09, a2355e2):** Square category "Parties Only" `JQ3QDTNFUZQH3H2DKP3IQTDA` (`partyConfig.square.partyOnlyCategoryId`) hides a craft from the Craft Café menu but keeps it for parties; `scripts/set-party-only.ts --name "…" [--off]`. Patch & Personalize (personalized patch bags) is tagged. Same pattern as Most Popular / Personalized.

**Gotcha (2026-10-09):** Square CLEARS an item description re-sent unchanged unless all three fields (description, descriptionHtml, descriptionPlaintext) round-trip together. A price-only update via the old add-party-craft.ts blanked Bubble Letter Keychains + Decoupage Succulent Pots (restored). Fixed in 1c8fee8: updates round-trip the full saved item, send description only when changed, read back and fail if empty. Always verify descriptions after any catalog write.

**Craft lineup 2026-10-09 (14 in Square, Kaden: "Love it"):** renamed Bubble Letter Keychains → Paracord Bubble Letter Keychain, Keychain Bar → Gold Carabiner Scarf Keychains (one each). New, all $15 + Parties Only: Pony Bead Keychains (3+, styles confirmed after booking), Instant Photo Frames (named off "Polaroid" — trademark caution after the C&D), Trinket Bowls & Tins, Snail Mail, Bookmark Trio (alcohol ink + Mod Podge acrylic w/ gold chain + shaker). Mixed Media Notebooks $20 parties-only. Most Popular: Paracord Bubble Letter, Fabric Bulletin Boards, Patch & Personalize. Photos still needed for the 5 new ones. "Ages 8 and up" assumed on new ones.

**Replacing a craft photo:** `upload-workshop-image.ts` APPENDS (the site uses imageIds[0], so the old photo keeps showing). After uploading, round-trip the full item with `imageIds = [newId]` (full round-trip keeps the description). Done for Junk Journaling 2026-10-09.

**Hiding a craft without deleting it (2026-10-09):** move it to Square category "Not on Website" `NTTWFECPGKJUBITPMP5JQNP4` for BOTH categories AND reportingCategory (Square re-adds the reporting category to categories, and ignores an empty categories list). Site reads only the Crafts category. Doodle Dishes (PFR3VLKFADLRFZXB4WTUHF3J) hidden until it has a photo; restore = categories+reportingCategory back to Crafts YJYZ5FAHKRCFH634JSDJEZVQ.
