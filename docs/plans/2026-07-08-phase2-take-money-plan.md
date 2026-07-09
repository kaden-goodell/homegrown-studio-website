# Phase 2: Ready-to-Take-Money Implementation Plan

> **Roadmap:** docs/plans/2026-07-08-launch-roadmap-README.md ← READ THIS FIRST (shared context, git rules, required inputs)
> **Depends on:** Phase 1 plan completed (notably: `src/lib/calendar-events.ts` exists, `npm test` script exists).
> **For agents:** Use sdd (sequential) to implement task-by-task. Steps use checkbox (`- [ ]`) syntax. Work on `dev`. Never push `main` without user approval.

**Goal:** Swap TEST Square data for the real catalog, add policies/FAQ/waiver, take 50% deposits on parties, explain the alternating-week schedule in the UI, wire analytics, build the weekly revenue report, and fix modal accessibility.

**⚠️ SCHEDULING DECISION (owner, 2026-07-08):** The alternating open-studio/party week schedule is **managed entirely in Square, not in app code**. Kaden configures which weeks offer party availability (Square Appointments availability for the party service) and which dates are Open Studio (the `programDates` custom attribute on the Open Studio catalog item). The app must stay **passive**: display whatever Square returns, and explain empty weeks gracefully. **Do NOT add schedule pattern config, week-type math, or server-side week enforcement to the app.** Square already refuses bookings for slots it doesn't offer.

**Architecture:** Deposits reuse the existing order flow with a single deposit line item (`src/lib/party-pricing.ts` stays the single source of truth). Off-week UX is data-driven: no party slots on a date → friendly explanation pointing at the calendar. Revenue reporting is an offline Node script over Square Orders — no new runtime surface.

**Tech Stack:** Astro 5 SSR, React 19, Square SDK v44, vitest, PostHog (already loaded by Layout when `POSTHOG_API_KEY` is set).

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/config/party.config.ts` | Modify | `depositPct` config; later real catalog IDs |
| `src/lib/party-pricing.ts` | Modify | depositCents / balanceDueCents |
| `tests/lib/party-pricing.test.ts` | Create/Modify | Deposit math |
| `src/pages/api/party/book.json.ts` | Modify | Deposit order instead of full total |
| `src/components/party/PartyModal.tsx` | Modify | Deposit display, empty-day message, waiver checkbox, analytics, focus trap |
| `src/components/calendar/WhatsOnCalendar.tsx` | Modify | Alternating-cadence legend note, keyboard access |
| `src/components/workshops/WorkshopBookingModal.tsx` | Modify | Waiver checkbox, analytics, focus trap |
| `src/lib/use-focus-trap.ts` | Create | Reusable focus-trap + Escape hook |
| `src/lib/analytics.ts` | Modify | offering_type / revenue on events |
| `src/components/shared/Newsletter.tsx` | Modify | Fire newsletter_subscribed |
| `src/pages/policies.astro` | Create | Cancellation policy + waiver text |
| `src/pages/faq.astro` | Create | FAQ page with FAQPage schema |
| `src/config/site.config.ts` | Modify | Nav links for new pages |
| `src/pages/sitemap.xml.ts` | Modify | Add new pages |
| `scripts/prod-catalog-setup.mjs` | Create | Real Square catalog objects |
| `scripts/revenue-report.mjs` | Create | Weekly revenue by offering |
| `package.json` | Modify | revenue-report script |
| `.github/workflows/ci.yml` | Create | build + test on PR/push |

Suggested order: 1→2→3 (deposits), 4 (messaging), 5 (pages), 6 (a11y/waiver), 7 (analytics), 8 (catalog swap — user input), 9 (revenue report), 10 (CI), 11 (verify/deploy). Tasks 4–7 are independent of 1–3.

---

### Task 1: Deposit config

**Files:** Modify: `src/config/party.config.ts`

- [ ] **Step 1:** In `src/config/party.config.ts`, add after `priceBreakTiers` (inside the object, keep `as const`):

```ts
  /**
   * % of the party total charged online at booking time; the balance is paid
   * in-studio on party day. 100 = charge everything up front.
   */
  depositPct: 50,
```

- [ ] **Step 2:** `npm run build` — Expected: success. Commit: `git commit -am "feat(config): party deposit percentage"`

---

### Task 2: Deposit math in party-pricing (TDD)

**Files:** Modify: `src/lib/party-pricing.ts` · Create/append: `tests/lib/party-pricing.test.ts`
**Dependencies:** Task 1

- [ ] **Step 1: Failing test.** If `tests/lib/party-pricing.test.ts` exists, append the describe block; otherwise create the file:

```ts
import { describe, it, expect } from 'vitest'
import { partyTotalCents, depositCents, balanceDueCents } from '@lib/party-pricing'

