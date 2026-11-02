---
name: project_rebrand-home-town-studio
description: "REBRAND (Sep 26 2026) — cease-and-desist forces Homegrown Studio → Hometown Studio (ONE word); site-wide swap done 9/26; domain LIVE ourhometownstudio.com 9/27; ALL DIGITAL DONE incl. prod deploy 9/27; only sign/socials/GBP pending"
metadata: 
  node_type: memory
  type: project
  originSessionId: 299a94d3-1458-4718-a60d-4c52fb969376
  modified: 2026-09-26T20:40:15.971Z
---

On 2026-09-26 Kaden said the business received a **cease and desist** over the "Homegrown Studio" name and is **rebranding to "Hometown Studio"** (ONE word — he corrected "Home Town" on 9/26). Same day he said "swap EVERYTHING over".

**Done 9/26 (dev branch):** every customer-facing string in src/, scripts/, tests/, package.json name → "Hometown Studio"; waiver bumped **v2** (d/b/a line; archived docs/waiver-versions/v2.md); Square LOCATION name + businessName renamed via API (new `scripts/rename-location.ts`). `/about` story (`src/content/about/story.md`) is the new origin story naming Hometown Studio; opening date in it is a `{{openingDate}}` token substituted from `src/config/opening.ts` (keeps the single-source rule from [[project_homegrown-launch-date]]).

**9/27 — DOMAIN LIVE:** `ourhometownstudio.com` bought at Cloudflare Registrar (Cloudflare DNS, records DNS-only/grey cloud — NEVER proxy, Netlify needs it), A @→75.2.60.5 + CNAME www→iridescent-croissant-494fc3.netlify.app; Netlify primary domain switched (old domain + www kept as aliases; `netlify.toml` 301s old→new, takes effect on next MAIN deploy); Apple Pay re-registered VERIFIED; repo domain strings swapped (`8bf2c5e` on dev). Square merchant + Quo renamed by Kaden 9/26 (verified). **Google Workspace DONE 9/27 (Claude drove admin.google.com via Chrome):** ourhometownstudio.com is the PRIMARY domain (alias→removed→secondary→primary; no 24h hold hit); users renamed kaden@/catherine@ourhometownstudio.com (old addresses auto-kept as aliases); contact@+bookings@ (Catherine) and accounting@ (Kaden) added on new domain; org name → "Hometown Studio"; DKIM 2048 active, SPF, DMARC p=none→contact@. Old domain stays a secondary domain (all old addresses deliver). GMAIL_USER (Netlify + .env) = kaden@ourhometownstudio.com, SMTP verified; From header = contact@ourhometownstudio.com (needs Gmail "Send mail as" on Kaden's account to not be rewritten — verification goes to Catherine's inbox). Sign-in is now kaden@ourhometownstudio.com. Netlify site name, docs/ folder (historical, left alone), sign (lease requires landlord sign approval — see [[lease-terms]]), Quo number greeting, socials. New domain not yet chosen.

**Why:** Legal — the old name can't keep being used publicly. Don't reintroduce "Homegrown" into new copy; when he says "the rebrand" he means this.

**How to apply:** Write new customer-facing copy as "Hometown Studio" (one word). Ask about the new domain before touching anything URL-related.

**PROD DEPLOYED 9/27** (`dev` force-pushed over `main`, deploy d779fcf): rebrand live at ourhometownstudio.com, old domain 301s to new, bookings still gated (BOOKINGS_OPEN=false), kits hidden. Remaining: physical sign (landlord approval), Google Business Profile, social handles, C&D terms on how long the old domain may forward.

**Logo (2026-10-09):** old Homegrown badge = ~/Downloads/logo.png (2000², white on transparent, only copy). New Hometown version made in ChatGPT by Kaden, cleaned (removed ~284k near-zero-alpha haze pixels): ~/Downloads/"Hometown logo - white.png" and "- dark.png" (#3D3229), 1254². Kaden approved. On the site on DEV 8c83bd4 (header dark logo.png, footer logo-white.png, favicons + share-default.png rebuilt; share card now says Craft Café) — prod waits for Kaden. Sign needs a vector redraw by a designer.

**Logo set on dev (9b1fcb0 + icon commit, 2026-10-09):** header = banner lockup (dark), footer = vines (white), share card = vines (dark), favicon/apple-touch = Kaden's own heart-and-vine (Downloads "favicon.png", recolored dark). Kaden on my image work: "You suck at images lol" — hand him ChatGPT prompts for new art; I only recolor/clean/crop/resize what he makes. Clean files in Downloads: "Hometown logo - {round|vines|banner|heart} - {white|dark}.png", "Hometown favicon - dark.png".

**GBP checked 10/11 (public Maps view):** listing "Hometown Studio" exists (525 Hughes Rd Ste F, (256) 464-1710, "Opens Fri Oct 16") BUT website field still homegrowncraftstudio.com, no hours, no photos, posting off (pre-opening), no category shown. A separate business "homegrown" (event venue, 101 Washington St NE Huntsville, homegrownhuntsville.com) shows in "People also search for" — not ours.

**GBP rechecked 10/17 (public Maps):** hours + category (Art studio) now show; website field STILL homegrowncraftstudio.com (redirects, but shows old name); still no photos. Kaden thought it was fixed. Change is his to make in Business Profile (or with his explicit OK in Chrome).
