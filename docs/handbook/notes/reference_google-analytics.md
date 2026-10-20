---
name: reference_google-analytics
description: Hometown Studio's Google Analytics (GA4) — account, property, measurement ID, which Google login, how it's wired
metadata:
  type: reference
---
Created 2026-10-09 at Kaden's request ("do that for me totally").

- **Login:** kaden@ourhometownstudio.com (in the Mac Chrome profile it's `?authuser=3` as of 10/9; authuser index shifts — Catherine's personal account is the default and has NO Analytics).
- **Account:** "Hometown Studio" (separate from the "Not On My Watch" account 409587658). Industry Arts & Entertainment, Small. Data-sharing boxes left OFF; GA ToS accepted (US), GDPR DPA not accepted.
- **Property:** "ourhometownstudio.com", Chicago time, USD.
- **Web stream:** "Hometown Studio website" → https://ourhometownstudio.com, stream ID 16098635747, **measurement ID G-LLDVN65RSM**, enhanced measurement on.
- **Site wiring:** Netlify `PUBLIC_GA4_ID=G-LLDVN65RSM` in **production context only** (previews don't count); build-time var → needs a redeploy when changed. `src/components/shared/Analytics.astro`; not loaded on `bare` layouts (staff console, kiosk waiver).
- **IDs:** account 411479050, property 558321752 → admin URLs `#/a411479050p558321752/admin/...`. ⚠️ GA often opens on the NOMW property (a409587658p556092820) — check the header says ourhometownstudio.com before changing anything.
- 10/9 done: event data retention 14 months; custom dimensions (event scope) booking_kind, last_step, problem, where, label, method. `purchase` is a default key event.
- Still TODO: mark `generate_lead` (and `notify_me_signup`) as key events once they first arrive after the prod push; link Google Ads if/when ads run. GA custom-dimension form: wait ~3s after Save before clicking Create again or keystrokes land in the search bar.

Related: [[project_nomw-audience-and-channels]] (the other GA account).
