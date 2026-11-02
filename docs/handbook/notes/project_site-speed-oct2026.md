---
name: project_site-speed-oct2026
description: Why pages were slow (Netlify cold starts) and the 3 fixes shipped to prod 10/11 (d825af8)
metadata:
  type: project
---
Kaden 10/11: "click Workshops and it doesn't react". Cause: SSR function sleeps after a few idle minutes; first tap waits 1–6 s (5.7 s measured after a deploy) while view transitions keep the old page with no feedback.
Shipped PROD d825af8 (10/11, with the email line 567cbfe): (1) /workshops + /calendar HTML CDN-cached via `publicPageHeaders` in src/lib/cache-headers.ts (5 min fresh + 7-day SWR; ?w=, ?preview, preview cookie never stored); (2) src/lib/nav-progress.ts thin top line after 120 ms; (3) netlify/functions/keep-warm.ts pings /api/ping.json every 5 min 0-4,11-23 UTC (~2–3 credits/mo, Kaden OK'd).
Known limit: keeps one instance warm; a second concurrent instance can still cold-start. Kaden decided NO paid ads for now (10/11) — pixel stays for later retargeting. Related: [[reference_meta-pixel]].

**Blob token bug (fixed PROD 83b1727, 10/11 ~2:45pm CDT):** src/lib/blob-store.ts cached the getStore() handle per warm instance; its token expired → "Failed to decode token: Token expired" on every read (seen 8am + 2pm 10/11, only api:workshops logged it) → classes listed WITHOUT seat questions → booking server refused picks-less payments ("This class now asks a question…"). Now only the availability answer is cached; fresh handle per op. Verify: `npx netlify logs --since 2h --source functions | grep "Token expired"` should stay empty. First real bookings 10/11 2:31–2:37pm: 2 families from Instagram, Craft Club + Pumpkin Pails each ($110).
**New-booking alerts (dev 4ea7ac7, needs prod):** src/lib/booking-alert.ts texts OWNER_ALERT_NUMBERS (already Kaden and Catherine) and emails siteConfig.ownerEmails on every paid class seat and party. Before this the site sent NO booking alert — Kaden's booking texts came from Square's own notifications.
PROD 8c3f76d (10/11): site booking alerts live. Square's own staff "Booking notifications" (Emails + SMS) turned OFF on Kaden's team member profile 10/11 at Kaden's request ("just keep ours"); Catherine's were already off. Square account email "Per payment" (every transaction) left ON — not a booking alert, mentioned to Kaden.
