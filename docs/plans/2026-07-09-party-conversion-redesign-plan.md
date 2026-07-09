# Party Booking Conversion Redesign — Implementation Plan

> **Design:** Approved in-session 2026-07-09 (10-point conversion teardown of /book, PartyModal, calendar entry).
> **For agents:** Executed in-session, sequentially. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the party booking page + flow to maximize click-through to a paid $200 deposit — emotion-first page, 3-step checkout, trust/urgency signals, wallet payments — with zero fabricated content (anything Kaden must supply is config-gated and listed in `docs/NEEDS-FROM-KADEN.md`).

**Architecture:** All customer-facing copy and Kaden-gated content centralizes in `src/config/party-content.ts` (render-only-if-filled). Step-flow logic and share/calendar-link builders are extracted to pure libs with vitest coverage. UI changes live in the existing components (PartyModal, PartyLanding, WhatsOnCalendar, PaymentForm) following their current inline-style idiom.

**Tech Stack:** Astro SSR + React islands, Square Web Payments SDK (card + Apple Pay/Google Pay), Square API (Apple Pay domain registration script), vitest.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/config/party-content.ts` | Create | Hero copy, occasion line, FAQ entries, trust copy, Kaden-gated fields (heroImage, textNumber, reschedulePolicy) |
| `docs/NEEDS-FROM-KADEN.md` | Create | Everything Kaden must supply/decide, with exact file+field to fill |
| `src/lib/party-steps.ts` | Create | Pure step-flow model: visible steps, next/prev, skip logic, progress |
| `src/lib/party-share.ts` | Create | Google Calendar URL + .ics builder, craft share URL, share text |
| `tests/lib/party-steps.test.ts` | Create | Step flow: preselected craft, ?start prefill, personalized-craft keep, counts |
| `tests/lib/party-share.test.ts` | Create | Calendar links + ICS content, share URLs |
| `src/config/party.config.ts` | Modify | `defaultGuests: 10`, `guestQuickPicks`, expected-slot helper export |
| `src/components/party/PartyModal.tsx` | Modify | 3/4-step flow, guest chips, merged Details+Payment, trust block, urgency, craft thumbnail, celebration confirmation, mobile sheet |
| `src/components/checkout/PaymentForm.tsx` | Modify | Optional Apple Pay / Google Pay wallet buttons (graceful no-render if unsupported) |
| `src/components/party/PartyLanding.tsx` | Modify | Next-open-dates strip, share buttons on cards, sticky mobile CTA, `?date=` deeplink, value band |
| `src/pages/book.astro` | Modify | Emotive hero, occasion line, FAQ accordion + FAQPage JSON-LD |
| `src/components/party/PartyFaq.astro` | Create | Accordion (native details/summary, styled) + JSON-LD, only answered entries |
| `src/pages/api/party/notify-me.json.ts` | Create | Email capture → Square customer (email-only) + Slack ping; graceful if unconfigured |
| `src/components/calendar/WhatsOnCalendar.tsx` | Modify | Aggregate party slots per day ("N party times open"), warm "Booked" styling |
| `src/components/calendar/calendar-view-model.ts` | Modify | Party-available href → `/book?date=YYYY-MM-DD` |
| `scripts/register-apple-pay-domain.ts` | Create | One-shot Square ApplePay RegisterDomain call for homegrowncraftstudio.com |

---

## Tasks

### Task 1: Content config + Kaden list
- [x] `src/config/party-content.ts` with real copy; empty-string gates for hero image, text number, reschedule policy, unanswered FAQ answers
- [x] `docs/NEEDS-FROM-KADEN.md`

### Task 2: Pure libs (TDD)
- [x] `party-steps.ts` + failing tests → green (step visibility, prev/next, progress counting with skips)
- [x] `party-share.ts` + failing tests → green (gcal URL, ICS escaping, craft share link)

### Task 3: PartyModal redesign
- [x] Steps: `craft? → when → who → pay` via party-steps lib; correct "Step X of Y"
- [x] Guests: default 10, quick-pick chips (8/10/12/15/20) + fine-tune stepper, "Most parties are 10–15 guests"
- [x] Merge Your Info + Payment into one "Details & payment" step
- [x] Trust block at pay button: Secured by Square · nothing else due today · reschedule policy (gated)
- [x] Urgency: "Only N of M times left" when slots < expected for weekday; date-count line
- [x] Craft image thumbnail in summary chips
- [x] Confirmation: add-to-calendar (Google + .ics), share with guests, next-steps timeline
- [x] Mobile (<640px): full-screen sheet
- [x] "Questions? Text us" escape hatch (gated on real number)
- [x] Analytics: wizard step events via existing `lib/analytics.ts`

### Task 4: Wallet payments
- [x] PaymentForm: optional `walletPayment` prop {amount, label} + `onWalletToken`; Apple Pay / Google Pay buttons, card fallback, no-render on unsupported
- [x] `scripts/register-apple-pay-domain.ts` (run needs production token — Kaden gate)

### Task 5: /book page
- [x] Hero: "Throw a party they'll actually remember" + occasion line + value trio; $200 reframed as "all that's due today"
- [x] Next-open-dates strip (from available-dates API) → opens modal with date preselected
- [x] Value band: per-person math (dynamic), no-show forgiveness headline
- [x] Craft cards: share button (copies `?craft=` link)
- [x] Sticky mobile bottom CTA
- [x] FAQ accordion + FAQPage JSON-LD (answered entries only)

### Task 6: Email capture
- [x] `notify-me.json.ts` endpoint + dead-end capture UI on the When step when no dates

### Task 7: `?date=` deeplink
- [x] PartyLanding parses `?date=YYYY-MM-DD` → modal opens on When step with that date's slots loaded

### Task 8: Calendar
- [x] One aggregated chip per party day ("🎉 N party times open") → `/book?date=`
- [x] Booked parties: warm "Booked 🎉" (no strikethrough/grey negativity)

### Task 9: Verify + ship
- [x] `npx vitest run` green
- [x] Browser walkthrough: desktop + mobile widths, gallery→pay, ?date=, ?craft=, ?start=, calendar links
- [x] Commits per convention (`feat(party): …`), push to dev

## Explicitly out of scope (fake content — Kaden gates)
Testimonials, "Most loved" badges, occasion tags per craft, hero lifestyle photo, pottery craft photo, FAQ policy answers (food/drink, decorations, cancellation specifics), text-us phone number, Apple Pay domain registration run.
