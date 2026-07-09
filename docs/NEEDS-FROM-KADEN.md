# Needs From Kaden — Party Conversion Redesign

Everything below is intentionally left empty/ungated so no fake content ships.
Each item lists the exact file + field to fill. The UI hides the element until
the field is filled — fill it and the feature appears, no code changes needed.

## Content you need to supply

| # | What | Where | Effect when filled |
|---|------|-------|--------------------|
| 1 | **Hero lifestyle photo** — a real shot of a group crafting at the table (landscape, ~1600px wide) | Drop in `public/images/`, set `partyContent.hero.heroImage` in `src/config/party-content.ts` | /book hero becomes photo-backed instead of text-only |
| 2 | **Pottery Painting craft photo** | Upload to the Square catalog item (Party Crafts → Pottery Painting), e.g. via `scripts/add-party-craft.ts` image path | Card + modal show a photo instead of the text placeholder |
| 3 | **Reschedule / cancellation promise** — one sentence, e.g. "Free reschedule up to 7 days before your party." | `partyContent.trust.reschedulePolicy` in `src/config/party-content.ts` | Shown next to the pay button (big trust win — decide this one first) |
| 4 | **Text-us phone number** — a real SMS-able number | `partyContent.textNumber` in `src/config/party-content.ts` | "Questions? Text us" appears in the booking modal footer |
| 5 | **FAQ answers** — food/drinks/cake policy, decoration policy, cancellation policy | The empty `a: ''` entries in `partyContent.faq` in `src/config/party-content.ts` | Each answered entry renders on /book AND gets FAQPage JSON-LD (SEO/AEO) |
| 6 | **Real footer contact info** — the footer still shows `(555) 123-4567` / `123 Main St, Anytown, CA` | `siteConfig.contactPhone` + `siteConfig.address` in `src/config/site.config.ts` | Site-wide |

## Actions you need to take (or approve me doing via API)

| # | What | How |
|---|------|-----|
| 7 | **Apple Pay domain registration** — required before the Apple Pay button will appear on the live site | Run `npx tsx scripts/register-apple-pay-domain.ts` with the production `SQUARE_ACCESS_TOKEN` in `.env` (one-time). Google Pay needs nothing. |
| 8 | (Later, post-launch) Testimonials, party photos, Instagram embeds | `siteConfig.testimonials` currently holds sample quotes — replace with real ones when they exist; /book intentionally does not render them until then |

## Explicitly NOT built (would be fake)

- "Most loved" / "Most popular" craft badges — needs real booking data
- Occasion tags per craft ("girls' night favorite") — needs your call per craft
- Testimonial band on /book — needs real quotes
