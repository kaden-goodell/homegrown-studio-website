# Stage 2: parties on our own records, tested with real money

For Kaden. Nothing here is run by Claude. Parts A and B use no real money.
Part C goes on the live site only when **you** decide to switch parties over
(the branch never reaches production without your go). Each step says what
to look at afterwards. If something doesn't look right, stop there and tell
me what you saw.

Part D is for Catherine, for every day once it's on. It needs no developer.

## A. The sandbox run (no real money)

1. From the repo root in Claude Code, run the same one line as for stage 1,
   with the party scenarios picked:

   ```
   ! ADMIN_PASSCODE="$(npx netlify env:get ADMIN_PASSCODE --context branch:kaden/own-booking-system)" STAFF_PASSCODE="$(npx netlify env:get STAFF_PASSCODE --context branch:kaden/own-booking-system)" npx tsx scripts/sandbox-e2e.ts --only 24-40
   ```

   It only talks to the branch preview and the Square sandbox and refuses
   any other site. Leave out `--only 24-40` to run the classes (1–23) too.
   It takes about 25 minutes, mostly waiting: /book and the payment page
   only allow a few tries a minute.

   Before the first run, the preview needs a party craft. In /admin on the
   preview, More, "Set up sandbox", then set `SQUARE_PARTY_CRAFT_CATEGORY_ID`
   for the branch as it says and redeploy. Without it every party scenario
   says SKIP with that same instruction. Party bookings must be open on the
   branch (`BOOKINGS_OPEN` includes parties), and `DEV_BYPASS_PAYMENT` must
   be off there, or the scenarios say so and fail.

   To also check every order, payment and refund on Square's side (and run
   scenario 40 and the To decide half of 27), put
   `SQUARE_SANDBOX_ACCESS_TOKEN="…"` in front of `npx tsx`.

2. What to look at: the table at the end. Every line should say PASS (40
   says SKIP without the sandbox token). After the table it prints "Putting
   back what the run changed: done: take the test package, extras and days
   out of Parties setup". A FAIL line says what was expected and what came
   back; send me the table.

3. What it does to the preview while it runs: Parties setup gets a $1 "E2E
   … Test party" package (Only with the link), a $1 "E2E … extra half hour",
   a $1-a-guest "E2E … bags", and twenty dated party days at 4 AM and 6:30
   AM on Mondays to Wednesdays three or more weeks out. Every test party's
   host is "E2E …", with kaden+e2e@ourhometownstudio.com and your phone.
   Expect booking emails, payment links and texts, all to you (the preview
   sends every email and text to you anyway). Each scenario cancels its
   parties when it ends (cancelling never refunds). Only scenarios 35, 36,
   37 and 40 refund, and only sandbox money.

4. **If a run stops part way**: Ctrl-C puts Parties setup back and cancels
   the running scenario's parties before it stops. If it couldn't, run the
   step 1 line with `--cleanup-only` instead of `--only 24-40`. It cancels
   every "E2E …" party in the next 120 days, frees any time still held for
   one, takes the "E2E" package, extras and 4 AM test days out of Parties
   setup, and clears the stage-1 leftovers. Add `--dry-run` to see the plan
   first.

## B. Look through the preview (no money)

On the branch preview, on the iPad (1024 px wide) and on your phone (about
400 px wide). Card numbers: Square's sandbox test card 4111 1111 1111 1111,
any future date, any CVV, any ZIP.

5. **Book a party by phone, card.** /admin, Home, + Book a party. Pick a
   party time, the craft, 12 guests, a host with your phone and email, Take
   card now. Square's card box shows in the middle of the sheet (on the
   iPad it is not hidden under the footer). Charge it.

   What to look at: the party opens with "Paid", the confirmation email
   arrives, the time is gone from /book.

6. **Move, then tell them.** On that party, Move, pick another free time.
   The sheet shows "Let <name> know" with Call, Text and Email the new
   details. Tap Email the new details.

   What to look at: one email with the new time and a calendar invite; the
   "Host not told yet" note goes away.

7. **Parties setup over a booked party.** More, Parties setup. Take away
   the start that party is on, Save.

   What to look at: "Saved. New bookings use these." and the party listed
   as still booked. Put the start back.

