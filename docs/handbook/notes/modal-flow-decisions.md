# Modal Flow UX Decisions (March 2, 2026)

## Overall Pattern
All booking flows use modals triggered from cards on their respective pages. No dedicated detail pages — everything happens inside modals.

## Workshop Booking Flow
1. Click "Book Seat" on workshop card
2. Modal → **Details** (workshop info, seat picker)
3. Modal → **Contact Info** (first/last name, email, phone)
4. Modal → **Payment** (order summary, coupon, Square payment)
5. **Confirmation** (green checkmark, consistent across all flows)

**Decision:** Add a richer details step as step 1 (TODO — not yet built).

## Programs Enrollment Flow
1. Click "Enroll Now" on program card
2. Modal → **Details step** (TODO — not yet built, should show full program info: date range, session schedule, what you'll do)
3. Modal → Session Select (for per-session programs)
4. Modal → Headcount
5. Modal → Child Intake (per child)
6. Modal → Parent Info
7. Modal → Payment
8. Modal → Confirmation

**Decision:** Programs need richer card content AND a details step as first step in modal. Cards are teasers, modal gives full picture.

## Party Booking Flow (Book a Party)
1. Click party type card on `/book` page → modal opens
2. Modal → **Pick dates** (date range picker, inline mode)
3. Modal → **Pick time slot**
4. Modal → **Choose party type** (cards with short descriptions — quick scan of options like kid/adult/corporate)
5. Modal → **Party details** (NEW — full info: what to bring, what to wear, long description + "Select This Party" button. Back button returns to party type selection)
6. Modal → **Customize** (add-ons, guest count, special requests)
7. Modal → **Checkout** (contact info + payment)
8. Modal → **Confirmation**

**Decision:** Party type details are NOT shown on the selection page (too much info for 10+ options). Instead, selecting a party type opens a dedicated details step. User can go back to browse other options. This is progressive disclosure — show enough to pick, then give full picture.

## Shared UX Decisions
- **No confirm dialog on close** — `window.confirm` removed as too intrusive/dated
- **Confirmation screens** — all three flows use identical styling: green circle with green checkmark, heading font, muted text with bold names/emails
- **Card descriptions** — fixed at 4 lines with ellipsis overflow (`-webkit-line-clamp: 4`)
- **Card backgrounds** — 85-92% opaque to reduce glitter bleed-through
- **Modal styling** — consistent glassmorphism: `maxWidth: 40rem`, `maxHeight: 90vh`, backdrop blur, progress bar, back button, step transitions
- **One button per card** — no separate "Details" and "Book" buttons. Single CTA opens modal, first step in modal shows details.

## Implementation Status
- [x] Workshop booking modal (3 steps: details+seats, contact, payment)
- [x] Party booking modal (converted from page wizard)
- [x] Programs enrollment modal (multi-step with child intake)
- [ ] Workshop details step (richer first step)
- [ ] Programs details step (first step in modal)
- [ ] Party type details step (step 5 in flow — after selecting party type from list)
