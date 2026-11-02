# Stage 4 real-money checklist (extras: codes, early-bird, repeats, waitlist, reader, self-cancel)

**Written, not run.** Nothing here has been done with real money. Kaden runs it on the live site only after he decides to switch the new booking system on. Until then the deliverable is the branch preview (Square sandbox), and these steps stay unchecked.

The sandbox E2E (`npx tsx scripts/sandbox-e2e.ts --only 49-67`, scenarios in `scripts/lib/sandbox-e2e/extras-scenarios.ts`) proves everything the sandbox can. This list covers what the sandbox **can't** prove, plus one live pass over the main paths. Run scenarios 49 and 61 on the sandbox first. If 49 fails (Square rounds the half cent another way), don't turn on percent codes or percent early-birds. If 61 fails (Square refuses `customer_details`), set `SAVED_CARD_CUSTOMER_DETAILS = null` before the waitlist goes live.

## Before you start

- [ ] Make a **hidden, link-only "Test" class** at **$1**, capacity **1**, taxable, starting at least 3 days out (so the 48-hour cancel works). Use your own cards. Texts go to your phone (402) 980-2907, and owner texts reach the owner numbers.
- [ ] Netlify (prod): `SQUARE_POS_CLIENT_ID` is the application id the POS API callback URLs are registered on (`https://ourhometownstudio.com/staff/pos-return`). `LOOKUP_SIGNING_SECRET` is set (the cancel links are signed with it).
- [ ] The iPad has the **Square Point of Sale** app, signed in at the studio location.
- [ ] /admin › More › Register setup shows the 9% class tax and the Classes category in use, and "Charge on the reader" is **Off**.
- [ ] Write down the time you start. Afterwards, Square › Transactions should show only the charges and refunds below.

## A. Codes and early-bird (the half cent on a live charge)