describe('deposit math (depositPct=50)', () => {
  it('deposit is half the total, rounded to a cent', () => {
    const total = partyTotalCents(4500, 10) // $200 base + 10×$45 = $650.00
    expect(total).toBe(65000)
    expect(depositCents(4500, 10)).toBe(32500)
    expect(balanceDueCents(4500, 10)).toBe(32500)
  })
  it('deposit + balance always equals total (odd totals)', () => {
    const total = partyTotalCents(3333, 3) // odd cents
    expect(depositCents(3333, 3) + balanceDueCents(3333, 3)).toBe(total)
  })
})
```

- [ ] **Step 2:** Run: `npx vitest run tests/lib/party-pricing.test.ts` — Expected: FAIL (`depositCents` not exported).
- [ ] **Step 3: Implement.** Append to `src/lib/party-pricing.ts`:

```ts
/** Amount charged online at booking (partyConfig.depositPct % of the total). */
export function depositCents(perHeadCents: number, people: number): number {
  return Math.round(partyTotalCents(perHeadCents, people) * (partyConfig.depositPct / 100))
}

/** Remainder due in-studio on party day. */
export function balanceDueCents(perHeadCents: number, people: number): number {
  return partyTotalCents(perHeadCents, people) - depositCents(perHeadCents, people)
}
```

- [ ] **Step 4:** Run: `npx vitest run tests/lib/party-pricing.test.ts` — Expected: PASS.
- [ ] **Step 5:** Commit: `git add -A && git commit -m "feat(pricing): party deposit and balance-due helpers"`

---

### Task 3: Charge the deposit instead of the full total

**Files:** Modify: `src/pages/api/party/book.json.ts`, `src/components/party/PartyModal.tsx`
**Dependencies:** Task 2

- [ ] **Step 1 — server:** In `src/pages/api/party/book.json.ts`, change the pricing import to:

```ts
import { partyTotalCents, depositCents, balanceDueCents } from '@lib/party-pricing'
```

Replace the line-items + order-creation + total-verification block (the `const lineItems = [...]` array, the `providers.payment.createOrder` call, and the `expectedTotal` mismatch check) with:

```ts
    // Charge a deposit online; the balance is collected in-studio on party day.
    // A single line item keeps the Square order total equal to the charge.
    const totalCents = partyTotalCents(body.craft.perHeadCents, people)
    const depositDue = depositCents(body.craft.perHeadCents, people)
    const balanceDue = balanceDueCents(body.craft.perHeadCents, people)

    const order = await providers.payment.createOrder({
      locationId,
      customerId: customer.id,
      lineItems: [
        {
          name: `Party Deposit (${partyConfig.depositPct}%) — ${body.craft.name} for ${people} guests`,
          quantity: 1,
          pricePerUnit: depositDue,
        },
      ],
    })

    if (order.totalAmount !== depositDue) {
      logger.error('Party deposit total mismatch', {
        orderId: order.id,
        orderTotal: order.totalAmount,
        expectedTotal: depositDue,
      })
      return errorResponse('Pricing mismatch. Your card was not charged.', 500)
    }
```

Then extend the booking's `specialRequests` payload so the balance owed survives to party day (staff reads this at POS):

```ts
      specialRequests: JSON.stringify({
        craft: body.craft,
        people,
        totalCents,
        depositCents: depositDue,
        balanceDueCents: balanceDue,
      }),
```

And extend the success response `data` object with three fields (keep the existing `totalCharged`):

```ts
          totalCents,
          depositCharged: depositDue,
          balanceDueCents: balanceDue,
```

- [ ] **Step 2 — client:** In `src/components/party/PartyModal.tsx`:
  1. Extend the pricing import (grep `party-pricing` in the file) with `depositCents, balanceDueCents`; ensure `partyConfig` is imported (grep — it likely already is).
  2. Find the Payment step's price summary (grep `craftBreakdown` ~line 180 for the `perHead` / `people` variable names, and where `craftLines` renders). BELOW the existing itemized total, add:

```tsx
              <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid rgba(150,112,91,0.15)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                  <span>Due today ({partyConfig.depositPct}% deposit)</span>
                  <span>${(depositCents(perHead, people) / 100).toFixed(2)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--color-muted)', fontSize: '0.875rem' }}>
                  <span>Balance due at your party</span>
                  <span>${(balanceDueCents(perHead, people) / 100).toFixed(2)}</span>
                </div>
              </div>
