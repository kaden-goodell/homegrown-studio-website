# Private Event Quotes

> When someone asks about a private event, they get a beautiful invitation with up to three ways to celebrate, and they hold their date with a deposit without a single phone call.

Rev A · 2026-11-17 · Owner: Kaden · Status: In review
Page: (published with this rev)

## At a glance
- **Who it reaches**: everyone who fills in the private-events form, the two owners who answer them, and staff on the night
- **Release**: everything ships together (Kaden, 2026-11-17: "Everything at once")
- **Target**: on the test site (dev) today, 2026-11-17; on the live site when Kaden says go
- **Ticket**: none (this project has no ticket tracker)
- **Started from**: brainstorm with Kaden, 2026-11-17; design canvas https://claude.ai/artifact/HkGgP7AZV8GKChJAA7ZMFi (Kaden picked "C · The Invitation")
- **Checked against the current site**: yes, 2026-11-17

## Words used here
- **Item**: one thing we sell, like a terrarium or the earring bar. Every item in our Square catalog can be one.
- **Package**: a group of items with one price per person, like "Terrariums & Earrings, $75 a person".
- **Quote**: up to three packages sent to one customer on one private page.
- **Quote menu**: the owners' list of items that packages are built from, in the owners' admin screen (/admin).
- **Normal price**: what the items in a package cost at our everyday prices.
- **Cost**: what we spend on materials. Only owners ever see it.
- **Hold**: a block on our calendar so nobody else books that time. It never touches anyone's card.
- **Deposit**: the part paid now to book. The rest is paid on the day.

## Today
1. Someone fills in the private-events form: date, guests, kids or adults, where, craft ideas, extras, budget range.
2. The owners get an email and a text, and the request lands in the admin inbox as "New".
3. An owner works out a price by hand, then texts, calls or emails it back as plain words.
4. If the customer says yes, an owner books the party in the admin screen and sends the pay link (a text or email that lets a customer pay what they still owe).
5. The request is marked "Quoted" or "Booked" by hand.

Each quote is a fresh piece of math and a fresh message. The customer never sees the value they are getting, and the date is not held while they think.

## With this
1. Someone fills in the same form. Nothing about the form changes.
2. An owner taps **Make a quote** on the request. Up to three packages are already drafted around a price per person that fits their budget.
3. The owner swaps items, drops in a saved package, renames, sets photos and prices, writes a short note, and taps **Send**. The date and time are held.
4. The customer opens an invitation-style page on their phone, sees the normal price crossed out next to their price, picks a package and pays half.
5. The event is booked on the calendar, the customer gets a confirmation with the waiver link, and the owners get a text.

## People
- **The customer** (a team lead, a church youth leader, a family planning a celebration): today they wait for a reply and get a number with no picture. They need to see what the evening looks like, see the deal, and lock it in from their phone.
- **Catherine**, owner, alone on the iPad: today she does price math by hand. She needs a draft that is already mostly right and buttons that cannot confuse her.
- **Kaden**, owner: today he cannot see which quotes are open or which ones customers looked at. He needs to see viewed, picked and paid at a glance, and hear when a quote goes cold.
- **Staff on the night**: today they read party details on the staff screen (/staff). They need to see which items the group bought and how many people are coming, so they can set up.

## Moments
### 1. The quote is mostly written before the owner touches it
The request has a **Make a quote** button. Up to three packages appear, filled from the quote menu, around a target price per person the owner can change.

### 2. The owner sees how close each package is to the 25% cap
Each package shows normal price, their price, and a meter: green under 20% off, yellow from 20% to 25%, red past 25%. Cost and "you keep about" (price minus cost) show only here.

### 3. The time is already taken
If a class or party already has that time, Send stops and names it ("Workshop: Christmas Embroidery, 7 PM"). The owner picks another time, or sends without a hold.

### 4. The customer gets an invitation, not a price list
Polaroid photos, "An Evening of Making", the packages set out like a menu with dotted lines to each price, the normal price crossed out and their price large. A "Questions? Text us" line sits at the bottom.

### 5. One tap holds the evening
They pick a package and pay half with Apple Pay, Google Pay or a card. If the card is declined or they close the payment sheet, the packages stay on screen with a plain "try again" line.

### 6. After paying, the link becomes a receipt
The same link now shows the package, what was paid, what is still due and how to pay it, the date, and the waiver link. There are no pay buttons.

### 7. A quote goes cold
When a quote expires unpaid, the owners get a text with the customer's name and date, and the held time opens up. An owner can also tap **Withdraw** at any time; the link then says the quote is no longer available.

