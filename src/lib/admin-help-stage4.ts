/**
 * /admin › More › Help, the stage 4 (extras) part: promo codes, early-bird,
 * repeating dates, the waitlist, Register setup, Charge on the reader and the
 * customers' own cancels (D2). This branch has no admin-help.ts; the merge into
 * kaden/admin-d folds these into src/lib/admin-help.ts:
 *   - STAGE4_HELP_SECTIONS replace the `comingWith: 'extras'` sections there
 *     with the same ids (promotions, register, waitlist) and add the rest;
 *   - STAGE4_HELP_ROWS replace the `comingWith: 'extras'` rows there with the
 *     same ids (not-on-register, pos-price-stale, waitlist-unknown,
 *     waitlist-declined: their old wording named buttons that are gone) and
 *     add the rest;
 *   - STAGE4_WARNING_HELP / STAGE4_TO_DECIDE_HELP go into WARNING_HELP /
 *     TO_DECIDE_HELP;
 *   - 'extras' goes into HELP_AVAILABLE.
 * The shapes are exactly admin-help.ts's HelpSection / HelpRow. Plain words;
 * every button named in **bold** is a label the app shows (checked by
 * tests/lib/admin-help-stage4.test.ts); nothing sends Catherine to a developer,
 * the hosting dashboard, code or the Square dashboard for anything the site does.
 */
import type { WarningCode } from '@lib/warnings'
import type { ToDecideKind } from '@lib/classes/to-decide'

/** Same as admin-help.ts. */
export type ComingWith = 'staffing' | 'extras'
export interface HelpSquare { why: string; steps: string }
export interface HelpSection { id: string; title: string; intro?: string; points: string[]; square?: HelpSquare[]; comingWith?: ComingWith }
export interface HelpRow {
  id: string; see: string; where: string; means: string; tap: string; buttons: string[]; square?: HelpSquare; comingWith?: ComingWith
}

const HOME = 'Home “Needs you”, the morning email'
const TODO = 'Inbox › To decide'
const SHEET = 'The class (Bookings › Waitlist)'

// ── The screens ───────────────────────────────────────────────────────────

export const STAGE4_HELP_SECTIONS: HelpSection[] = [
  {
    id: 'promotions',
    title: 'Promotions and early-bird',
    comingWith: 'extras',
    points: [
      'More › **Promotions** › **+ New code**: the code, % off or $ off, for every class or picked classes, a last day and a use limit if you want, then **Make the code**. Customers type it under **Have a code?** when they pay for a class.',
      'On a code: **Edit**, **Turn off** / **Turn on**, and **Who used it**. **Give this use back** lets someone use a one-use code again after their booking was refunded.',
      'A code that takes 100% off (or more than the price) makes the booking free: no card is asked for and the seat is confirmed. Give such a code a use limit; Home warns you when one has none.',
      'Early-bird: on a class’s Details tick **Early-bird price**, set its last day and a lower price per seat. It ends at midnight that night, online and on the register (the register follows by itself within the hour).',
      'Someone who joined the waitlist at the early-bird price is charged that price if a seat opens later, never more.',
    ],
  },
  {
    id: 'repeat',
    title: 'A class every week',
    comingWith: 'extras',
    points: [
      'When you add a class, the **Repeat** box: **Every week**, **Every 2 weeks** or **Pick dates**, and an until date. Each date shows ✓ or why it’s skipped (closed that day, a party at that time, already past). Untick any you don’t want, then tap Add (it says how many, like “Add 6 classes”).',
      'Each date becomes its own class with its own bookings and its own spot on the register.',
      'If some dates didn’t go on, the screen says which: **Try the rest again** adds only those, never a second copy.',
    ],
  },
  {
    id: 'register',
    title: 'Classes on the register',
    comingWith: 'extras',
    points: [
      'More › **Register setup**: pick the 9% class tax and the Classes category once, then **Save**. No 9% tax yet? **Make the 9% class tax**. No category? **Make the Classes category**.',
      'After changing the tax or category, **Update them all** puts every class on the register with the new ones.',
      'A class that “isn’t on the register yet” can’t be booked online: open it and tap **Put it on the register**.',
      'If the register has the wrong early-bird price, open the class and tap **Fix the register price now**. **Update the register** on a class sends it again; it’s always safe to tap.',
      '**Charge on the reader** (also in Register setup): **Turn it on** to add it to **Sell a seat** on /staff. The crew tap it, the Square app opens with the amount, they tap the card, and the iPad comes back to the website with the seat paid. Card and gift card only; cash stays Pay at the counter.',
    ],
  },
  {
    id: 'waitlist',
    title: 'Waitlists',
    comingWith: 'extras',
    points: [
      'A full class shows **Join the waitlist** to customers. They save a card with Square and tick that we may charge it, up to the price they saw, if a seat opens before the waitlist closes.',
      'When a seat frees up (a refund that frees the seat, a customer cancelling, more seats on the class), the next person whose group fits is added and charged by themselves, and gets a text and an email. Nobody else is ever charged or moved.',
      'On the class’s Bookings, **Waitlist** shows who’s waiting, in order. **Run the waitlist now** does the same run straight away. **Remove** takes someone off (their card comes off and they get an email).',
      'If the waitlist has stopped, a line says why with the button that fixes it (**Put it on the register**, **Update the register** or **Try the waitlist again**). Until then anyone can book the free seat normally.',
      'A row that says “taking their card off file” is retried every 10 minutes by itself. **Take the card off now** tries straight away.',
      'Refunding someone but keeping their seat never starts the waitlist.',
    ],
  },
  {
    id: 'self-cancel',
    title: 'Customers cancelling a class themselves',
    comingWith: 'extras',
    points: [
      'Every class confirmation email has a “Can’t make it? Cancel or change your booking” link, just for that booking.',
      'More than 48 hours before the class, the customer picks the seats that can’t come and cancels them. They get back exactly what those seats cost, tax included, on their card, and the refund email. The seats go back on sale and the waitlist runs. You get a text saying so; the class shows “Cancelled online by the customer”.',
      'A free booking (a 100% code) can be cancelled any time before the class; nothing is refunded.',
      'Inside 48 hours, for a gift seat, a seat paid at the studio or a booking for several dates partly refunded, the page shows the policy and lets them send you a note instead. You get a text and it’s in To decide.',
      'If Square doesn’t answer a refund, their seats stay held as “Cancelling online” and it’s in To decide with **Ask Square**. Nobody is refunded twice.',
    ],
  },
  {
    id: 'reader',
    title: 'Charge on the reader (at the door)',
    comingWith: 'extras',
    points: [
      'On /staff › the class › **Sell a seat** › **Charge on the reader**: fill in who and how many, tap the charge button, finish it in the Square app, and the iPad comes back with the seat paid.',
      'If it never comes back, the class list shows “Waiting on the reader” with **Check again** and **Let the seat go**. Let the seat go asks Square first, so a paid seat is never let go.',
      'After 15 minutes it’s in To decide too: **Ask Square** or **Let the seat go**.',
    ],
  },
]