```

  (Use the exact `perHead`/`people` variable names found in the file.)
  3. If the payment button or PaymentForm displays a charge amount, change it to the deposit amount — the server charges the deposit regardless; the display must match.
  4. In the confirmation step (grep `confirmation has been sent` ~line 388), add below that line:

```tsx
            <p style={{ marginTop: '0.5rem', color: 'var(--color-muted)', fontSize: '0.9rem' }}>
              We charged your {partyConfig.depositPct}% deposit today — the remaining
              balance is due at the studio on party day.
            </p>
```

- [ ] **Step 3:** Verify in mock mode: `npm run dev` → `/book` → full flow → deposit + balance lines shown; confirmation mentions deposit. `npm test && npm run build`.
- [ ] **Step 4:** Commit: `git commit -am "feat(party): charge 50% deposit online, balance due in-studio"`

---

### Task 4: Explain empty party days (data-driven, no app-side schedule)

**Files:** Modify: `src/components/party/PartyModal.tsx`, `src/components/calendar/WhatsOnCalendar.tsx`

Square decides which weeks offer party slots. When a customer picks a date in an open-studio week, Square simply returns zero slots — the UI must explain why instead of looking sold out.

- [ ] **Step 1 — PartyModal empty state:** Find the Date step's empty-slots rendering (grep the no-slots/empty text near where availability results render; the availability fetch is at ~line 199). Replace/augment the generic empty message with:

```tsx
              <div
                style={{
                  padding: '0.9rem 1.1rem',
                  borderRadius: '0.75rem',
                  background: 'rgba(150, 112, 91, 0.07)',
                  border: '1px solid rgba(150, 112, 91, 0.15)',
                  fontSize: '0.9rem',
                  color: 'var(--color-text)',
                }}
              >
                No party times on this date. We alternate weeks between{' '}
                <strong>Open Studio</strong> (walk-in crafting, no bookings) and{' '}
                <strong>Party weeks</strong> — or this date may simply be booked.
                Check the{' '}
                <a href="/calendar" style={{ color: 'var(--color-primary)' }}>
                  What's On calendar
                </a>{' '}
                for green bookable party slots.
              </div>
```

- [ ] **Step 2 — Calendar legend note:** In `src/components/calendar/WhatsOnCalendar.tsx`, find the legend (grep `legend` or the event-type key rendering). Add directly beneath it:

```tsx
      <p style={{ fontSize: '0.8125rem', color: 'var(--color-muted)', textAlign: 'center', marginTop: '0.5rem' }}>
        We alternate weeks: Open Studio weeks are for walk-in crafting, Party weeks
        have bookable green slots. Evening workshops run every week.
      </p>
```

(If there is no obvious legend element, place it directly under the month-navigation header row.)

- [ ] **Step 3:** Verify visually in `npm run dev` (mock mode may always return slots — the empty state can be forced by temporarily returning `[]` from the availability endpoint during manual testing; revert afterward). `npm run build && npm test`.
- [ ] **Step 4:** Commit: `git commit -am "feat(ux): explain alternating open-studio/party weeks on empty dates and calendar"`

---

### Task 5: Policies + FAQ pages, nav links

**Files:** Create: `src/pages/policies.astro`, `src/pages/faq.astro` · Modify: `src/config/site.config.ts`, `src/pages/sitemap.xml.ts`

- [ ] **Step 1:** Create `src/pages/policies.astro` (⚠️ waiver text is a DRAFT for attorney review — keep the visible disclaimer):

```astro
---
export const prerender = true
import Layout from '@layouts/StaticLayout.astro'
import { siteConfig } from '@config/site.config'
---

