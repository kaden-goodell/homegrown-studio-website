---
name: test-campaign-aug2026
description: "HOM-163 'beyond rock solid' test campaign — 5 launch blockers found+fixed (Aug 2–6, 2026); what's verified, what remains; Linear connector lost Homegrown workspace after 8/6 /login"
metadata: 
  node_type: memory
  type: project
  originSessionId: 76db43f7-73bc-42b6-ae29-3f25ba0aeedc
---

**Test campaign (HOM-163) — gate for the ~Aug 12 prod deploy (HOM-118).** All fixes on dev.

**5 launch blockers found & fixed:**
1. `SQUARE_APPLICATION_ID`/`SQUARE_LOCATION_ID` missing from Netlify → party/kit payments rendered mock "Test Mode" placeholder (unpayable). Env set (all contexts); real card + Apple/Google Pay verified on preview. (c21fc85)
2. Party dates offered pre-opening August weekends (no CO) → `partyConfig.bookingOpensDate='2026-09-01'` clamped in `partyStartsForDate` (single choke point incl. server re-verify). First date now Sat Sep 5, verified live.
3. "TEST — Dollar Craft" $1 item was public → filtered via `isTestCraft()`; staff lane = `?test=1` on page URL → `includeTest=1` API param (kit order pricing still resolves TEST items). Verified live.
4. **/workshops permanently frozen on skeletons on every deploy** — WorkshopBookingModal imported CLASS_BOOKING_APP_ID from site.config → server env guard entered the client bundle → threw in-browser (PROVIDER_MODE invisible) → hydration died. Constant moved to client-safe `class-booking.config.ts`; guard now `typeof window === 'undefined'`-gated. Verified: page renders (Y2K Mom's Night Out Aug 21), modal opens. (65ed27b)
5. **What's On calendar rendered workshop times in server TZ (UTC)** — 6 PM CDT showed "11:00 PM"; 7 PM+ events would land on the WRONG DAY. `isoToLocalHHMM`/`isoToLocalDate` in calendar-view-model.ts used Date getters; now Intl/America-Chicago. Regression test pins day-boundary. (f67e4fb)

**Verified working:** party flow end-to-end to payment (ack gate, tiers, receipt, policy checkbox, wallets), workshops page+modal, /calendar List view, kits API payload, /policies, /open-studio, suite 474/474.

**✅ DECIDED 8/6 (Kaden): deploy ships with KITS OFF** — current code state is correct as-is; kits flip on with the photos deploy later. **Remaining before deploy:** re-verify TZ fix on rebuilt preview; mobile passes (Kaden+Catherine real phones); refund end-to-end; $1 prod live-lane post-deploy (scripts/test-data-setup.mjs). Weekly prod smoke tests after.

**⚠️ Linear connector:** after Kaden's 8/6 `/login`, the claude.ai Linear connector reverted to the DURO workspace — HOM-* unreachable. Kaden must re-add Homegrown Studio in connector settings. UNPOSTED to HOM-163: session-2 findings (blockers 4+5, kits-flag correction — HOM-118's title wrongly says "flag now ON"; post when access returns).