1. [ ] More › Promotions › **+ New code**: `TEST50`, 50% off, this class only, use limit 2, **Make the code**.
2. [ ] Book the test class on your iPhone with **Apple Pay** (real wallet; the sandbox can't show this) and code TEST50.
   - Expect one charge of **$0.55**: $0.50 plus $0.05 tax.
   - In Square, the tax on the line is **5 cents**. That is the half-cent case: 4.5 cents rounded half up. If Square shows 4 cents, stop. Turn TEST50 off and don't use percent codes until the rounding is fixed.
   - The receipt shows "Code TEST50". /admin › the class shows the booking with a "Code TEST50" tag.
3. [ ] Promotions › TEST50 › **Who used it** lists the booking (1 of 2 used).
4. [ ] Early-bird: on the test class tick **Early-bird price**, $0.75 until tomorrow, save. The class page shows the early-bird. Book with a **card** → **$0.82**.
   - Within the hour the register's item reads "… (early-bird)" at $0.75.
   - After midnight it goes back to $1 by itself (the hourly `class-prices` job). If it doesn't, Home says "The register still rings the early-bird price…". Check that **Fix the register price now** puts it right.
5. [ ] A **Square gift card** at checkout (real gift card; the sandbox nonce isn't one): book with a gift card that has at least $1.09 on it. The charge goes through and the gift card balance drops by exactly the total.
6. [ ] Refund one of these seats in /admin (**Refund and free the seat**). Square's refund equals what that seat was charged, tax included (Square's own line totals), never the list price.

## B. Free booking

7. [ ] Code `TESTFREE`, 100% off, use limit 1. Book → no card form, "You're booked", the confirmation email says "free". Square shows **no** order or payment.
   - Home shows no "books for free with no use limit" warning, because it has a limit.
   - Turn it off afterwards.

## C. The waitlist with real saved cards

8. [ ] Book the only seat with **card A**. On another device, open the class: it says full, with **Join the waitlist**. Join with **card B** and tick the consent. In Square › Customers, card B is on file.
9. [ ] /admin › the class › Bookings › **Refund and free the seat** on card A's booking.
   - Within a minute card B is charged **$1.09** by itself.
   - You get "You're in" by text and email.
   - The owners get the "Waitlist added…" text.
   - Card B is no longer on file in Square.
10. [ ] Join again with card B, then **Refund, keep their seat** on someone else. Nothing happens to card B. Then open the "Leave the waitlist" link in the joined email → card B is off file.
11. [ ] **Real decline (the sandbox can't do this):** join with a card you then **freeze in your bank app** (or a nearly empty prepaid card). Free the seat.
   - Expect the "didn't go through" text and email to that person.
   - The owners get the alert.
   - To decide shows "Waitlist card didn't go through" with **Got it**.
   - The next person in line (if any) is added.
   - In Square, check the failed payment's error. It must read as a decline, not a setup problem (the run must not stop with "The waitlist has stopped").
12. [ ] Unfreeze the card.

## D. Charge on the reader (a real iPad; the POS API has no sandbox)

13. [ ] Register setup › Charge on the reader › **Turn it on**.
14. [ ] On the iPad, /staff › the test class › **Sell a seat** › **Charge on the reader** → the Square app opens with **$1.09** and the note "Hometown bkg_… · Test …". Tap your card. It comes back to /staff, "Paid $1.09 on the reader", and the class list says "Paid on the reader".
    - In Square, the payment carries the note, no extra tax was added (`clear_default_fees`), and the tender is a card.
    - Record whether the return's `transaction_id` worked with RetrieveOrder. If the return said "Square couldn't be reached…", tap **Check again** (search by note); record that it seated them.
15. [ ] Refund that seat from /admin → the card gets back the full $1.09.
16. [ ] Start again and **cancel in the Square app** → back on /staff "Cancelled on the reader. Nothing was charged…", and the seat is let go.
17. [ ] Sign out of the Square app and try → the "isn't signed in" message, nothing charged. Sign back in.
18. [ ] If tipping is on in the POS, try a $0.10 tip: the seat is paid, and the tip shows in the audit, not on the seat.
19. [ ] Leave Charge on the reader **On** for the crew only after 14–17 pass. Otherwise **Turn it off**.

## E. Customers cancelling themselves (D2, a live refund)

20. [ ] Book 2 seats of the test class (3+ days out) with a card. The confirmation email has "Can't make it? Cancel or change your booking".
21. [ ] Open the link. It shows both seats at $1.09 each. Tick one › **Cancel and refund $1.09** › **Yes, cancel and refund**.
    - "Done. We refunded $1.09…" and the refund email.
    - The owners get "… cancelled 1 seat … got $1.09 back".
    - Square shows one refund of $1.09.
    - The class sheet row says "Cancelled online by the customer".
22. [ ] Tap Yes again quickly and reload the link: still one refund in Square.
23. [ ] Move the class so it starts in under 48 hours. Open the link for the other seat: it shows the policy and **Send us a note**. Send "test".
    - The owners get the text.
    - To decide shows "Customer asked to cancel". Tap **Keep their booking**.
24. [ ] Cancel the test class afterwards (never refund automatically: refund the remaining seat yourself if you want the money back).

## F. Repeats and reports

25. [ ] Add a class with **Repeat › Every week** ×3 (link-only, $1). Three classes appear on the calendar and three items on the register. Cancel them.
26. [ ] Reports: this month shows the reader charge's tax under classes, and "Money off (early-bird and codes)" shows the TEST50 and early-bird discounts.

## Known gaps (not provable before this list, and not claimed as tested)

- POS reader API end to end (no sandbox): steps 14–18.
- A real bank declining a saved card later (in the sandbox a declining card fails when it's saved, not when it's charged): step 11.
- Apple Pay with a real wallet: step 2. Real Square gift cards: step 5.
- Square's half-cent tax rounding on a live charge: step 2 (scenario 49 shows it on the sandbox first).
- The hourly early-bird register flip on the live catalog: step 4.
- A Square refund that never answers (no sandbox switch for it): covered by unit tests only. The customer sees "We're finishing your refund", the seats stay held, and To decide › **Ask Square** sends the same request again.
- Renewing an expired Square connection: no button can do it. The site says so in plain words and the register keeps working.