<Layout title="Policies" description="Booking, cancellation, and studio policies for Homegrown Studio.">
  <section class="max-w-3xl mx-auto px-4 sm:px-6 py-28">
    <h1 class="text-4xl sm:text-5xl font-heading font-bold mb-10" style="color: var(--color-dark);">Studio Policies</h1>

    <div class="glass rounded-2xl p-8 mb-8">
      <h2 class="text-2xl font-heading font-bold mb-4" style="color: var(--color-dark);">Party bookings & deposits</h2>
      <ul class="space-y-2 text-base leading-relaxed" style="color: var(--color-text);">
        <li>• A 50% deposit is charged when you book. The balance is due at the studio on party day.</li>
        <li>• <strong>14+ days before</strong> your party: cancel for a full deposit refund.</li>
        <li>• <strong>7–13 days before</strong>: half of your deposit is refunded, or reschedule once for free.</li>
        <li>• <strong>Under 7 days</strong>: the deposit is non-refundable, but we'll gladly reschedule you once.</li>
        <li>• Final guest count can change until 48 hours before the party; your balance adjusts to the final count.</li>
      </ul>
    </div>

    <div class="glass rounded-2xl p-8 mb-8">
      <h2 class="text-2xl font-heading font-bold mb-4" style="color: var(--color-dark);">Workshop seats</h2>
      <ul class="space-y-2 text-base leading-relaxed" style="color: var(--color-text);">
        <li>• Cancel <strong>48+ hours</strong> before a workshop for a full refund.</li>
        <li>• Under 48 hours: we can transfer your seat to a future session or a friend, but can't refund — materials are prepped per seat.</li>
        <li>• If <em>we</em> cancel a session, you always get a full refund.</li>
      </ul>
    </div>

    <div class="glass rounded-2xl p-8 mb-8">
      <h2 class="text-2xl font-heading font-bold mb-4" style="color: var(--color-dark);">Open Studio</h2>
      <ul class="space-y-2 text-base leading-relaxed" style="color: var(--color-text);">
        <li>• Walk-ins welcome during Open Studio weeks — no reservation needed.</li>
        <li>• No studio fee — just pay for your chosen craft at the counter.</li>
        <li>• Crafts are designed for ages 8+; younger makers are welcome alongside an adult.</li>
      </ul>
    </div>

    <div class="glass rounded-2xl p-8" id="waiver">
      <h2 class="text-2xl font-heading font-bold mb-4" style="color: var(--color-dark);">Liability waiver</h2>
      <p class="text-sm mb-4 italic" style="color: var(--color-muted);">
        Draft — pending legal review. By booking or participating you (and your guests) agree to the following:
      </p>
      <p class="text-base leading-relaxed" style="color: var(--color-text);">
        I understand that craft activities at {siteConfig.name} may involve tools, heat sources,
        and materials that carry inherent risk. I voluntarily participate at my own risk, and on
        behalf of myself and any minors in my care I release {siteConfig.name}, its owners, and
        staff from liability for injury or property damage arising from ordinary participation,
        except where caused by gross negligence. I agree to follow staff instructions and safety
        guidance at all times, and I confirm I am the parent or legal guardian of any minors I
        register.
      </p>
    </div>
  </section>
</Layout>
```

- [ ] **Step 2:** Create `src/pages/faq.astro`:

```astro
---
export const prerender = true
import Layout from '@layouts/StaticLayout.astro'

const faqs = [
  { q: 'Do I need experience to join a workshop?', a: 'No — every workshop is beginner-friendly and guided step by step. All materials and tools are included in your seat price.' },
  { q: 'What is Open Studio?', a: "Walk-in crafting during our open hours — no reservation, no studio fee. Pick a craft at the counter, pay for what you make, and we'll set you up with everything you need." },
  { q: 'Why can’t I book a party this week?', a: 'We alternate weeks: one week is Open Studio (walk-ins), the next is Party week (private bookings). The What’s On calendar shows bookable party slots in green.' },
  { q: 'How does party pricing work?', a: 'A private party is $200 for exclusive use of the studio (2 hours) plus a per-guest craft cost that depends on the craft you choose. Groups of 11+ get 25% off the craft portion; 21+ get 50% off.' },
  { q: 'Is there a deposit?', a: 'Yes — 50% is charged when you book a party; the balance is due at the studio on party day. See our Policies page for the cancellation schedule.' },
  { q: 'What ages are welcome?', a: 'Our crafts are designed for ages 8 and up — younger makers are welcome alongside an adult. Some evening workshops are adults-focused; check the description.' },
  { q: 'Can we book the studio for a private event?', a: 'Absolutely — birthdays, team nights, showers, friend groups, any occasion. The whole studio is yours: we handle setup, guidance, and cleanup, and every guest takes home what they make.' },
  { q: 'When do I take my creation home?', a: 'Most crafts go home the same day. Pieces that need firing or extended drying are ready for pickup about a week later — we’ll text you.' },
  { q: 'What should I wear?', a: 'Things can get delightfully messy. We provide aprons, but dress for craft, not for the runway.' },
  { q: 'Can I cancel or reschedule?', a: 'Workshops: full refund 48+ hours out. Parties: full deposit refund 14+ days out, sliding scale after. Details on the Policies page.' },
]

const faqSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: faqs.map((f) => ({
    '@type': 'Question',
    name: f.q,
    acceptedAnswer: { '@type': 'Answer', text: f.a },
  })),
}
---

