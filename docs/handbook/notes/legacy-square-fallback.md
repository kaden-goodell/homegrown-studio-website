# Old Square booking fallback (ends 2027-01-15)

Kaden, 16 Nov 2026: classes and parties switch to the new booking system together.
The old Square booking stays as an instant fallback, with a guaranteed end.

## How to flip
- **/admin › More › Online booking › Runs on.** Parties and Classes & workshops each
  have *Old Square booking* / *New booking system*. Switch both to *New booking
  system* to go live; switch both back to *Old Square booking* if anything goes
  wrong. Takes effect within about a minute, no deploy. Bookings already made stay
  where they are (Square ones in Square, new ones in /admin and /staff).
- Default with nothing saved: **Old Square booking** for both, so deploying moves nothing.
- The owners' test link (same screen, *Copy party test link* / *Copy class test link*)
  books on the new system on that one device while everyone else is still on Square:
  use it for the $1 test class and the test party.
- Hosting setting `BOOKING_SYSTEMS` (Netlify) sets the default until an owner saves:
  `own`, or `parties=own,classes=square`. Production leaves it unset.
- While classes are on Square, our own classes are hidden from /workshops, the
  calendar, the sitemap and the new-class emails, and can't be booked online (door
  sales on /staff still work). Square's classes list and book as always.
- While parties are on Square, /book's panel books through today's checkout (a
  Square Appointments booking plus the $300 charge). Extras other than a themed
  table and packages other than the whole studio are refused on that path.

## After 2027-01-15
/admin no longer offers *Old Square booking*, everything reads as the new system,
and `tests/legacy-fallback-sunset.test.ts` fails until this is deleted:

- `src/lib/legacy-square/` (party-book-square-flow.ts, party-square-flow-adapter.ts)
- `tests/legacy-square/`
- `src/config/legacy-fallback.ts`
- `tests/lib/booking-system-switch.test.ts`
- `tests/legacy-fallback-sunset.test.ts` (last)
- Every block marked `LEGACY FALLBACK` (run `grep -rn "LEGACY FALLBACK" src tests netlify`):
  - `src/lib/booking-switch.ts`: SystemKind, envSystems, legacyFallbackAvailable, sunset, and `system` in the document/state/input/validation/save
  - `src/lib/bookings-gate.ts`: ownSystemNow, systemForEveryoneNow
  - `src/pages/api/party/book.json.ts`: the hand-off to bookPartyOnSquare
  - `src/pages/api/classes/book.json.ts`, `promo.json.ts`, `waitlist.json.ts`: the ownSystemNow refusals
  - `src/pages/api/workshops.json.ts`, `calendar.json.ts`, `sitemap.xml.ts`, `jobs/signup-emails.json.ts`, `src/pages/classes/[id].astro`: the "classes on Square" hiding
  - `src/pages/api/admin/online-booking.json.ts` and `src/components/admin/sheets/OnlineBookingSheet.tsx`: the *Runs on* block, fallbackUntil/fallbackAvailable
  - `tests/setup.ts`: `BOOKING_SYSTEMS = 'own'`
  - `tests/api/classes-book.test.ts`, `tests/api/workshops-list.test.ts`: the "old Square booking" cases
- Netlify: the `BOOKING_SYSTEMS` setting (any context).
- Then: turn off online booking for the party service in Square, and **cancel Appointments Plus ($49/mo)**.
