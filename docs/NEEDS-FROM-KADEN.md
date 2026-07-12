# Needs From Kaden

Verified against the live Netlify environment and the codebase on **2026-07-11**.
Each open item lists the exact file/place to act on. UI elements gated on empty
fields stay hidden until filled — no code changes needed to "turn them on."

## 🔴 Blocking before launch (Sept 1)

1. **Set `STAFF_PASSCODE` in the Netlify environment** — verified MISSING 2026-07-11.
   Auth fails closed (no security risk), but the staff console — kits board,
   party check-in, rosters — cannot log in on the deployed site until this is set.
2. **Attorney review of Participation Agreement v3** (`src/config/waiver-content.ts`),
   including the new **kit-rental addendum §6a** (`docs/WAIVER.md`) — return-clean
   clause, deposit withholding, $25 retrieval fee. Entity: Goodell Holdings, LLC
   d/b/a Homegrown Studio.
3. **Physical kit inventory purchase** — Gilded + Prism at 60 settings each
   (ledger sells 45), 3 hero sets each; Sweet Sixteen shares Gilded's tableware,
   needs only its own consumables/staging.

## 🟡 Do when ready (feature upgrades itself, nothing broken meanwhile)

4a. **Quo reminder texts — key DONE, carrier registration PENDING.**
   `QUO_API_KEY` + `QUO_FROM_NUMBER` are set in Netlify + `.env` (verified
   against the API 2026-07-12). ⚠️ But the number reports
   `messaging: US restricted` — **US carrier registration (A2P/10DLC) is not
   complete**, so API texts will fail until it is. Go to Quo → Settings →
   Trust Center → US messaging registration and submit Goodell Holdings, LLC
   (+ EIN); approval takes days. Also confirm prepaid credits (~$0.01/text).
   The "💬 Text reminder" button fails politely until then.

4. ~~Address autocomplete key~~ **DONE 2026-07-11** — `PUBLIC_GOOGLE_PLACES_KEY`
   set in Netlify + local `.env`, verified live (suggestions + selection working
   end-to-end). Key is from the *second* Google project (…W2gbrU); the first
   project's key (…pRbSrg) is dead weight — delete that key/project in
   [console.cloud.google.com](https://console.cloud.google.com) when convenient,
   and optionally add a $5 budget alert. Free tier: 10k requests/month
   (~1,500 typed addresses), then $2.83/1k.
5. **Real photos** — party hero (`/images/party-hero.jpg` is an AI placeholder;
   also serves as every kit-theme card via `kit-content.ts` `photo`) and the six
   theme shots. Drop files, update paths, done.
6. **Kit FAQ copy** (`kit-content.ts` → `faq`, empty = section hidden) and
   per-theme `keeps`/`returns` refinement (drives the contents card + staff
   return checklist). Theme names/tier prices are Claude drafts blessed for
   editing — change `kit-content.ts` + `kit.config.ts`, re-run
   `scripts/seed-kits.ts` (idempotent).
7. **Delete the Pottery Painting demo item** once your wife has seen the
   price-range display (Square item `6H3P6JRMGWDL6FQKFX3TFTPR` — ask me, or
   Square Dashboard → Items). Card disappears from /book on its own.
8. **Verify the FAQ claim "most are $15–$40"** (`party-content.ts` `faq[0]`)
   against the real Party Crafts prices — fix or drop the range.

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
live) · `LOOKUP_SIGNING_SECRET` · `SQUARE_ACCESS_TOKEN`/`SQUARE_ENVIRONMENT` ·
Apple Pay domain verified · business phone (256) 464-1710 in modal + footer ·
footer address · party FAQ (10 answers + JSON-LD) · reschedule promise ·
`features.kits.enabled = true` (kits are live-on-merge, including nav, teasers,
and the party themed-table step).