<Layout title="FAQ" description="Frequently asked questions about workshops, open studio, and parties at Homegrown Studio in Huntsville, AL.">
  <script type="application/ld+json" set:html={JSON.stringify(faqSchema)} />
  <section class="max-w-3xl mx-auto px-4 sm:px-6 py-28">
    <h1 class="text-4xl sm:text-5xl font-heading font-bold mb-10" style="color: var(--color-dark);">Frequently Asked Questions</h1>
    <div class="space-y-4">
      {faqs.map((f) => (
        <details class="glass rounded-2xl p-6">
          <summary class="font-heading font-bold text-lg cursor-pointer" style="color: var(--color-dark);">{f.q}</summary>
          <p class="mt-3 leading-relaxed" style="color: var(--color-text);">{f.a}</p>
        </details>
      ))}
    </div>
    <p class="mt-10 text-center" style="color: var(--color-muted);">
      Still curious? <a href="/policies" style="color: var(--color-primary);">Read our policies</a> or email us.
    </p>
  </section>
</Layout>
```

- [ ] **Step 3:** In `src/config/site.config.ts` `nav` array, add before `About`: `{ label: 'FAQ', href: '/faq' },` and `{ label: 'Policies', href: '/policies' },` (footer renders the same nav; header crowding on mobile is acceptable for now — if the Header truncates badly, keep FAQ in nav and let Policies live only in the FAQ page link + booking waiver links).
- [ ] **Step 4:** Add `'/faq', '/policies'` to the `PAGES` array in `src/pages/sitemap.xml.ts`.
- [ ] **Step 5:** Verify pages render; `curl -s localhost:4321/faq | grep -c FAQPage` → 1. `npm run build`.
- [ ] **Step 6:** Commit: `git add -A && git commit -m "feat(content): policies + FAQ pages with FAQPage schema, nav links"`

---

### Task 6: Modal accessibility + waiver checkboxes

**Files:** Create: `src/lib/use-focus-trap.ts` · Modify: `src/components/party/PartyModal.tsx`, `src/components/workshops/WorkshopBookingModal.tsx`, `src/components/calendar/WhatsOnCalendar.tsx`
**Dependencies:** Task 5 (links to /policies#waiver)

- [ ] **Step 1:** Create `src/lib/use-focus-trap.ts`:

```ts
import { useEffect, useRef } from 'react'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Traps Tab focus inside the referenced element while `active`, focuses the
 * first focusable child on mount, restores focus on unmount, and calls
 * `onEscape` on the Escape key.
 */
export function useFocusTrap<T extends HTMLElement>(active: boolean, onEscape?: () => void) {
  const ref = useRef<T | null>(null)
  useEffect(() => {
    if (!active || !ref.current) return
    const node = ref.current
    const previouslyFocused = document.activeElement as HTMLElement | null
    const first = node.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? node).focus()

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onEscape?.()
        return
      }
      if (e.key !== 'Tab') return
      const els = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null
      )
      if (els.length === 0) return
      const firstEl = els[0]
      const lastEl = els[els.length - 1]
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault()
        lastEl.focus()
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault()
        firstEl.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previouslyFocused?.focus()
    }
  }, [active, onEscape])
  return ref
}
```

- [ ] **Step 2 — apply to both modals** (`PartyModal.tsx`, `WorkshopBookingModal.tsx` — same recipe):
  1. Import `useFocusTrap` (match the file's alias/relative import style).
  2. Inside the component: `const modalRef = useFocusTrap<HTMLDivElement>(true, () => { if (!completed) onClose() })` — both components have a `completed` boolean (verify with grep; use the actual name).
  3. Find the modal PANEL — the inner container div inside the fixed backdrop. The backdrop is the element with `onClick={(e) => { if (e.target === e.currentTarget && !completed) onClose() }}` (~line 747 Party / ~516 Workshop); the panel is its first child div. Add to the panel:

```tsx
ref={modalRef} role="dialog" aria-modal="true" aria-label="Book a party" tabIndex={-1}
```

(`aria-label="Book a workshop"` in WorkshopBookingModal.)

- [ ] **Step 3 — waiver checkbox, both modals:** In the customer-info step (name/email step — "Your Info" in PartyModal; the details step in WorkshopBookingModal), add state near the other `useState` calls:

```tsx
  const [waiverAccepted, setWaiverAccepted] = useState(false)
```

Add ABOVE that step's Continue button:

```tsx
              <label style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', fontSize: '0.875rem', color: 'var(--color-text)', margin: '1rem 0' }}>
                <input
                  type="checkbox"
                  checked={waiverAccepted}
                  onChange={(e) => setWaiverAccepted(e.target.checked)}
                  style={{ marginTop: '0.2rem' }}
                />
                <span>
                  I agree to the{' '}
                  <a href="/policies#waiver" target="_blank" rel="noopener" style={{ color: 'var(--color-primary)' }}>
                    liability waiver and studio policies
                  </a>{' '}
                  on behalf of myself and my guests.
                </span>
              </label>