## What it does
- **MVP.1** Owners keep a **quote menu**. It starts loaded with every item in our Square catalog, with Square's name, price and photo. Café items come with their known costs; owners fill in the rest. Owners can add their own items (for example "Travel") with a photo, normal price (per person or per event), cost and tags (kids, adults, holiday). You'll know it works when the quote menu lists every Square item on first open, and Catherine alone on the iPad adds a new item with a photo, price, cost and tag in under two minutes, from tapping Add to seeing it in the list.
- **MVP.2** Owners can **save a package** and add it to any later quote in one tap. A saved package uses today's menu prices when added. You'll know it works when a three-item package saved on one quote appears on the next quote with one tap, with the same name, items and photos.
- **MVP.3** **Make a quote** sets a target price per person: the middle of their budget range divided by guests, rounded to the dollar. With no budget, the target is the normal price of the drafted Our pick package. It then drafts Simple at 80% of the target, Our pick at the target, and All out at 130%, choosing items whose tags fit the request. A package it cannot fill from the menu is left out, not shown empty. You'll know it works when a request for 25 adults with a $1,000 to $2,500 budget opens with a target of $70 a person ($1,750 ÷ 25) and packages at about $56, $70 and $91.
- **MVP.4** The owner can **change anything** in a package: swap, add or remove items, add a one-off line, rename it, pick its photo, set its price, hide it from the customer, and write the note at the top. A sent quote can be changed until it is paid; the customer's page then shows "Updated" with the date, and the owner chooses whether to send the link again. You'll know it works when an owner changes a price from $70 to $65 after sending, and the customer's open link shows $65 and "Updated" on refresh.
- **MVP.5** The **25% cap** is a setting and means 25% off the package's normal price. The meter shows green, yellow or red (Moment 2). Past the cap, Send asks once more, then sends. You'll know it works when a package at 30% off shows red and sends after one confirm, and raising the cap to 30% turns it yellow.
- **MVP.6** **Send** texts and emails the customer the link, marks the request "Quoted", and holds the date and time until the quote expires (14 days by default, changeable per quote). Owners can **resend** the link and **withdraw** the quote; withdrawing lets the held time go. You'll know it works when, after Send, the text and email arrive on Kaden's phone, the request shows Quoted, and the public party booking page no longer offers that time.
- **MVP.7** The customer page follows the Invitation design on the canvas linked above, on a phone first, with no sideways scrolling. It never shows cost or margin. An expired or withdrawn link shows only "This quote is no longer available. Text us at (256) 464-1710", and the number opens a text. You'll know it works when Kaden compares the page on his iPhone with the canvas and signs off, and an expired link shows only that message.
- **MVP.8** The customer picks a package and pays a **deposit** (50% by default, changeable per quote) with Apple Pay, Google Pay or a card. The quote becomes a booked event under the usual party terms (linked from the page): it shows on the staff screen with the package's items and guest count, the customer gets a confirmation with the waiver link, and the owners get an email and a text. The balance shows on the event, and the existing pay link can be sent from it. You'll know it works when a $1 test card deposit on dev books the event on the calendar within a minute of paying, with the items listed on the staff screen, and Kaden pays the remaining balance through the pay link sent from that event.
- **MVP.9** The price charged is always the price the owner set. If the time was taken, the quote expired, or the owner changed the price while the page was open, nothing is charged and the page says which one in a single sentence. A declined card or a closed payment sheet leaves the packages on screen to try again. If a card is charged but the booking can't be made, the owners get a text at once and the customer is told we'll be in touch. You'll know it works when a deposit attempted on an expired quote shows the expiry sentence and no payment appears in Square.
- **MVP.10** The request shows the quote's furthest step: **Sent**, **Viewed** (with a count; owner previews don't count), **Picked** (chose a package, not paid), **Paid**, **Expired** or **Withdrawn**, plus who sent it and when. You'll know it works when opening the link twice on a phone shows "Viewed twice" on the request.
- **MVP.11** Each quote downloads as a **one-page PDF flyer** in the Invitation style, with a QR code (a square barcode a phone camera opens) back to the link. It never shows cost. You'll know it works when a three-package quote with a long note prints on one US Letter page and the iPhone camera opens the quote from the QR.
- **MVP.12** An owner can mark a quote **At the customer's place**. It is booked the same way but shows only on the staff calendar and never blocks the studio. You'll know it works when a paid "at your place" quote for Saturday 2:00 shows on the staff screen, and the public party booking page still offers Saturday 2:00 at the studio.

Holding a time, in order:
1. When an owner sends a quote for the studio, the date and time are held on our calendar.
2. If a class or party already has that time, Send says so first (Moment 3).
3. When the quote expires or an owner withdraws it, the hold is let go. This is our hold, never a customer's booking.
4. When the customer pays the deposit, the hold becomes a booked event. If the time was taken meanwhile, nothing is charged.

## Release plan
- **This release** (on dev 2026-11-17, live when Kaden says go): all twelve items above.
- **If the day runs short**, these move to the next release in this order, and quotes still work end to end without them: the PDF flyer (MVP.11), then at-your-place events (MVP.12), then saved packages (MVP.2), then the Viewed count (MVP.10).
- **Not in this release:**
  - **NEXT.1** The customer can tick optional add-ons on and off and watch the total change.
  - **NEXT.2** A reminder text to the customer two days before a quote expires.
  - **LATER.1** Paying the balance online before the day without an owner sending the link. The pay link covers it for now.

