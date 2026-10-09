# Needs From Kaden

Verified against the live Netlify environment and the codebase on **2026-07-11**.
Each open item lists the exact file/place to act on. UI elements gated on empty
fields stay hidden until filled — no code changes needed to "turn them on."

## 🔴 Before opening day (Fri Oct 16, 2026) — updated 2026-10-09

1. **Open workshop booking.** Production is `BOOKINGS_OPEN=parties` (parties
   live since 10/9). Set it to `parties,workshops` and redeploy before the first
   classes (Oct 16–18; Pumpkin Pails sign-ups close 24 h before, Sat 1 PM).
   The one workshop "tell me when" sign-up is emailed automatically then.
2. **Workers' comp + payroll with the CPA** (next week). AL counts heads incl.
   LLC members toward the 5-employee trigger; must be in force before crew work.
3. **Live checks of the staff tools** (`docs/CREW-OPERATIONS.md` §5b): mint a $1
   gift card on /staff; comp yourself 2 seats (Square should show you + a guest
   attendee) and cancel them in Square; Sell a seat → **Take payment** in Square
   (unverified that it marks the seat paid).
4. **New workshops**: dates, times, seat counts, drop-off for Bring Your Own
   Bedazzle ($15), Rondelle Bead Necklaces ($35), Doodle Dishes ($35) — plus the
   batch Kaden is sending.

## 🟡 Do when ready

5. **Photos**, then they go live: Doodle Dishes (hidden until then — Square
   category "Not on Website"), Earring Bar, Mosaic Tile Coasters, Potholder Loom
   (café-only; prices set: $35, $10 each, $10 small / $15 large).
6. **Socials rebrand** to Hometown Studio + the new logo (Google Business Profile done).
7. **Google Analytics** — `PUBLIC_GA4_ID` is NOT set in Netlify, so the site sends
   no analytics. Create a GA4 property for ourhometownstudio.com and set it.
8. **Take-home kits** — hidden (`features.kits.enabled=false` + not in
   BOOKINGS_OPEN). Turn on when inventory, kit FAQ copy and theme photos are ready.
9. **Seasonal Paint Craft** — parked until Kaden is ready.

## ✅ Settled 2026-10-09

- Insurance bound: building + GL (covers parents' night out). No liquor coverage
  (no liquor). Workers' comp pending (item 2).
- Participation agreement reviewed by the attorney.
- Storefront sign ordered; install Oct 23.
- Google Business Profile updated to Hometown.
- `STAFF_PASSCODE` set; Quo texting unrestricted (US carrier registration done);
  Pottery Painting demo item gone; the "$15–$40" FAQ claim no longer exists.
- Party page photo is the real studio with AI touch-ups — keep it.

## 📋 Standing decisions (no action unless you change your mind)

- **Afterpay: deliberately OFF for parties** (your call 2026-07-09 — ~6% fee not
  worth it). Code is dormant; enabling it in Square Dashboard → Payment methods
  makes the button appear with no deploy. Kits charge $50 deposits, where
  pay-in-4 is pointless anyway.
- **Testimonials/party photos** — `siteConfig.testimonials.items` empty = homepage
  section hidden. Populate with real quotes post-launch.
- **Not built on purpose** (would be fake): "most loved" badges, per-craft
  occasion tags, testimonial band on /book.

## ✅ Done — verified in Netlify env / live site (for the record)

`PROVIDER_MODE=square` · `GMAIL_USER` + `GMAIL_APP_PASSWORD` (booking emails
live) · `LOOKUP_SIGNING_SECRET` (⚠️ HOM-218: production now THROWS at first
reuse-token use if this is ever unset, rather than silently falling back to a
non-secret default — keep it set) · `SQUARE_ACCESS_TOKEN`/`SQUARE_ENVIRONMENT` ·
Apple Pay domain verified · business phone (256) 464-1710 in modal + footer ·
footer address · party FAQ (10 answers + JSON-LD) · reschedule promise ·
`features.kits.enabled` — **flipped to FALSE 2026-07-18** for the pre-booking
launch (core flows first); flip back with the photos deploy once parties +
workshops are proven live. `ARCHIVE_TO` — optional, defaults to
`kaden@ourhometownstudio.com`; only needed in Netlify if the weekly self-archive
(HOM-217) should land somewhere else.