// ── When you see this → tap this ──────────────────────────────────────────

export const STAGE4_HELP_ROWS: HelpRow[] = [
  { id: 'not-on-register', see: '<class> isn’t on the register yet', where: HOME, means: 'It can’t be booked online (or rung up) until it is.', tap: 'Open the class › **Put it on the register**. If it says the class tax isn’t picked, tap **Open Register setup** and do that first.', buttons: ['Put it on the register', 'Open Register setup'], comingWith: 'extras' },
  { id: 'pos-price-stale', see: 'The register doesn’t have the early-bird price / still rings the early-bird price', where: HOME, means: 'The register’s price is out of date (it fixes itself every hour, and this says when it hasn’t).', tap: 'Open the class › **Fix the register price now**.', buttons: ['Fix the register price now'], comingWith: 'extras' },
  { id: 'register-old-setup', see: 'The register still has the old tax or category for <class>', where: HOME, means: 'You changed Register setup and this class still has the old tax or category.', tap: 'More › Register setup › **Update them all**, or open the class › **Update the register**.', buttons: ['Update them all', 'Update the register'], comingWith: 'extras' },
  { id: 'register-setup-missing', see: 'No class tax is picked yet', where: HOME, means: 'No class can go on the register or be booked online until the 9% class tax is picked.', tap: 'More › Register setup: pick the 9% tax (or **Make the 9% class tax**), then **Save**.', buttons: ['Make the 9% class tax', 'Save'], comingWith: 'extras' },
  { id: 'promo-free-unlimited', see: 'Code <CODE> books for free and has no use limit', where: HOME, means: 'Anyone who hears the code can book for free, as many times as they like.', tap: 'More › Promotions › the code › **Edit** to set a use limit, or **Turn off**.', buttons: ['Edit', 'Turn off'], comingWith: 'extras' },
  { id: 'waitlist-stopped', see: '<class>: The waitlist has stopped because …', where: `${HOME}, ${SHEET}`, means: 'A seat is free and someone waiting fits it, but the last try couldn’t go ahead (the register, or Square refusing or not answering). Nobody was charged; anyone can book the seat meanwhile.', tap: 'Open the class › the button on the waitlist line: **Put it on the register**, **Update the register** or **Try the waitlist again**.', buttons: ['Put it on the register', 'Update the register', 'Try the waitlist again'], comingWith: 'extras' },
  { id: 'waitlist-card-on', see: '<name> is off the waitlist, but Square hasn’t confirmed their saved card came off file yet', where: `${HOME}, ${SHEET}`, means: 'Their card is still saved with Square. Nothing will be charged; it’s retried every 10 minutes.', tap: 'Open the class › Waitlist › **Take the card off now**.', buttons: ['Take the card off now'], comingWith: 'extras' },
  { id: 'waitlist-unknown', see: 'Waitlist charge unclear', where: `${TODO}, ${HOME}`, means: 'The waitlist charged someone’s saved card and Square didn’t answer. Their seat is held.', tap: 'The sheet asks Square for you and says what it shows. Paid: **Add them**. No payment (after half an hour): **Keep them waiting** (that charge is never sent again) or **Take them off** (card comes off, they get an email). Still going through: **Check Square again** later.', buttons: ['Add them', 'Keep them waiting', 'Take them off', 'Check Square again'], comingWith: 'extras' },
  { id: 'waitlist-declined', see: 'Waitlist card didn’t go through / Waitlist price went up / Waitlist choice not sold any more', where: `${TODO}, ${HOME}`, means: 'The seat went to the next person. They weren’t charged and came off the list (the sheet says whether they were texted and emailed).', tap: 'Call or text them if you like, then **Got it**.', buttons: ['Got it'], comingWith: 'extras' },
  { id: 'cancel-request', see: 'Customer asked to cancel', where: `${TODO}, ${HOME}`, means: 'A customer sent a note from their “Can’t make it?” page (inside 48 hours, a gift seat, or paid at the studio). Their seats are still booked.', tap: '**Refund and free the seat** (their card gets the money back and they get the refund email), **Free the seat, no refund**, or **Keep their booking** (for studio credit or moving them). Each asks first. Then call or text them with what you decided.', buttons: ['Refund and free the seat', 'Free the seat, no refund', 'Keep their booking'], comingWith: 'extras' },
  { id: 'cancel-unclear', see: 'Customer’s cancel, refund unclear / refund turned down', where: `${TODO}, ${HOME}`, means: 'A customer cancelled online and Square didn’t answer the refund (their seats are held), or turned it down (nothing refunded, still booked).', tap: '**Ask Square**: it sends the same refund again, and Square never makes it twice; once it’s through they’re cancelled and emailed. Turned down: **Try the refund again**, or call them and tap **Got it**.', buttons: ['Ask Square', 'Try the refund again', 'Got it'], comingWith: 'extras' },
  { id: 'reader-waiting', see: 'Reader payment didn’t come back / Reader payment didn’t match', where: `${TODO}, ${HOME}`, means: 'A “Charge on the reader” sale never came back from the Square app, or Square showed a payment that doesn’t match. The seat is held, not paid.', tap: '**Ask Square**: if it shows the payment, they get their seat. If not, and they didn’t pay (or paid another way), **Let the seat go**. Nothing is refunded or charged from here.', buttons: ['Ask Square', 'Let the seat go'], comingWith: 'extras' },
]