```

Gate the step's Continue button: append `|| !waiverAccepted` to its existing `disabled` condition (if it has none, add `disabled={!waiverAccepted}` styled like the modal's other disabled buttons).

- [ ] **Step 4 — calendar keyboard access:** In `WhatsOnCalendar.tsx`, find the day-cell element (a `<div>` with an onClick toggling day details — grep `onClick` in the grid-rendering section ~line 285). Add to the day-cell div:

```tsx
role="button"
tabIndex={0}
onKeyDown={(ev) => {
  if (ev.key === 'Enter' || ev.key === ' ') {
    ev.preventDefault()
    ;(ev.currentTarget as HTMLElement).click()
  }
}}
```

- [ ] **Step 5:** Manual verification (`npm run dev`): open each modal — focus lands inside; Tab cycles; Escape closes (not on confirmation screen); info step blocked until waiver checked; calendar days toggle with Enter. `npm run build && npm test`.
- [ ] **Step 6:** Commit: `git add -A && git commit -m "feat(a11y): focus-trapped dialogs with Escape, waiver consent gates, keyboard calendar"`

---

### Task 7: Wire analytics events

**Files:** Modify: `src/lib/analytics.ts`, `src/components/party/PartyModal.tsx`, `src/components/workshops/WorkshopBookingModal.tsx`, `src/components/shared/Newsletter.tsx`

The tracking library (`src/lib/analytics.ts`) exists but nothing calls it — the revenue experiment's funnel is dark.

- [ ] **Step 1:** In `src/lib/analytics.ts`, replace these two functions so revenue events carry the offering:

```ts
export function trackBookingCompleted(eventType: string, revenueCents?: number): void {
  capture('booking_completed', { event_type: eventType, revenue_cents: revenueCents })
}

