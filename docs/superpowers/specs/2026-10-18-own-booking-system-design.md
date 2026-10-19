# Our own booking system: classes, parties, staff

Kaden + Catherine · drafted 18 Oct 2026 · status: for review

## Why

Square's Classes can't do what we need: one price per class, one person per booking, no Apple Pay, no gift cards, and every change (add, move, cancel, comp) needs a Square dashboard sign-in that expires every day or two. The 18 Oct live test proved the last straw: Square charges the class's own price for every seat, whatever we tell it, so Adult/Kid pricing is impossible on a Square class.

We already own most of the system: rosters, waivers, check-in, picks, comps, emails, reminders and warnings are ours. Square only supplies the class list, the seats-left number, photos, tax, and the charge.

Goals:

- Catherine (or anyone) can run every class and party from the website: type in the details, add a photo, press Add. No Claude, no Square dashboard.
- One checkout for everything: one order, one charge, Apple Pay, gift cards, any pricing.
- One shared studio schedule, so classes, parties, Craft Café and blocked time can never overlap.
- The Square POS still works for everything paid on the day.
- Cancel Square Appointments Plus ($49/month) once nothing needs it.

## The rule for the counter

| Book through the site (online, or /admin and /staff on the iPad) | Pay at the POS |
|---|---|
| Classes (door sales too: Sell a seat on /staff, card on the iPad) | Party crafts per guest, settled after the party |
| Parties | Craft Café walk-in crafts |
| Comps | Gift cards, retail, anything else |

If it has a date and a seat, it goes through the site. If it's paid on the day, it goes through the POS. Safety net: a class seat rung up on the POS anyway still counts (see Seat ledger).

## Where things live

- **/admin** (owners only, Kaden and Catherine): the calendar, the class library, scheduling, parties, party times, blocked time, prices and photos, refunds, promo codes, staff assignments.
- **/staff** (crew): unchanged screens. Underneath, Sell a seat, Comp a seat and check-in move to the new system. New in stage 3: each person's availability and their assignments.
- **The public site**: class list, class booking, party booking, as today, on the new data.
- **Square**: money (orders, payments, refunds, gift cards), the catalog for the POS (organised by category), payroll and timecards. Not bookings.

## Stage 1: the core

### The class library

A library class is what doesn't change from date to date. Every field is optional except name and at least one price.

- Name, description, photo (uploaded on /admin)
- Ages, drop-off yes/no, made to order yes/no, taxable yes/no (default yes, 9%)
- Instructor (optional; blank by default and nothing shows)
- Usual capacity, usual length, max per booking (default 10)
- Seat questions (pumpkin color, size: choices, no price)
- Add-ons per seat (extra kit +$5: a choice with a price)
- Ticket types (Adult, Kid, Teen…; default is one "Person" type)
- Passes (see below; default is "the whole thing")

All current Square classes are imported into the library at switch-over.

### Scheduled classes

"Schedule it" copies a library class onto one or more sessions. The copy is fully editable; editing it never changes the library. "Duplicate" copies any scheduled class to new dates. "Repeat" (stage 4) makes several copies on a pattern.

- **Sessions**: one or more date + start + end. Examples: one evening; 4 days in a row (camp); every Monday for 6 weeks.
- **Capacity per session**: a full-series buyer takes a seat on every session; a single-day buyer takes one on that day.
- **Passes**: what you can buy. Each pass names which sessions it covers:
  - "Full series" (all sessions)
  - "Any one day" (buyer picks 1)
  - "Pick N days" (buyer picks N)
  - or a fixed set ("Weekend pass": sessions 3 and 4)
  - A class can offer only "Full series", only single days, or both.
- **Price** = pass × ticket type. Example: Full series Adult $90, Full series Kid $70, One day Adult $25, One day Kid $20. Any cell may be left out (not sold).
- **Early-bird** (stage 4): a lower price per cell until a date.
- **Minimum to run**: "needs 6 by Thursday 5 PM". If short, owners get a text and email. Nothing is ever cancelled automatically.
- **Link-only**: hidden from the list; bookable by its link.
- **Sign-up cutoff**: as today (made to order, or hours before).
- **Status**: draft (not shown), open, closed, cancelled.

### The shared studio schedule

One function answers "is this time free?" for everything. It knows:

- Studio hours, closed days and holidays
- Craft Café hours and special days
- Every class session and every party
- Blocked time (added on /admin: "closed for inventory", "private event")
- Cleanup gaps: 60 minutes between a party and a class (as today), and the existing café rules

It is used by the public party date picker, party booking, scheduling a class on /admin, moving anything, and the daily warnings. Nothing can be booked or scheduled over something else. Overlap between two classes is allowed only if an owner ticks "these can share the room".