8. **Phone and iPad layouts.** On a party with two payments and an extra:
   the Payments tab, the three guest fields in Book a party (labels may wrap,
   nothing should be cut off), the "Host not told yet" row (Call, Text,
   Write to <name> wrap onto lines, not squeezed). Every button is easy to
   tap.

## C. Tests with real money (live site, only after your go)

Do these on production only after you've decided to switch parties over and
the branch is on production. Use a time at least eight weeks out so a test
party never sits on a time a customer wants this month.

9. **Before anything: Square's own messages (OWNER-2).** In the Square
   Dashboard, open Appointments settings and the customer notifications
   (confirmations and reminders). Write down whether hosts get a Square
   reminder before their party.

   Why: parties booked from now on are not Square bookings, so Square sends
   them nothing. Parties already booked in Square keep getting Square's
   messages until they've run. If hosts get a Square reminder today and you
   want new parties to get one too, tell me before step 21; I'll add our own
   party reminder first.

10. **Make the test package and extra.** /admin, More, Parties setup:

    - + Add a package: "Test party", $1, 90 minutes, fewest 1, most 4,
      usual 1, who can book "Only with the link".
    - + Add an extra: "Test extra half hour", $1, per party, 30 extra
      minutes, **Offered online off** (extras aren't tied to a package, so an
      online one would show on everyone's /book).
    - Save, then copy the test package's link (`/book?package=…`) from the
      package.

    What to look at: /book without the link shows only the real package and
    no test extra.

11. **Book online with Apple Pay ($1).** Open the link on your iPhone, pick a
    free time eight weeks out, any craft, 1 guest, pay with Apple Pay.

    What to look at:
    - one $1 payment in Square, receipt line "Party — Test party";
    - the party on the /admin calendar, "Paid";
    - the confirmation email, and the owners' booking text;
    - **nothing new in Square Appointments** (no booking on that day).

12. **Move it.** Open it on /admin, Move, another free time. Use Text in
    "Let <name> know" to text yourself.

    What to look at: the old time is back on /book; the new one is gone.

13. **Add the extra.** + Add an extra, Test extra half hour.

    What to look at: the next party time that day is gone from /book;
    Payments shows $1 due.

14. **Pay it by the link ($1).** Send payment link (to your phone). Open the
    text, pay $1 with a real card.

    What to look at: Paid; a receipt; the owners' text. If the card asks for
    an extra check (a bank pop-up) and then fails, stop and tell me: that is
    the verification step we left for this moment.

15. **Book by card on the iPad ($1).** /admin on the iPad, + Book a party,
    package Test party, a free time eight weeks out, Take card now, type a
    real card into Square's card box.

    What to look at: charged $1, "Paid", the confirmation email.

16. **Refund one payment from /admin.** On the step 15 party, Payments,
    Refund $1. The confirm names the host and the amount.

    What to look at: Square shows a $1 refund on that payment; Payments
    shows it; the party stays booked; the host gets one refund email.

17. **Refund in Square.** In the Square Dashboard, refund the step 11 $1
    payment.

    What to look at: within a few minutes (or after the 3 AM check) it shows
    once on that party's Payments tab as refunded in Square.

18. **Crew refund needs a reason.** On /staff, open the step 14 party's
    roster, Refund. Leave the reason empty: it won't go. Type a reason, then
    tap Cancel at the confirm (no money).

19. **Cancel both test parties.** Cancel on each.

    What to look at: "Nothing was refunded" (the step 14 extra is still
    paid: refund it from Payments if you want it back); both times are back
    on /book; the guest invite link says "This party was cancelled."

20. **Gift card**, only if one is on hand: book the test package online with
    it. Square shows the gift card paid $1.

21. **Switching off Square for parties**, only once Parties setup shows
    "Parties still booked in Square: None":

    - In Square, turn off online booking for the party service, so nobody
      books a party where the site can't see it.
    - In Parties setup, untick "Keep their times blocked on the calendar"
      and Save. From then on the site never asks Square's bookings again.
      (The box can't be unticked while a Square-booked party is still to
      come.)
    - Wait a day of normal bookings. Then cancel Appointments Plus.
    - Archive the Test party package and the test extra in Parties setup.

## D. Catherine's guide: parties, day to day

Everything here is in /admin on the iPad or your phone. Nothing is ever
sent to a host on its own and nothing is ever cancelled or refunded on its
own: the site tells you, and you press the button.

### Booking a party for someone on the phone

1. /admin, Home, **+ Book a party** (or open a day on the Calendar and tap
   + Book a party there).
2. Pick the **day and time**. Only free party times are listed. If they
   want a time that isn't a party time, tap **Another time** (any day,
   8 AM to 8 PM; the site still checks nothing else is on).