export function trackPaymentCompleted(amount: number, offeringType?: string): void {
  capture('payment_completed', { amount, offering_type: offeringType })
}
```

- [ ] **Step 2 — PartyModal:** import `trackWizardStarted, trackWizardStepCompleted, trackBookingCompleted, trackPaymentCompleted, trackWizardAbandoned` from the analytics lib, then:
  1. On mount: `useEffect(() => { trackWizardStarted('party') }, [])`
  2. Each step-advance button calls `setStep(N)` (grep `setStep(` — ~lines 497/545/630/664). Wrap each: `onClick={() => { trackWizardStepCompleted(STEP_LABELS[step]); setStep(N) }}` — preserve any existing logic in those handlers.
  3. In the booking-success path (where `completed` becomes true after the `/api/party/book.json` response, ~line 242 region): `trackBookingCompleted('party', data.depositCharged)` and `trackPaymentCompleted(data.depositCharged / 100, 'party')` (field added in Task 3).
  4. Abandonment: define `const handleClose = () => { if (!completed) trackWizardAbandoned(STEP_LABELS[step], 'party'); onClose() }` and use it at the backdrop handler (~747), the header close button (~778), and the Task 6 focus-trap `onEscape`.
- [ ] **Step 3 — WorkshopBookingModal:** same recipe with `'workshop'`; on success additionally `trackWorkshopSeatBooked(workshop.name, workshop.price)`. If the modal has no STEP_LABELS array, pass `String(step)`.
- [ ] **Step 4 — Newsletter:** in `src/components/shared/Newsletter.tsx`, the submit handler fetches `/api/customer/subscribe.json` (~line 18). In its success branch add `trackNewsletterSubscribed()` (with import).
- [ ] **Step 5:** Verify: `npm run dev`, exercise both modals with the console open — no errors from analytics calls (PostHog no-ops without a key). `npm run build && npm test`.
- [ ] **Step 6:** Commit: `git commit -am "feat(analytics): wire funnel + revenue events across booking flows"`

---

### Task 8: Real Square catalog (⚠️ USER INPUT + writes to live Square)

**Files:** Create: `scripts/prod-catalog-setup.mjs` · Modify: `src/config/party.config.ts`
**Dependencies:** ⚠️ Requires: final craft menu + prices from Kaden, and `.env` with production `SQUARE_ACCESS_TOKEN`. This task WRITES to the live Square account — confirm with the user before running scripts.

Recommended craft menu if Kaden hasn't decided (present, get confirmation):

| Craft | Per-head |
|---|---|
| Watercolor kit | $30 |
| Pottery painting | $35 |
| Macramé hanger | $40 |
| Candle making | $45 |
| Tallow skincare | $50 |

- [ ] **Step 1:** Read `scripts/test-data-setup.mjs` — it creates the party APPOINTMENTS_SERVICE item, the craft modifier list, and the Open Studio display item (all prefixed "TEST — "). Copy to `scripts/prod-catalog-setup.mjs` and edit: remove every `"TEST — "` prefix, set the confirmed craft names/prices, keep the party base variation at $200/120min, keep the Open Studio item's `flow='display'` attribute. Don't restructure — it already handles the v44 SDK correctly.
- [ ] **Step 2:** With user confirmation: `node --env-file=.env scripts/prod-catalog-setup.mjs` — note the printed object IDs.
- [ ] **Step 3:** Update `src/config/party.config.ts` `square.catalogItemId`, `square.craftModifierListId`, `square.openStudioItemId` with the real IDs; update the header comment (no longer TEST data).
- [ ] **Step 4:** With user confirmation: `node --env-file=.env scripts/test-data-teardown.mjs` to remove TEST objects.
- [ ] **Step 5:** **Square-side schedule setup (Kaden's, but remind + assist):** the alternating weeks live in Square —
  - Party weeks: party service availability in Square Appointments for those weeks only (Kaden manages; per business rules parties start no later than 3pm — the app also filters via `offeredPartyStarts`).
  - Open Studio weeks: dates go in the Open Studio item's `programDates` custom attribute (`YYYY-MM-DDTHH:MM-HH:MM,` comma-separated; hours Thu/Fri 16:00–21:00, Sat 09:00–21:00, Sun 14:00–20:00). Check `scripts/` for an existing `programDates` writer (`grep -l programDates scripts/*`); extend `prod-catalog-setup.mjs` if none.
  - Workshops: Classes must be created manually in the Square Dashboard UI (the API cannot create Classes).
- [ ] **Step 6:** Verify with `PROVIDER_MODE=square npm run dev`: `/calendar` shows real open-studio windows and party slots only in the weeks Kaden configured; `/book` lists real crafts. **Remind the user:** Netlify env vars (`PROVIDER_MODE=square`, `SQUARE_*`, `POSTHOG_API_KEY`) must be set before production deploy.
- [ ] **Step 7:** Commit: `git add -A && git commit -m "feat(square): production catalog setup script + real catalog IDs"`

---

### Task 9: Weekly revenue report script

**Files:** Create: `scripts/revenue-report.mjs` · Modify: `package.json`

Since the schedule lives in Square, the report does NOT know which weeks were "party weeks" — it infers from the data (a week with party revenue = party week) and Kaden can eyeball the rest.

- [ ] **Step 1:** Create `scripts/revenue-report.mjs`:

```js
/**
 * Weekly revenue report for the open-studio vs. party experiment.
 *
 * Usage: node --env-file=.env scripts/revenue-report.mjs 2026-08-01 2026-09-30
 *
 * Buckets COMPLETED Square orders by week (Mon–Sun, America/Chicago) and source:
 *   - party:  line items starting "Party Deposit" or named "Whole Studio Party"
 *   - pos:    orders from Square Point of Sale (open-studio walk-ins + retail + party balances)
 *   - online: everything else (mostly workshop class bookings)
 * Week type is INFERRED: any party revenue → "party wk", else "open-studio?".
 */
import { SquareClient, SquareEnvironment } from 'square'

const [startArg, endArg] = process.argv.slice(2)
if (!startArg || !endArg) {
  console.error('Usage: node --env-file=.env scripts/revenue-report.mjs YYYY-MM-DD YYYY-MM-DD')
  process.exit(1)
}
const token = process.env.SQUARE_ACCESS_TOKEN
const locationId = process.env.SQUARE_LOCATION_ID
if (!token || !locationId) {
  console.error('SQUARE_ACCESS_TOKEN and SQUARE_LOCATION_ID required (use --env-file=.env)')
  process.exit(1)
}

const client = new SquareClient({
  token,
  environment:
    process.env.SQUARE_ENVIRONMENT === 'production'
      ? SquareEnvironment.Production
      : SquareEnvironment.Sandbox,
})

const chicagoDate = (iso) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(iso))

/** Monday (YYYY-MM-DD) of the week containing a YYYY-MM-DD date. */
function mondayOf(ymd) {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d, 12))
  const dow = (dt.getUTCDay() + 6) % 7 // Mon=0 … Sun=6
  dt.setUTCDate(dt.getUTCDate() - dow)
  return dt.toISOString().slice(0, 10)
}