### Seat ledger (how seats are counted)

Our ledger is the source of truth for seats. Every seat is a line in it:

- Online booking (paid)
- /staff Sell a seat (card on the iPad, or "pay at the counter")
- Comp (free)
- POS sale of a class item (arrives from Square)

Seats left on a session = capacity − ledger lines for that session. Refunds release seats.

**Holding the last seat.** Online checkout reserves the seats in the ledger for 10 minutes before charging (a locked write, so two people can't take the same last seat), then confirms on payment or releases on failure.

**POS sales.** Every scheduled class appears in the POS under the "Classes" category, as one Square item per class with a variation per pass × ticket type ("Potholders Oct 23 · Adult"). Square tells the site about every POS sale (webhook) and a nightly check catches anything missed. The sale becomes a ledger line marked "counter sale, no name yet"; the name arrives with the waiver at the door. POS sales are never refused (the counter can squeeze one more in), so a session can show "41 of 40".

The POS does not show seats left; /staff does.

### Checkout (the party path)

One order, one charge:

1. The panel collects passes, ticket types, sessions, seat questions, add-ons, contact.
2. The server works out every price from the class, never from the page.
3. Ledger hold (locked) → Square Orders API order (line items per pass × ticket, add-ons, tax) → Square Payments API charge for the order total.
4. Confirm the ledger lines, save picks, send our confirmation email, text owners.
5. Charge refused → release the hold, nothing charged. No answer → keep the hold, alert owners (as today).

Card, Apple Pay, Google Pay and gift cards, through the same payment form parties use. The Pay button shows the total once.

**Tax**: lines are taxed with the Square 9% tax object when the class is taxable. Proven with a real-card test before launch.

### /admin screens (stage 1)

- **Calendar**: week and month, everything on it (classes, parties, café, blocked time), colour by kind. Tap anything to open it.
- **Library**: list, add, edit, archive.
- **Add / edit a class**: one form, with sections that open only when used (sessions, passes, ticket types, questions, add-ons, rules). Photo upload with a crop to the card shape. Preview of the public card.
- **Schedule it / Duplicate / Move / Cancel**:
  - Move refuses a clash and names it.
  - Cancel shows everyone booked and asks to confirm; it never refunds by itself (Refund is its own button per booking).
- **Bookings on a class**: who, what they bought, picks, paid/comp/counter, refund button.
- **Block time**: date, times, reason; stops all bookings in it.
- **Print a day**: rosters, prep counts, waiver status.

### /staff in stage 1

No new screens. Sell a seat, Comp a seat, roster, check-in, This week and warnings read and write the new ledger. Sell a seat gains "pay on the iPad" (the same checkout, Apple Pay and card).

### Switch-over (stage 1)

- Classes already in Square run out as they are: their bookings, seats and charges stay in Square until the class has happened. Nothing is moved while it has bookings.
- New classes are made on /admin only. The class list shows both kinds during the overlap.
- Existing waiver, RSVP, check-in and pick records keep their current ids; imported library classes keep their old Square ids where needed, so nothing has to be re-keyed.
- The Square-session code, guest-seat customers and the class scripts are removed once the last Square class has run.

### Tests with real money (stage 1)

A hidden $5 / $1 test class on prod, before any customer uses it:

1. Adult + 2 Kids, card: one charge, right total with tax, receipt lines, ledger seats.
2. Apple Pay, one person.
3. Full series and a one-day pass on a 2-session class: seats taken on the right days.
4. A POS sale of the test class item: the ledger gets a counter seat.
5. Refund in /admin: seat released, Square refund matches.
6. Gift card, if one is on hand.

## Stage 2: parties

- Parties become our records on the new schedule (they already are, alongside a Square booking). Square's appointment booking is dropped, which lets Appointments Plus go.
- **Party times on /admin**: which days and start times are offered, length, booking window and notice, blocked dates. Today these are code changes.
- **Packages**: the current whole-studio party ($300, 10 to 30 guests, 90 minutes) to start; room for more ("table party").
- **Add-ons**: extra half hour, goodie bags, food and drink (once licensing allows), each priced.
- **Pay the balance online** before the day (optional).
- Per-guest crafts stay on the POS, as today.
- /admin: book, move or cancel a party for someone on the phone; the shared schedule refuses clashes.
- Tests: book, move, add-on, balance online, refund, with real money on a test package.

## Stage 3: staff availability and assignments

- **/staff → My availability**: mark times you can work, times you can't, and "I'd like to work this" on a class or party.
- **/admin → Staffing**: each class and party shows who is available, who asked, and who is assigned; assign with a tap. Unstaffed events are flagged in the daily warnings.
- **/staff → My schedule**: what you're assigned to.
- Calendar link for phones (read-only, updates itself): owners see everything; staff see their own assignments.
- Separate from Square payroll and timecards.

## Stage 4: extras

- **Waitlist**: a full session takes names; when a seat frees up, the next person gets a text and email with a link that holds the seat for a set time (default 12 hours), then it moves down the list.
- **Promo codes**: $ or % off, on chosen classes or everything, with an end date and a use limit.
- **Early-bird pricing**: a lower price per cell until a date.
- **Repeating dates**: schedule a class every week / every 2 weeks / custom, until a date.
- Later, room left for: memberships and punch cards.

## Rules carried over

- Never cancel or refund a booking automatically. Owners do, from /admin, after a confirm that names the people.
- No guessed Square writes: every new Square call is proven on a test before it is used for customers.
- Copy is shown to Kaden before it goes on the site; no colons in customer copy; no timelines in copy.
- Parties are for any occasion, never "birthday".
- Test texts go only to Kaden's number.
- Prod pushes only on Kaden's go; dev previews share live stores, so staff/admin tests there write real records.

## Decisions (18 Oct)

- Waitlist: when a seat frees up, the next person on the list is added and charged automatically to the card they saved when joining (Square Cards API stores it; we never do), then texted "You're in". Real-money test before launch.
- Minimum to run: set per class.
- Crew see the /admin calendar, read-only.
- Refunds: owners, and crew with a reason (logged with their name).
- Assigning staff is /admin only. Crew mark availability and ask to work things; they never assign. A future general manager gets /admin.
- Scheduling edits the details right there. Saving offers "Just this date" or "Also update the library". Every library save is a version (who, when, what changed); an old version can be restored. A scheduled class records the version it came from, so a library change never alters a booked class.
- Multi-day classes choose per class: sign-ups close before the first session, or people can join partway. Joining partway is its own pass (the remaining sessions, its own price); a class may offer either, both, or neither.

## Refunds, seats and the waitlist

- Refunds run from /admin (owners) or /staff (crew, with a reason). Pick whole booking, one person, one day, or a custom amount; choose "Refund and free the seat" or "Refund, keep their seat".
- RefundPayment for exactly the line price + its tax against the booking's single payment; then update the ledger, run the waitlist if a seat was freed, send our refund email, log who/why.
- Waitlist: next person's saved card is charged, they're added and texted; a decline moves on and alerts owners. Per-class waitlist cutoff (e.g. 2 h before start); after it a freed seat stays open. Goodwill refunds never touch the waitlist.
- Refunds made in Square arrive by webhook: POS returns of class items with restock free those seats; plain money refunds are flagged on /admin and /staff ("Free a seat?") and never guessed.
- Cancel a class lists everyone; "Refund everyone" is a separate confirm. Cancelling never refunds.
- Square limits: 20 refunds per payment, 1 year.

## Square API review

All calls are public and documented; the undocumented class/dashboard calls are retired.

| Action | Call | Live for us | Risk | Proof |
|---|---|---|---|---|
| Charge (card, Apple Pay, Google Pay) | CreatePayment + order | yes (parties) | Low | proven |
| Order with catalog lines | CreateOrder | ad hoc yes, catalog no | Low | $5/$1 test |
| 9% tax | pricing_options.auto_apply_taxes (never also order.taxes) | no | Medium | test charge |
| Promo discounts | order discounts | no | Low | test charge |
| Gift card payment | gift card token as source | no | Medium | real gift card test |
| POS catalog (items, prices, photos, category) | UpsertCatalogObject, CreateCatalogImage | yes | Low | proven |
| Customers | SearchCustomers, UpdateCustomer | yes | Low | proven |
| Refund | RefundPayment (amount) | no (kits code, never run) | Medium | test refund |
| Save card (waitlist) | CreateCard + consent + STORE verification | no | Medium | test card |
| Charge saved card | CreatePayment with card id (seller-initiated) | no | Medium-high (some banks decline) | live test; decline → next person |
| POS sales/refunds | webhooks order.updated, payment.updated, refund.created/updated | not set up (no SQUARE_WEBHOOK_SIGNATURE_KEY) | Medium | Kaden subscribes; POS test sale |
| Missed-webhook catch-up | SearchOrders nightly | yes | Low | proven |
| Parties off Bookings API (stage 2) | stop calling | — | Low | then cancel Appointments Plus |

Prerequisite (Kaden): webhook subscription in Square's developer dashboard + set SQUARE_WEBHOOK_SIGNATURE_KEY on Netlify.