## Milestones
All on 2026-11-17, in this order. Each needs the one before it.
- [x] m1 · Quote menu loaded from Square, saved packages work on dev · 2026-11-17 · Every Square item is listed, and an owner adds an item and saves a package on the iPad
- [x] m2 · Make and send a quote on dev · 2026-11-17 · A draft appears from a real request, Send texts Kaden, and the link opens the customer page
- [ ] m3 · Customer page and deposit on dev · 2026-11-17 · A $1 test deposit books an event on the dev calendar and the link turns into a receipt
- [x] m4 · PDF flyer on dev · 2026-11-17 · The flyer prints on one page and the QR opens the quote
- [ ] m5 · Catherine's iPad trial on dev · 2026-11-18 · Catherine alone makes, changes and sends a quote with Kaden watching and not helping
- [ ] m6 · Live on the site · when Kaden says go · The first real quote goes to a customer

## Scope
- **In this release**: all twelve items under What it does.
- **Waits**: optional add-on toggles for customers and expiry reminders (useful, not needed to book the first event); online balance payment (the pay link already works).
- **Not building**: changes to the private-events form (Kaden chose to keep it as is); automatic cancelling of any customer booking (house rule: never cancel a customer's booking); quotes for regular weekend parties (those book online already).
- **Existing requests**: Make a quote shows on every open request. It warns first if the request is already marked Quoted or Booked by hand.

## What it touches
| Area | What changes for people | Effect | Checked |
|------|------|------|------|
| Admin inbox, request | New **Make a quote** button, quote status, resend and withdraw | New | yes |
| Admin, new Quote menu tab | Owners see every Square item, add their own, keep saved packages | New | yes |
| Admin settings | 25% cap, default deposit (50%), default expiry (14 days) | New | yes |
| Customer quote page | New private page per quote, Invitation design | New | yes |
| Party calendar and public party booking | Held times while a quote is open; booked events after a deposit | Changed | yes |
| Staff screen | Quote events show the package's items and guest count | Changed | yes |
| Customer emails and texts | Quote link message; deposit confirmation with waiver link | New | yes |
| Owner alerts | Email and text when a deposit is paid; text when a quote expires unpaid | Changed | yes |
| Pay link | Sent from a quote-booked event for the balance | Changed | yes |

## Measures
| Measure | Today | Target | Read on | Kind |
|------|------|------|------|------|
| Share of private-event requests that end in a paid deposit | counted from the last 90 days of the admin inbox before launch, written here at launch | 10 points higher than today | 60 days after the first real quote | goal |
| Average discount off normal price across paid quotes | none yet | 25% or less, read once 5 or more quotes are paid | 60 days after the first real quote | limit we stay within |

## Open decisions
None open. Decided by Kaden on 2026-11-17:
- **d1** Expired quotes let their held time go on their own, and owners can withdraw a quote to let it go sooner.
- **d2** Travel is a "Travel" item in the quote menu that owners add and price on each quote.
- **d3** Quote deposits follow the same cancellation terms as parties.

## Who signs off
- **Signs off**: Kaden, owner. Checks the customer page against the Invitation design and the pricing rules.
- **Gives input**: Catherine, owner. Tries every owner screen alone on the iPad (m5).
- **Kept posted**: nobody else.

## Trace
Filled in as the work is built.

| Outcome | Spec items | Plan tasks | Status | Proof |
|------|------|------|------|------|

## Revisions
| Rev | Date | By | What changed | Where |
|------|------|------|------|------|
| A | 2026-11-17 | Kaden with Jig | First version from the brainstorm. Checked: review swarm, 4 specialists, 46 notes; the main ones folded in (withdraw, receipt after paying, Square catalog loaded into the menu, fallback order, staff view, clearer checks). | Whole document |

## Log
- 2026-11-17 · jig · rev · Rev A drafted from the 2026-11-17 brainstorm.
- 2026-11-17 · jig · review · Four PRD reviewers found no blockers. Their main gaps (withdraw, receipt, empty menu on day one, fallback order, staff view, untestable checks) are fixed in Rev A.
- 2026-11-17 · jig · spec · Spec written: docs/plans/2026-11-17-event-value-quote-spec.md, 57 checklist items covering MVP.1–MVP.12; spec review folded in (payment safety, hold under the future party id, quote-party copy everywhere).
- 2026-11-17 · jig · build · All 17 plan tasks built and reviewed; 530 test files / 7,267 tests pass, 0 type errors; end-to-end test draft → send → view → pick → deposit → balance passes. m1, m2, m4 built; m3 waits on the $1 card deposit on the dev preview. Pushed to dev at 648d319b (not production).
- 2026-11-17 · Kaden · scope · Wants a "build your evening" mode (customer picks crafts, each with a time, ~20% off whole-dollar group prices). Done by hand for The Corky Child Care Collective; goes into Rev B.
- 2026-11-17 · Kaden · decision · d1 expiry lets the hold go plus a Withdraw button; d2 Travel as a menu item; d3 party cancellation terms.
