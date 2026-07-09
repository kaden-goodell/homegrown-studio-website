# Needs From Kaden — Party Conversion Redesign

Everything below is intentionally left empty/ungated so no fake content ships.
Each item lists the exact file + field to fill. The UI hides the element until
the field is filled — fill it and the feature appears, no code changes needed.

## Content you need to supply

| # | What | Where | Effect when filled |
|---|------|-------|--------------------|
| 1 | **Hero lifestyle photo** — a real shot of a group crafting at the table (landscape, ~1600px wide) | Drop in `public/images/`, set `partyContent.hero.heroImage` in `src/config/party-content.ts` | /book hero becomes photo-backed instead of text-only |
| 2 | **Pottery Painting craft photo** | Upload to the Square catalog item (Party Crafts → Pottery Painting), e.g. via `scripts/add-party-craft.ts` image path | Card + modal show a photo instead of the text placeholder |
| 3 | ~~Reschedule promise~~ **DONE 2026-07-09**: "Free reschedule up to 7 days before your party." | Tweak wording anytime in `partyContent.trust.reschedulePolicy` | Live at the pay button |
| 4 | **Business phone number** — decide provider (OpenPhone / Square Messages Plus / Google Voice), then fill BOTH `partyContent.textNumber` (party modal "text us") and `siteConfig.contactPhone` (footer — hidden until filled) | `src/config/party-content.ts` + `src/config/site.config.ts` | "Questions? Text us" + footer phone appear |
| 5 | **FAQ answers** — food/drinks/cake policy, decoration policy, cancellation policy | The empty `a: ''` entries in `partyContent.faq` in `src/config/party-content.ts` | Each answered entry renders on /book AND gets FAQPage JSON-LD (SEO/AEO) |
| 6 | ~~Footer address~~ **DONE 2026-07-09**: 525 Hughes Rd, Suite F, Madison, AL 35758. Phone gated until #4 decided. | — | Live site-wide |
| 6b | **Delete Pottery Painting** after showing your wife the price-range display — it's a demo item | `Square Dashboard → Items`, or ask me (it's item `6H3P6JRMGWDL6FQKFX3TFTPR`) | Card disappears from /book |

## Actions you need to take (or approve me doing via API)

| # | What | How |
|---|------|-----|
| 7 | **Apple Pay — final step after next production deploy** | Square's verification file is already committed at `public/.well-known/apple-developer-merchantid-domain-association`, but Apple checks it on the LIVE domain. After the next `dev → main` production deploy, run `npx tsx scripts/register-apple-pay-domain.ts` once (or ask me) — until then the Apple Pay button just doesn't render. Google Pay needs nothing and already works. |
| 8 | (Later, post-launch) Testimonials, party photos, Instagram embeds | `siteConfig.testimonials` currently holds sample quotes — replace with real ones when they exist; /book intentionally does not render them until then |

## Explicitly NOT built (would be fake)

- "Most loved" / "Most popular" craft badges — needs real booking data
- Occasion tags per craft ("girls' night favorite") — needs your call per craft
- Testimonial band on /book — needs real quotes
