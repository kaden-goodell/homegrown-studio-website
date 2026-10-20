---
name: reference_posthog
description: PostHog project for Hometown Studio — US cloud project 656173, env names, what is tracked, privacy rules (no recording on staff/waiver)
metadata:
  type: reference
---
PostHog US cloud, project 656173 (set up 10/9/2026 via `npx @posthog/wizard`, run by Kaden in his own terminal).
- Env: `PUBLIC_POSTHOG_PROJECT_TOKEN` (phc_…) + `PUBLIC_POSTHOG_HOST=https://us.i.posthog.com`; build-time; Netlify **production context only** (previews don't report).
- Loader: `src/components/posthog.astro`; `noRecording` on bare pages (/staff, kiosk) and /waiver — page text there holds names/allergies/pickup people.
- Customer funnel events come from `src/lib/analytics.ts` (dual GA4 + PostHog); visitor source in `src/lib/attribution.ts`, stored on party + workshop booking records.
- Kaden declined the wizard's Netlify token. (Square sync was later connected — see below.)
- Related: [[reference_google-analytics]]

**Answering Kaden's questions ("ask me anything"):** `npx tsx scripts/analytics.ts "<HogQL>"` or `--report overview|funnel|sources|pages|bookings|quits|problems|leads|devices|events [--days N]` (needs `POSTHOG_PERSONAL_API_KEY` in .env — added 10/9, read + dashboard/insight write). Revenue truth = server event `booking_paid` (props: booking_kind, revenue, items, item_names, first_/last_source/medium/campaign, visits_before_booking, days_ahead, guests/seats). Other server events: signup_saved, newsletter_saved, agreement_signed. Proxy path `/hs-e` (netlify.toml). Dashboard "Hometown — Bookings & Traffic" id 2192719, rebuilt idempotently by `scripts/posthog-dashboards.ts`. Outbound links carry utm via `src/lib/utm.ts` (email / party_invite / friend / text).
**Square data warehouse sync CONNECTED 10/9** (Kaden changed his mind: fine with data in PostHog; own "PostHog sync" Square app token). HogQL tables: square_payments (total_money/refunded_money are JSON {amount} in cents — use ifNull(JSONExtractInt(toString(x),'amount'),0); created_at needs parseDateTimeBestEffort(toString())), square_refunds, square_customers, square_catalog, square_locations. Includes in-studio POS money the site never sees. Netlify source still declined.
**Team/test traffic (10/9):** Catherine's iPhone = person 30fc783f-3a17-5d6b-9a1e-4555233f3ebe (distinct 01a12317-f09f-7302-ae27-532abb20eb9a), set name "Catherine (owner)" (co-owner; renamed from "Catherine (Kaden's wife)"), is_team=true via a `$set` event to /batch. Project "filter out internal/test users" (default ON) excludes person is_team=true and utm_source=claude_test. When answering questions with raw HogQL, exclude those too (person.properties.is_team, properties.utm_source='claude_test').
Kaden's iPhone (Brave) = person d35e8999-8b02-5996-bc72-43212d4f0f50, distinct 01a12320-0094-7b5b-ae23-f0abb742c921, name 'Kaden (owner)', is_team=true.
Kaden's MacBook Chrome = person c44bef16-053a-5779-8bc5-e5d93ca87b44 (distinct 01a12322-c619-7944-bfc4-28bd02526c63), is_team.
Kaden's boss (Los Angeles, iPhone Chrome) = distinct 01a123c6-8088-7f59-874b-371434cb6e4b, tagged is_team (not a customer). Staff login identity TMeIN-kxF-ZVhTVj (Kaden's Mac) tagged is_team.
