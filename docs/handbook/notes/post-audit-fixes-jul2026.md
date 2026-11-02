---
name: post-audit-fixes-jul2026
description: "Jul 10 2026 post-audit fix batch — corrected business facts ($300 fee, parties never drop-off, agreement v2) and the branch that landed them"
metadata: 
  node_type: memory
  type: project
  originSessionId: 2a01f9ba-c887-493d-bb94-505413ba1e60
---

Branch `kaden/post-audit-fixes` (28 commits, Jul 10 2026) landed the full post-audit fix batch for party booking/waiver/check-in. Plan: repo `docs/plans/2026-07-10-post-audit-fixes-plan.md`.

**Corrected business facts (supersede older memories):**
- Studio fee is **$300** flat (`partyConfig.basePriceCents: 30000`), NOT $200 — Kaden confirmed 2026-07-10. Craft cost still per-head at the studio.
- **Parties are NEVER drop-off.** Drop-off is a studio-only decision (camps/PNO via staff console toggle). Every minor at a party needs a responsible adult present — RSVP requires naming one if the signer isn't attending (`responsibleAdult` on WaiverRecord).
- **Participation agreement is v3**: v2 rewrote §4(c) supervision (parties not drop-off); v3 (2026-07-10) set the legal entity — **Goodell Holdings, LLC d/b/a Homegrown Studio**. The text is SHA-256-hashed into records — any edit needs a version bump (one-way door). Attorney review of the v3 text pending (NEEDS-FROM-KADEN).

**Key architecture added:** shared `blob-store.ts` (fail-loud + CAS `setIfMatch`); `studio-time.ts` (all display times America/Chicago); book-before-charge flow with slot re-validation + `releaseBooking`; Gmail email via nodemailer (env-gated `GMAIL_USER`/`GMAIL_APP_PASSWORD`); rate limiting (`rate-limit.ts`) + reuse tokens (`reuse-token.ts`, `LOOKUP_SIGNING_SECRET`); RSVP household upsert (re-RSVP = edit) + duplicate-kid flags; custody audit log (`CheckinEvent[]`, server-only); event context (`{kind: party|workshop|open-studio}`) — party index keys unchanged (`party-index-{id}`), new kinds use `event-index-{kind}:{id}`; staff `coverage.json` door-check endpoint.

**Netlify env (ALL SET 2026-07-10, verified working):** `PROVIDER_MODE=square` (was NEVER set before — the deployed site had been silently serving mock catalog data; prod builds now throw on mock, escape hatch `ALLOW_MOCK_PROVIDER=1` local only), `LOOKUP_SIGNING_SECRET` (generated), `GMAIL_USER=kaden@homegrowncraftstudio.com` + `GMAIL_APP_PASSWORD` (Workspace app password; SMTP send verified end-to-end). Mailbox facts: `contact@homegrowncraftstudio.com` is a real alias routed to Kaden's wife; `hello@homegrowncraftstudio.com` (the address shown in site.config contactEmail) may NOT exist — Kaden to either add it as a Workspace alias or change the site config to contact@. An unused app password also exists on kaden.goodell@gmail.com (created by mistake; Kaden advised to delete). ✅ RESOLVED: `netlify env:list` on 2026-09-28 shows `STAFF_PASSCODE` SET (the July 'missing' finding is stale).

Test suite fully green after this branch (313 tests; the 2 long-failing square/booking tests were a mock name mismatch — `bulkUpsert` vs SDK's `batchUpsert` — fixed).

**⚠️ Netlify Blobs gotchas (learned the hard way 2026-07-10/11):**
- Default consistency is EVENTUAL — any read-then-conditional-write (CAS) or read-after-write flow needs `getStore({ name, consistency: 'strong' })`.
- The LOCAL `netlify dev` BlobsServer returns NO etag from `getWithMetadata` (writes do return one) — a CAS loop keyed on read-etags silently loses every write after the first on localhost. `blob-store.ts setIfMatch(key, json, etag, exists)` handles it: no-etag-but-exists → unconditional write fallback. Kaden runs `netlify dev` locally (port 4321), so localhost exercises the BLOBS path via `.netlify/blobs-serve/`, NOT the fs fallback.
- The kv fs fallback is cwd-anchored (`.data/<store>/`) with `BLOB_STORE_FS_DIR` env override; `tests/setup.ts` points it at a temp dir per run (module-URL-relative resolution wrote junk into src/lib/ under vitest).

Related: [[offering-model-jun2026]] [[party-conversion-redesign]] [[legal-compliance-jul2026]]
