---
name: site-reorg-redesign-jul2026
description: "Approved site reorg + homepage redesign plan (Jul 11 2026) — IA decisions, what got killed, plan doc location"
metadata: 
  node_type: memory
  type: project
  originSessionId: bf28e69f-a6ae-4ee7-bf44-6325cfb8aff9
---

Approved AND EXECUTED 2026-07-11 via team-dev (5 parallel implementers + per-task spec/quality gates). 11 commits on `kaden/site-reorg`, pushed to dev (free preview). Production merge still pending Kaden's call. Suite 321 green (baseline grew 313→321 with new tests). Plan at `docs/plans/2026-07-11-site-reorg-redesign-plan.md` (committed to repo). Follow-ups deferred: dead `shared/Lightbox.tsx` + `shared/DateRangePicker.tsx` (zero importers, cleanup later); mobile visual pass not eyeballed (viewport resize blocked — check preview on phone); Pixel Agents (~/source/pixel-agents, server localhost:3100) auto-installed 14 Claude hooks into ~/.claude/settings.json — characters only appear for sessions started after install.

Core decisions:
- **IA**: four offerings — Open Studio (new page `/open-studio`), Workshops, Parties (`/book`), Take-Home Kits (future; teaser only). Nav: Open Studio · Workshops · Parties · What's On · About + "Book a Party" header pill.
- **Homepage = storefront**: photo hero + 2 CTAs, 4 offering photo-cards with price anchors, how-it-works strip, live upcoming workshops (deeplink `/workshops?w=<id>`), visit-us block, self-hiding grand-opening banner. Party page's formula (photo under headline + concrete prices) is THE template — Kaden confirmed the photo is what makes /book feel professional.
- **Killed**: gallery (page → 301, `features.gallery: false`, content collection deleted — socials cover it); workshop search + date filters (overkill for a few months of inventory); fake About copy ("Elena Marchand 2019" was fabricated template text — replaced with true placeholder pending Kaden's real story).
- **Calendar stays standalone** as "What's On" (`/calendar` URL kept): list-first day cards, month grid behind toggle — because parties + workshops + open studio hours all live there (Kaden's explicit correction to my fold-into-workshops idea).
- **Waiver** exposed in footer + Open Studio page.
- Content (real/generated photos, about story) comes from Kaden AFTER the reorg lands; image paths under `public/images/home/` are the file-drop contract.

Gotchas baked into the plan (from review swarm): `service-info.json` wraps payload in `{data:…}`; workshop `startTime` is raw ISO; calendar event ids are `workshop-`-prefixed (use `e.href` not `e.id`); repo had NO `npm test` script (plan adds `"test": "vitest run"`); `tests/components/workshops/WorkshopExplorer.test.tsx` asserts the old toggle UI.

Take-home kits: color-scheme themes (gold, silver, rainbow, blue) to keep SKUs simple, [[offering-model-jun2026]]. Workshops booking push (share links, group signups like parties) is a separate future project.
