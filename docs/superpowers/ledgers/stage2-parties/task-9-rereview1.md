# Task 9 re-review 1: fix round 1 (4e657df..c647593)

Verdict: **Needs fixes** (1 Important, small). I1 and I2 as written are fixed and tested; one more way the host key still reaches PostHog (and probably Meta) was found.

Verification at c647593: `npx vitest run tests/api/party* tests/lib/parties tests/components/party tests/lib/meta-pixel.test.ts tests/lib/page-key.test.ts` → 25 files / 453 tests pass. `npx tsc --noEmit` → 0. No Square, analytics or dev-server calls.

## Earlier findings

| Item | Verdict | Where |
|---|---|---|
| I1 charge = shown amount | Fixed | PartyPayPanel.tsx:107 sends `expectedCents`; pay.json.ts:26-27 integer ≥ 0; pay-balance.ts:152 checks before gift card/order; :177 (same-attempt retry vs `quotedCents`) and :184 (on the record inside the CAS claim) close the race. Panel reloads on `amount_changed` (PartyPayPanel.tsx:118-121); wallet amount follows `balance.dueCents` (:226). Tests party-pay.test.ts:300, :318. |
| I2 keys out of analytics (S2-R9a) | Fixed for page URLs; see Important 1 for links | page-key.ts PAGE_KEY_SCRIPT first in `<head>` (Layout.astro:55) before SeoHead/PostHog; Analytics gated (Layout.astro:113); PostHog noRecording (:58); referrer same-origin (:56); pixel PRIVATE_PATHS gains `party` (meta-pixel.ts:19). |
| Minor: claimPaying shortens 24 h | Fixed | money.ts:49-53 (`max(old, new)` for the same attempt) |
| Minor: extras-only copy | Fixed (DRAFT copy for Kaden) | payment-link.ts:36-43, email.ts:736-756, PartyPayPanel.tsx:206-207, balance.json.ts:44 |
| Minor: paid subject with extras still due | Fixed | email.ts:772 |
| Minor: double host email via `created` heuristic | Fixed, better | pay-balance.ts:386-404 `toldAt` CAS; all four callers now call `tellLinkPaid` when `out.rec` (:227, :282, :435, :462). Test party-pay.test.ts:347. |
| Minor: page ignores in-flight paying | Fixed | balance.json.ts:43, PartyPayPanel.tsx:187-196 busy line + "Check again" |
| Handoff: paid after cancel | Done | pay-balance.ts:402-405 owners told, no host "paid" email |

## Checked, no problem

- **Script order**: only charset/viewport precede it; it is synchronous, so `history.replaceState` runs before the PostHog snippet's `init` reads `location` (initial `$pageview`, `$current_url`, `$initial_current_url`). Later `history_change` pageviews and the next page's `$referrer`/`document.referrer` see the stripped URL (replaceState changes the document URL used for the referrer).
- **No XSS**: the key goes URL → sessionStorage → `encodeURIComponent` in a fetch (PartyPayPanel.tsx:71/107, PartyDashboard.tsx:85). Never written into the DOM. The inlined regex has no `</script>`. Script is try/catch-wrapped, never throws.
- **View transitions**: Astro does not re-run an identical head inline script on a swap, hence the capture-phase click guard (page-key.ts:41) adding `data-astro-reload` to same-origin `/party/*` links; capture on `document` runs before Astro's router listener. Only in-site links into /party are `PartyModal.tsx:1006` and `RecentPartyBanner.tsx:54`, both plain `<a>` (no programmatic `navigate()` to /party anywhere).
- **Back/forward**: the history entry was already replaced, so a popstate swap back to /party fetches the bare path; the panel/dashboard fall back to the remembered key. `history.state` is preserved (Astro sets its own state after). bfcache restores the stripped URL.
- **Scoping**: stored as `hs-page-key:<location.pathname>`; read with the same pathname, so another party's page (or the pay page vs. host page of the same party) can't use it. Per tab, gone when the tab closes. Shared-device risk is no worse than the email/text that holds the link. Acceptable.
- **Forced full loads**: only `/party/*` links; costs the fade, nothing else. Other query params on /party pages (`utm_*` from checkout.ts:375) are stripped, but those pages have no analytics anyway; no client code there reads `location.search`.
- **409 abuse**: needs the pay key; `expectedCents` can only make the server refuse, never change what is charged (order is still built from the record). It discloses nothing the balance GET doesn't.
- **Once per charge**: `updatePartyRecord` returns the current record when the fn returns null (party-store.ts:248), so a loser sees `claimed=false` and stays quiet; a failed mark sends anyway (stated trade-off).

## Important

1. **The host key still goes to PostHog on a click, from the two in-site links to the host page.** PostHog autocapture is on (default; posthog.astro has no `autocapture` option, and there is no `ph-no-capture` anywhere in src). A click on "See your party page" in the booking confirmation (PartyModal.tsx:1006, on /book) or on the recent-party banner (RecentPartyBanner.tsx:54-55, on public pages) records an `$autocapture` event whose `$elements` carry `attr__href=/party/<id>?key=<hostKey>`. That event fires on the public page before the reload, so the page-key script can't help. The Meta Pixel's automatic button-click events may also send the link's destination from those pages (less certain). Pre-existing, but it is the same leak S2-R9a closes. Fix: `className="ph-no-capture"` on both links (one word each), and optionally `fbq('set', 'autoConfig', false, PIXEL_ID)` in meta-pixel.ts or a PostHog `before_send` that drops `key=`/`k=` from `$elements`. Test: both links render with `ph-no-capture`.

## Minor

- **Same-attempt retry after an unclear charge, with an extra added meanwhile**: the early check at pay-balance.ts:152 refuses `amount_changed` ("Nothing was charged") before the in-claim check at :177 that would correctly retry the original order (its `quotedCents` still equals what the page showed). The client then drops the attempt id and the page shows the busy line (unclear holds 24 h), so nothing is double-charged, but the possibly-charged first order is only settled by the webhook/nightly/`settleEarlier` later, and the message overstates. Fix: skip the line-152 check when `rec.paying?.attemptId === attemptId && rec.paying.itemIds`.
- After a back/forward swap onto /party from a public page, gtag already loaded by the earlier page may send a history-based GA4 page_view for `/party/<id>` (no key; the id alone opens nothing). Acceptable; noting it because S2-R9a says "no GA on /party".
- `tellLinkPaid` adds a "Payment receipt sent" history line per charge; fine, just more history.
- The dev branch has 1bac82d (party pages: no analytics at all). Reconcile Layout at the stage merge as progress.md says, and keep both (key strip + no analytics).