async function fetchOrders() {
  const orders = []
  let cursor
  do {
    const resp = await client.orders.search({
      locationIds: [locationId],
      cursor,
      query: {
        filter: {
          stateFilter: { states: ['COMPLETED'] },
          dateTimeFilter: { closedAt: { startAt: `${startArg}T00:00:00Z`, endAt: `${endArg}T23:59:59Z` } },
        },
        sort: { sortField: 'CLOSED_AT', sortOrder: 'ASC' },
      },
    })
    const page = resp?.orders ?? resp?.result?.orders ?? []
    orders.push(...page)
    cursor = resp?.cursor ?? resp?.result?.cursor
  } while (cursor)
  return orders
}

function classify(order) {
  const items = order.lineItems ?? []
  const isParty = items.some(
    (li) => (li.name ?? '').startsWith('Party Deposit') || li.name === 'Whole Studio Party'
  )
  if (isParty) return 'party'
  const source = order.source?.name ?? ''
  if (/point of sale|register|terminal/i.test(source)) return 'pos'
  return 'online'
}

const cents = (o) => Number(o.totalMoney?.amount ?? 0)

const orders = await fetchOrders()
const weeks = new Map()
for (const o of orders) {
  const wk = mondayOf(chicagoDate(o.closedAt ?? o.createdAt))
  const b = weeks.get(wk) ?? { party: 0, pos: 0, online: 0, count: 0 }
  b[classify(o)] += cents(o)
  b.count++
  weeks.set(wk, b)
}

const fmt = (c) => `$${(c / 100).toFixed(2)}`
console.log(`\nRevenue by week (${startArg} → ${endArg}), ${orders.length} completed orders\n`)
console.log('Week of      Type          Party      POS(~OpenStudio)  Online(~Workshops)  Total')
console.log('-'.repeat(90))
for (const [wk, b] of [...weeks.entries()].sort()) {
  const total = b.party + b.pos + b.online
  const type = b.party > 0 ? 'party wk' : 'open-studio?'
  console.log(
    `${wk}   ${type.padEnd(13)} ${fmt(b.party).padStart(9)}  ${fmt(b.pos).padStart(15)}  ${fmt(b.online).padStart(17)}  ${fmt(total).padStart(9)}`
  )
}
console.log('\nNOTES:')
console.log('- Party column shows online DEPOSITS; party balances paid in-studio land in POS on party day.')
console.log('- POS includes retail. Week type is inferred from data — cross-check against your Square schedule.')
console.log('- Compare party vs open-studio weeks only after 3+ weeks of each (see Phase 4 runbook).\n')
```

- [ ] **Step 2:** Add to `package.json` scripts: `"revenue-report": "node --env-file=.env scripts/revenue-report.mjs"`.
- [ ] **Step 3:** Verify: `npm run revenue-report -- 2026-06-01 2026-06-30` with a production token (TEST orders may appear; fine). Without `.env`, at minimum `node --check scripts/revenue-report.mjs` must pass — note the untested live run in the final report.
- [ ] **Step 4:** Commit: `git add -A && git commit -m "feat(reporting): weekly revenue report by offering"`

---

### Task 10: CI workflow

**Files:** Create: `.github/workflows/ci.yml`

- [ ] **Step 1:**

```yaml
name: CI
on:
  push:
    branches: [dev, main]
  pull_request:

jobs:
  build-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run build
      - run: npm test
```

- [ ] **Step 2:** `git add .github && git commit -m "chore(ci): build + test workflow" && git push origin dev`. Verify the Actions run passes (`gh run list --limit 1`).

---

### Task 11: Full verification, push dev, propose production deploy

- [ ] **Step 1:** `npm run build && npm test` — both pass.
- [ ] **Step 2:** Mock-mode walkthrough (`npm run dev`): party booking end-to-end (deposit + balance shown; waiver required; Escape/Tab correct; empty-date message renders), `/faq` + `/policies` render with schema, calendar legend note visible.
- [ ] **Step 3:** If Task 8 ran: `PROVIDER_MODE=square npm run dev` and — **with the user's explicit go-ahead on amount/card** — run ONE real end-to-end payment (checklist item "Run one real end-to-end payment"), then refund it from the Square Dashboard. Do not skip silently.
- [ ] **Step 4:** `git push origin dev`; verify the deploy preview.
- [ ] **Step 5:** **STOP — ask the user** before any production deploy (15 credits); remind about Netlify env vars (`PROVIDER_MODE=square`, `SQUARE_*`, `POSTHOG_API_KEY`).