3. Pick the **craft**, the **number of guests**, any **extras**, and type the
   host's **name, phone and email**.
4. **How they pay:**
   - **Send payment link**: the party is booked and its time held now. The
     host gets an email and a text with a link to pay the studio fee. An
     unpaid party is never cancelled for being unpaid; it shows up as
     "waiting on payment" the week before.
   - **Take card now**: type their card into Square's card box. Cards only.
5. Crafts are always paid at the studio after the party, never online.

### On a party (tap it on the Calendar)

- **Details, Guests, Payments** tabs. Guests shows who signed and the
  invite link to copy.
- **Move**: lists only free times. Afterwards it shows "Let <name> know"
  with Call, Text and **Email the new details**.
- **Host not told yet**: after a move, a cancel or a change, this note stays
  on the party (and in To decide) until you tap **Email <name> the details**
  or, if you called or texted, **I told them**.
- **Cancel**: frees the time. It never gives money back. To give money back,
  use Refund on the Payments tab.
- **+ Add an extra** (after booking): it shows as due. Then **Send payment
  link** (the link asks only for what's due) or **Take card now**.
- **Send it again** / **Copy payment link**: send the link again, or copy it
  to send yourself.
- **Refund** (Payments tab): pick the payment, the amount, an optional
  reason. The confirm says who gets how much. "Already refunded" means it
  was done before; only use **Refund again** if you really mean a second
  refund. Crew can refund from /staff, with a reason.
- **Booked in Square**: a party from before the switch. Change it in Square
  until it has run.

### When the site asks you something

They show on the party itself, in Home, "Needs you", **To decide**, on
/staff, and in the morning warnings email.

| You see | What it means | What to press |
|---|---|---|
| Party waiting on payment | A party in the next 7 days still owes its studio fee or extras. | **Send it again**, or call them. Nothing is cancelled. |
| Host not told yet | You changed a party and the host hasn't heard. | **Email <name> the details**, or **I told them** after a call. |
| Not held on the calendar | The party's time could be booked by someone else. | **Hold this time again** on the party. If something else took it, it says what: move one of them. |
| Extra time not held on the calendar | The party's extra time isn't blocked. | **Hold this time again**. |
| Held longer than the party | The calendar blocks more time than the party has. | **Put the end time back**. |
| A cancelled party's time still held | Nobody can book that time. | **Free this time** (nothing sent, no money moves). |
| <time> still held, after a move | The party moved, but its old time is still blocked. | **Free the old time** (the party stays where it is). |
| Party time held, no party (To decide) | A time is blocked with no party on the books. | **Free this time**. It waits if a payment might still be going through. |
| Party payment unclear (To decide) | Square never answered about a payment. | Look in Square, then **It went through** or **It didn't go through**. The site checks Square agrees. |
| Party payment to check (To decide) | Square shows a payment the site couldn't book a party from (often a customer who paid, changed their mind and paid again). | **Refund it** (the whole payment goes back to their card and they get a refund email), or, when the party still owes at least that much, **Put it toward the party** (recorded as paid, no money moves). Already settled another way: **It’s already sorted**. |
| Party booked, no confirmation (To decide) | Paid and booked, but the confirmation email didn't go. | Open the party, **Email <name> the details**, then **Done**. |
| Two parties at once / class within an hour of a party | Two things clash. | **Move** one of them. |
| Paid after the party was cancelled | Money came in after a cancel. | Open the party; **Refund** on Payments if it should go back. |

### Changing party days, prices and extras

/admin, More, **Parties setup**: party days and times, dated days, the
booking window and notice, packages (price, length, guests, who can book),
extras. Save says "Saved. New bookings use these." Parties already booked
keep their time and price and are listed so you can see them.
