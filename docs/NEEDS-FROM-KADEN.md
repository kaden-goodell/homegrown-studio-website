# Needs From Kaden — Party Conversion Redesign

Everything below is intentionally left empty/ungated so no fake content ships.
Each item lists the exact file + field to fill. The UI hides the element until
the field is filled — fill it and the feature appears, no code changes needed.

## Legal review required before Sept 1 opening

- **Attorney review of Participation Agreement v2 §4(c) supervision language** (`src/config/waiver-content.ts`) before the Sept 1 opening — the text now states parties are not drop-off and requires a designated responsible adult for unaccompanied minors. Note: version is now **v3** — the legal entity (Goodell Holdings, LLC d/b/a Homegrown Studio) landed 2026-07-10, so the attorney should review the v3 text as a whole.

## Security environment variable (before Sept 1 opening)

- **Set `LOOKUP_SIGNING_SECRET` in the Netlify environment** (any long random string, e.g. output of `openssl rand -hex 32`) — signs the returning-customer session tokens issued by `/api/waiver/lookup.json` and verified by `/api/waiver/sign.json`. Without it the code falls back to `STAFF_PASSCODE`; in production both routes need the same value, so a dedicated secret is strongly preferred.

## URGENT — before this branch merges

- **PROVIDER_MODE=square must be set site-wide in the Netlify environment.** Deploy previews are production builds — they will fail the build without it. Go to Netlify dashboard → Site configuration → Environment variables and confirm `PROVIDER_MODE=square` is set. (Use `ALLOW_MOCK_PROVIDER=1` only for a local `npm run build` without Square creds — never set it in Netlify.)

## Content you need to supply

| # | What | Where | Effect when filled |
|---|------|-------|--------------------|
| 1 | ~~Hero photo~~ **DONE 2026-07-09** (AI-generated table shot at `/images/party-hero.jpg`) — swap for a real photo of the actual studio table before launch | Replace the file or update `partyContent.hero.heroImage` | Live |
| 2 | **Pottery Painting craft photo** | Upload to the Square catalog item (Party Crafts → Pottery Painting), e.g. via `scripts/add-party-craft.ts` image path | Card + modal show a photo instead of the text placeholder |
| 3 | ~~Reschedule promise~~ **DONE 2026-07-09**: "Free reschedule up to 7 days before your party." | Tweak wording anytime in `partyContent.trust.reschedulePolicy` | Live at the pay button |
| 4 | ~~Business phone~~ **DONE 2026-07-09**: (256) 464-1710 (Quo) — live in the modal "text us" line and the footer | — | Live |
| 5 | ~~FAQ answers~~ **DONE 2026-07-09** — all 10 entries answered and live with FAQPage JSON-LD | Edit anytime in `partyContent.faq` | Live |
| 6 | ~~Footer address~~ **DONE 2026-07-09**: 525 Hughes Rd, Suite F, Madison, AL 35758. Phone gated until #4 decided. | — | Live site-wide |
| 6b | **Delete Pottery Painting** after showing your wife the price-range display — it's a demo item | `Square Dashboard → Items`, or ask me (it's item `6H3P6JRMGWDL6FQKFX3TFTPR`) | Card disappears from /book |
| 6c | Verify the FAQ claim "most are $15–$40" (src/config/party-content.ts faq[0]) against actual Party Crafts catalog prices — adjust or remove the range if it's wrong. | Edit `partyContent.faq[0]` to match reality | Live in FAQ |

## Email configuration (needed for booking confirmation emails)

Booking confirmation emails are sent via Gmail SMTP and are gated on two environment variables. Until these are set, `emailSent: false` is returned and the confirmation screen tells the host to save their party page link instead of promising an email.

**Steps:**
1. Go to your Google account → Security → 2-Step Verification → App passwords
2. Create an app password named "Homegrown Studio" — copy the 16-character code
3. Add to Netlify dashboard → Site configuration → Environment variables:
   - `GMAIL_USER` = kaden@homegrowncraftstudio.com (SET in Netlify 2026-07-10, working)
   - `GMAIL_APP_PASSWORD` = the 16-character app password (no spaces)
4. Add to your local `.env` file for dev testing:
   ```
   GMAIL_USER=your@gmail.com
   GMAIL_APP_PASSWORD=abcdabcdabcdabcd
   ```

Note: Gmail app passwords require 2-Step Verification to be enabled on the account.

## Actions you need to take (or approve me doing via API)

| # | What | How |
|---|------|-----|
| 7 | ~~Apple Pay~~ **DONE 2026-07-09** — domain registered (VERIFIED), button live on Apple devices | — | Live |
| 7b | **Afterpay — deliberately NOT enabled** (Kaden's call 2026-07-09: ~6% merchant fee isn't worth it while bookings are healthy). Code ships dormant; the button self-hides until the account is onboarded. | If bookings ever stall: Square Dashboard → Settings → Payment methods → enable Afterpay. Button appears on the live site with no deploy. | Nothing visible until enabled |
| 8 | (Later, post-launch) Testimonials, party photos, Instagram embeds | `siteConfig.testimonials.items` is currently empty — add real testimonials when they exist. The homepage section (`src/pages/index.astro`) is hidden until `items` is non-empty, so no code change is needed: just populate the array. |

## Explicitly NOT built (would be fake)

- "Most loved" / "Most popular" craft badges — needs real booking data
- Occasion tags per craft ("girls' night favorite") — needs your call per craft
- Testimonial band on /book — needs real quotes

## Take-Home Kits (feature built, flag OFF — flip `features.kits.enabled` in `src/config/site.config.ts` to launch)

- **Theme photos** (`src/config/kit-content.ts` → each theme's `photo`) — all six themes currently use the party-hero placeholder. Drop real files and update paths; no other code changes.
- **Kit FAQ copy** (`src/config/kit-content.ts` → `kitContent.faq`) — empty array = section hidden. Fill with q/a pairs when ready.
- **Per-theme box contents refinement** (`src/config/kit-content.ts` → each theme's `keeps` / `returns` arrays) — current lists are the draft from 2026-07-11 (cake stand, napkins, plates, candles + holders, trays). These drive the contents card and the staff return checklist.
- **Theme names/prices tweaks** — names and tier prices ($75/$100/$125) were drafted by Claude with your blessing to adjust; edit `kit-content.ts` + `kit.config.ts` and re-run `scripts/seed-kits.ts` (idempotent) if you change them.
- **Rental agreement §6a** (`docs/WAIVER.md`) — with the attorney alongside the v3 review; includes the "return it clean" clause and retrieval-fee language. Blocking for LAUNCH, not for build.
- **Physical inventory purchase** — Gilded + Prism at 60 settings each (ledger sells 45), 3 hero sets each; Sweet Sixteen shares Gilded's tableware and needs only its own consumables/staging.
