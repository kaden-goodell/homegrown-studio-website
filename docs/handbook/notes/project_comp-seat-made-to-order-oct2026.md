---
name: project_comp-seat-made-to-order-oct2026
description: Oct 18 2026 prod push 9be8950 — made-to-order class flag, Request a spot, comp seat customer search + waiver people, email opt-in, fill-missing customer fields
metadata:
  type: project
---
Shipped to prod 2026-10-18 (deploys 15 = 4f4076d, 16 = 9be8950; 240 credits used on deploys this period, resets Nov 11).

- **Made to order**: event-meta `madeToOrder` (gear sheet on /staff or `set-event.ts --made-to-order`) → 24h sign-up cutoff even with no picks. Set on Halloween Cookie Decorating 10/18. Craft Club 10/18 was closed with `--cutoff 24` (pulled, Kaden refunding; families texted).
- **Request a spot**: closed-early class cards show a button → popup telling them to call (256) 464-1710 (Kaden: "tell them just to call us").
- **Comp / Sell a seat**: Find a customer (staff search, `/api/staff/customers.json`), Who's coming checklist from an in-date waiver (one seat per person + named guests; Square extra seats named "Child (with Parent Name)"; RSVP widened via shared `src/lib/attending.ts`). Confirmation email only when "Email them a confirmation" ticked (Kaden: comps are often added after the fact).
- **Fill missing**: any email/phone-matched Square customer gets missing phone/first/last/email filled; never replaces existing.

**Why:** Kaden 10/18 requests. **How to apply:** the dev preview runs with DEV_BYPASS_PAYMENT → Square writes are SIMULATED but roster/RSVP/check-in blobs and emails are REAL (shared stores). Warn Kaden before he tests staff flows on the preview. Pending: Kaden to redo two customer comps on prod. Related: [[project_seat-options-oct2026]], [[project_giveaways-oct2026]].

**Ticket types (dev b01fea6, 2026-10-18, NOT on prod yet):** event-meta `tickets` (first type = Square class price, others priced in cents, each with a min); `set-event.ts --ticket "Adult:min=1" --ticket "Kid=15:min=1"`. Booking re-prices non-first seats on their held orders via `setSeatPrice` (live-tested 1 adult + 2 kids on holds, no charge). For Kaden's family potholder class: Adult $20 / Kid $15, 40 seats, Fri Oct 23 6–8 PM, kids 8+; name still undecided (he called "Grown-Up & Me" gross). Still to prove: a real-card charge. Staff Sell-a-seat "take $X" hint still uses the class (adult) price.