/** The stage 4 warning codes (the merge adds each to admin-help's WARNING_HELP). */
export type Stage4WarningCode = Extract<WarningCode,
  'not-on-register' | 'pos-price-stale' | 'register-old-setup' | 'register-setup-missing' | 'promo-free-unlimited'
  | 'waitlist-unknown' | 'waitlist-declined' | 'waitlist-stopped' | 'waitlist-card-on' | 'reader-waiting' | 'cancel-request' | 'cancel-unclear'>

export const STAGE4_WARNING_HELP: Record<Stage4WarningCode, string[]> = {
  'not-on-register': ['not-on-register'],
  'pos-price-stale': ['pos-price-stale'],
  'register-old-setup': ['register-old-setup'],
  'register-setup-missing': ['register-setup-missing'],
  'promo-free-unlimited': ['promo-free-unlimited'],
  'waitlist-unknown': ['waitlist-unknown'],
  'waitlist-declined': ['waitlist-declined'],
  'waitlist-stopped': ['waitlist-stopped'],
  'waitlist-card-on': ['waitlist-card-on'],
  'reader-waiting': ['reader-waiting'],
  'cancel-request': ['cancel-request'],
  'cancel-unclear': ['cancel-unclear'],
}

/** The stage 4 To decide kinds (the merge adds each to admin-help's TO_DECIDE_HELP). */
export type Stage4ToDecideKind = Extract<ToDecideKind, 'waitlist-unknown' | 'waitlist-declined' | 'reader-waiting' | 'cancel-request' | 'cancel-unclear'>

export const STAGE4_TO_DECIDE_HELP: Record<Stage4ToDecideKind, string[]> = {
  'waitlist-unknown': ['waitlist-unknown'],
  'waitlist-declined': ['waitlist-declined'],
  'reader-waiting': ['reader-waiting'],
  'cancel-request': ['cancel-request'],
  'cancel-unclear': ['cancel-unclear'],
}
