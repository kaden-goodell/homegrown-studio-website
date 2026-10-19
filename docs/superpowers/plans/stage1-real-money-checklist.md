# Stage 1: our own classes, tested with real money

For Kaden. Do these in order. Parts A and B use no real money. Part C goes on
the live site once the branch is on production (only when you say so). Each
step says what to look at afterwards. If something doesn't look right, stop
there and tell me what you saw.

## A. The sandbox run (no real money)

1. From the repo root in Claude Code, run this one line. It reads the two
   passcodes straight from Netlify into the script; they are never printed.

   ```
   ! ADMIN_PASSCODE="$(npx netlify env:get ADMIN_PASSCODE --context branch:kaden/own-booking-system)" STAFF_PASSCODE="$(npx netlify env:get STAFF_PASSCODE --context branch:kaden/own-booking-system)" npx tsx scripts/sandbox-e2e.ts
   ```

   It only talks to the branch preview and the Square sandbox. It refuses any
   other site, ourhometownstudio.com included. It takes about 20–25 minutes,
   mostly waiting: the booking page only allows a few tries a minute, and
   scenario 5 waits for a class to start.

   To also check every order, payment and refund on Square's side (and run
   scenarios 11 and 22), put `SQUARE_SANDBOX_ACCESS_TOKEN="…"` in front of
   `npx tsx`, with the sandbox token from the Square Developer page
   (Sandbox, Credentials). Without it those checks say "not checked".

   To run one scenario again: add `--only 5` at the end. To see the list
   without running anything: `npx tsx scripts/sandbox-e2e.ts --dry-run`.

2. What to look at: the table at the end. Every line should say PASS (or
   SKIP for 11 and 22 without the sandbox token). A FAIL line says what was
   expected and what came back; send me the table.

3. Expect about 15 confirmation emails at kaden+e2e@ourhometownstudio.com and
   booking texts to the owners' phones. They are sandbox bookings: no money
   moved. Every test class is named "E2E …", is link-only, and is cancelled
   at the end (with its library entry archived). In /admin you may see them
   under Cancelled.

4. **If a run stops part way** (you press Ctrl-C, the laptop sleeps, the
   wifi drops): Ctrl-C already clears up the scenario that was running
   before it stops. If it couldn't, or the run just died, run the same line
   as in step 1 with `--cleanup-only` added at the end. It runs no tests; it
   cancels any "E2E …" class still open (never refunding anyone), archives
   their library entries, and removes "E2E block" time and the
   "E2E closure" day from the studio settings. Add `--dry-run` to see what
   it would do first.

   What to look at: it prints each thing it cleared and ends with "N done,
   0 failed". /admin shows no open "E2E …" class and no "E2E closure" day.

## B. Setting up the live site (no money yet)

Do these on production only after the branch has gone to production.

5. **The webhook** (Square Developer page, your app, Production, Webhooks).
   Add a subscription (or edit the one already pointing at this URL):

   - URL: `https://ourhometownstudio.com/api/webhooks/square.json`
   - API version: the latest (the site uses 2026-01-22)
   - Events: `order.created`, `order.updated`, `payment.created`,
     `payment.updated`, `refund.created`, `refund.updated`

   Copy its Signature key; it goes into `SQUARE_WEBHOOK_SIGNATURE_KEY` in
   the next step. If you edited an existing subscription, its key stays the
   same. (Square's "Send test event" is checked at the end of the next step,
   once the key is set.)

6. **The four live settings** (Netlify, production context). Check each one:

   - `SQUARE_CLASSES_CATEGORY_ID`: the "Classes" category in live Square.
   - `SQUARE_CLASS_TAX_ID`: the live 9% sales tax.
   - `SQUARE_WEBHOOK_SIGNATURE_KEY`: the Signature key from step 5.
   - `SQUARE_WEBHOOK_URL`: exactly `https://ourhometownstudio.com/api/webhooks/square.json`

   `npx netlify env:get SQUARE_CLASSES_CATEGORY_ID --context production`
   shows whether one is already set. If the category or tax id is missing,
   ask me and I'll read them from live Square with the API.

   Redeploy after changing settings in Netlify.

   What to look at:
   - in /admin, open any class and press Save. No "isn't on the POS"
     warning should appear;
   - in Square, press "Send test event" on the webhook. The Netlify function
     log for `/api/webhooks/square.json` should show "Webhook received", not
     "Invalid signature".

7. **Bring in Square classes, as a dry run.** /admin, More, Bring in Square
   classes. It shows what would go into the library and what it would leave
   out, with why. Nothing is added until you press Add.

   What to look at: every live Square class you still run is in the "would
   add" list with the right name and price; anything left out has a reason
   that makes sense. Press Add only if you're happy with the list.

## C. Tests with real money (on the live site)

8. **Make a hidden test class.** /admin, New class:

   - Name "Test class", link-only on, one date a few days out, 10 seats.
   - Ticket types Adult $5 and Kid $1.
   - Open it, then copy its link.

   Make a second one, "Test class two days", link-only, two dates, with two
   passes: "Both days" $5 and "One day" (pick 1 day) $1.

   What to look at: neither shows on the public classes page. Both show in
   Square on the POS under Classes.

9. **Adult + 2 Kids, by card.** Open the first class's link on your phone.
   Book 1 Adult and 2 Kids with a real card.

   It should cost $7.63: $5 + $1 + $1, plus tax worked out per seat
   (45¢ + 9¢ + 9¢).

   What to look at:
   - the confirmation screen and email say $7.63;
   - Square, Transactions: ONE payment of $7.63, with three lines, each taxed;
   - /admin, the class's Bookings: 3 seats, paid $7.63.

10. **Apple Pay, one person.** Same class, 1 Adult, pay with Apple Pay.

   What to look at: $5.45 charged, Square shows it was paid with Apple Pay,
   /admin shows 4 seats taken.

11. **Full series and one day.** On "Test class two days": book "Both days"
    for 1 person ($5.45), then "One day" on the second date for 1 person
    ($1.09).

    What to look at: /admin shows 1 seat on the first date and 2 on the
    second.

12. **A sale at the counter.** On the POS, ring up 1 Adult of "Test class"
    (it's under Classes) and pay with a card.

    What to look at: within a minute, /admin shows a counter seat on the
    class ("Counter sale, no name yet"). Name it in Inbox, To decide. If it
    isn't there after 5 minutes, the webhook isn't reaching the site (steps
    5 and 6); the 3 AM check would still pick it up, or ask me to run that check
    now.

13. **Refund in /admin.** Open the step 9 booking and refund one Kid.

    What to look at:
    - the seat is released: seats left goes up by one;
    - Square shows a $1.09 refund on the step 9 payment;
    - the customer email gets one refund email (not two).

14. **Gift card**, only if one is on hand. Book 1 Adult on "Test class",
    paying with the gift card.

    What to look at: Square shows the payment came from the gift card, and
    its balance went down by $5.45.

15. **Clearing up.** Real money moved, so you decide what to give back. To
    give it all back, refund each test booking from /admin first, then Cancel
    both classes (cancelling never refunds anyone and takes them off the
    POS). The counter sale from step 12 is refunded in Square, like any POS
    sale.
