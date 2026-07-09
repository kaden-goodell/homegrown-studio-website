# Needs From Kaden — Party Conversion Redesign

Everything below is intentionally left empty/ungated so no fake content ships.
Each item lists the exact file + field to fill. The UI hides the element until
the field is filled — fill it and the feature appears, no code changes needed.

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

## Actions you need to take (or approve me doing via API)

| # | What | How |
|---|------|-----|
| 7 | ~~Apple Pay~~ **DONE 2026-07-09** — domain registered (VERIFIED), button live on Apple devices | — | Live |
| 7b | **Afterpay — deliberately NOT enabled** (Kaden's call 2026-07-09: ~6% merchant fee isn't worth it while bookings are healthy). Code ships dormant; the button self-hides until the account is onboarded. | If bookings ever stall: Square Dashboard → Settings → Payment methods → enable Afterpay. Button appears on the live site with no deploy. | Nothing visible until enabled |
| 8 | (Later, post-launch) Testimonials, party photos, Instagram embeds | `siteConfig.testimonials` currently holds sample quotes — replace with real ones when they exist; /book intentionally does not render them until then |

## Explicitly NOT built (would be fake)

- "Most loved" / "Most popular" craft badges — needs real booking data
- Occasion tags per craft ("girls' night favorite") — needs your call per craft
- Testimonial band on /book — needs real quotes
