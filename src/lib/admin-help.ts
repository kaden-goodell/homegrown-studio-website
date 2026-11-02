/**
 * /admin › More › Help (DV13): Catherine's guide, in the app. Plain words, every
 * screen, and "When you see this → tap this" for every warning and every To
 * decide item. Kept as data so tests/lib/admin-help.test.ts can check it:
 *   - every WarningCode and every ToDecideKind has a row here (the Records
 *     below also fail to compile when one is missing);
 *   - every button a row tells her to tap is a label the app really shows;
 *   - nothing here sends her to a developer, the hosting dashboard or code.
 * "Look in Square" steps appear only where Square is genuinely the only place
 * (bookings and classes made in Square before the switch, sales rung up on the
 * register), each labelled so. What Square did with a payment or a refund is
 * asked from the app itself (Ask Square, and the checks before Refund it).
 *
 * Sections marked `comingWith` describe screens that arrive when the staffing
 * (stage 3, merged) or extras (stage 4) work is merged; they stay hidden until
 * then (add the stage to HELP_AVAILABLE in that merge).
 */
import type { WarningCode } from '@lib/warnings'
import type { ToDecideKind } from '@lib/classes/to-decide'

export type ComingWith = 'staffing' | 'extras'

/** The later stages merged into this build. */
export const HELP_AVAILABLE: ReadonlySet<ComingWith> = new Set<ComingWith>(['staffing'])

/** One step that can only be done in Square, with why and the exact way there. */
export interface HelpSquare {
  /** Why only Square has it ("It was booked in Square before the switch"). */
  why: string
  /** The exact path, start to finish. */
  steps: string
}

export interface HelpSection {
  id: string
  title: string
  /** One line under the title. */
  intro?: string
  /** Each a short plain sentence or two; button names in **bold** are exact. */
  points: string[]
  square?: HelpSquare[]
  comingWith?: ComingWith
}

/** A line of the "When you see this → tap this" table. */
export interface HelpRow {
  id: string
  /** What she sees: the warning or To decide title. */
  see: string
  /** Where it shows. */
  where: string
  means: string
  /** What to tap (the button names, exactly). */
  tap: string
  /** The exact button labels `tap` names (checked against the app). Templated ones ("Email <name> the details") are left out. */
  buttons: string[]
  square?: HelpSquare
  comingWith?: ComingWith
}

// ── Square, only where it is the only place ───────────────────────────────

const SQ_LEGACY_PARTY: HelpSquare = {
  why: 'Only for a party booked in Square before the switch (it says “Booked in Square”). The site can’t change those.',
  steps: 'Square Dashboard (squareup.com, signed in) › Appointments › Calendar › go to the party’s day › tap the booking › Reschedule (to move it) or Cancel. Refunds for it: Square Dashboard › Transactions › search the host’s name › open the payment › Issue refund.',
}
const SQ_LEGACY_CLASS: HelpSquare = {
  why: 'Only for a class that still runs in Square (it opens as “Square class”). The site can’t change those.',
  steps: 'Square Dashboard (squareup.com, signed in) › Appointments › Calendar › go to the class’s day › tap the class › Edit (to move it or change its seats) or Add attendee (to add someone).',
}
const SQ_PAYMENT: HelpSquare = {
  why: 'Only Square knows what happened to the money; the site asks it but sometimes gets no answer.',
  steps: 'Square Dashboard (squareup.com, signed in) › Transactions › search the customer’s name or the amount › open the payment. A refund shows on the payment, with its state (Completed, Pending or Failed).',
}
const SQ_REFUND_PAYMENT: HelpSquare = {
  why: 'This payment isn’t on any booking here, so there is nothing on the site to refund it from.',
  steps: 'Square Dashboard (squareup.com, signed in) › Transactions › search the customer’s name or the amount › open the payment › Issue refund › the amount › Refund.',
}
const SQ_REGISTER: HelpSquare = {
  why: 'It was rung up on the register, so it goes back on the register.',
  steps: 'Square app on the iPad › ☰ menu › Transactions › find the sale (search by the name or amount) › Issue refund › pick what goes back › Refund.',
}

// ── The guide, screen by screen ───────────────────────────────────────────

export const HELP_SECTIONS: HelpSection[] = [
  {
    id: 'start',
    title: 'Getting around',
    intro: 'Everything for running the studio is here, on the iPad or your phone.',
    points: [
      'The bar at the bottom: **Home** (today, what needs you, quick buttons), **Calendar** (every class, party, café day, blocked time and closed day), **Classes** (upcoming, drafts, past and your library), **Inbox** (requests, messages, teacher applications and To decide) and **More** (setup, reports, this Help).',
      'Tap anything on the Calendar or a list to open it. The **×** at the top closes it.',
      'Nothing is ever sent to a customer, cancelled or refunded on its own. The site tells you, and you press the button. Every button that sends money back or cancels asks first and says who and how much.',
      'More › **Using as** says whose name your changes are saved under. **Sign out** asks for the passcode next time.',
      'The crew use /staff on the iPad: who’s coming, check-in, waivers, door seats. Anything only an owner should do is here.',
    ],
  },
  {
    id: 'classes-new',
    title: 'Add a class',
    points: [
      'Home › **+ New class**, or Classes › **+ New class**, or tap a day on the Calendar › **+ New class on this day**.',
      'Pick **Start fresh** or **From a past class** (copies its details; you pick new dates).',
      'Fill in the name, the description, the photo, the dates and times, then the parts that matter for this class: **Seat prices** (+ Add a kind of seat), **Ways to book**, **Extras**, **Questions** and **Ages and booking rules**.',
      '**Add class** puts it on the website for people to book, and in your library. **Save as draft** keeps it just for you until you open it.',
      'If the time clashes with a party, a class or a closed day, it says what with. Pick another time.',
    ],
  },
  {
    id: 'classes-change',
    title: 'Change, move or reopen a class',
    points: [
      'Open the class (Calendar or Classes). The tabs: **Bookings**, **Details**, **Dates**.',
      '**Details**: change anything, then **Save**. It asks **Only this class** or **This class and the library** (so next time starts from the new version too).',
      '**Dates**: change a date or time, then **Save dates**. If people are booked it asks first: **Move and I’ll tell them**. Then it lists who to tell, with **Text everyone** and **Copy the numbers**. Nobody is told for you.',
      'At the top: **Open** (people can book), **Closed** (on the website, sign-ups closed) or **Draft** (only you see it).',
      '**Run it again on new dates** makes a new class from this one, a week on, for you to adjust.',
    ],
  },
  {
    id: 'classes-bookings',
    title: 'Who’s coming',
    points: [
      'Class › **Bookings**: everyone booked, their seats, how they paid and anything refunded.',
      'Home › **Print today**, or a day on the Calendar › **Print this day**, prints the day’s lists for the table.',
      'At the door the crew check people in on /staff, add walk-ins and take payment.',
    ],
  },
  {
    id: 'classes-cancel',
    title: 'Cancel a class',
    points: [
      'Class › **Cancel class** › **Cancel this class**. Sign-ups stop and the class comes off the website. It never refunds anyone on its own.',
      'Then it lists who to contact (**Text everyone**, **Copy the numbers**), and **Refund everyone…** if you want to give the money back: it shows each person and amount, then **Refund <N> people**.',
      'If some refunds don’t go through, **Try the ones that didn’t go through**.',
    ],
  },
  {
    id: 'library',
    title: 'Your class library',
    points: [
      'Classes › **Library**: every class you’ve made, ready to run again.',
      'Open one: **Schedule it** (a new class from it, you pick the dates), **Edit details**, **Archive** (hides it; nothing booked changes) or **Bring it back**.',
      'More › **Bring in Square classes** adds the classes Square still runs to your library, so you can schedule them here from now on.',
    ],
  },
  {
    id: 'refunds',
    title: 'Refunds',
    intro: 'Money only ever goes back when you tap Refund and confirm.',
    points: [
      'A class seat: class › Bookings › tap the person › **Refund**. Pick **One person** or the whole booking, or **Another amount**, add a reason if you like, then **Confirm refund**. They get one refund email. Freeing a seat with no money back is **Free their seat**.',
      'A party: open the party › **Payments** › **Refund** on the payment. The confirm says who gets how much. The party stays booked; cancel it separately if you mean to.',
      '“Already refunded” means it was done before. Only tap **Refund again** if you really mean a second refund.',
      'A refund Square never answered shows **A refund is waiting on Square** on the booking (or on the party’s Payments). Tap **Ask Square**: it shows what Square did, then only the buttons that fit: **It went through** (recorded with Square’s refund, the customer emailed once), **Try the refund again** (never twice) or **It didn’t go through**. A new refund on that booking waits until this one is sorted.',
      'Crew can refund on /staff too, and must give a reason.',
      'If a booking says **Refund this at the register, where it was rung up.**, it was paid on the register (see below). If it says **Refund this one in Square, where it was paid.**, it was booked in Square before the switch (see below).',
    ],
    square: [SQ_REGISTER, { why: 'A class seat booked in Square before the switch was paid in Square.', steps: SQ_REFUND_PAYMENT.steps }],
  },
  {
    id: 'parties-book',
    title: 'Book a party for someone on the phone',
    points: [
      'Home › **+ Book a party**, or a day on the Calendar › **+ Book a party on this day**.',
      'Pick the day and a free time. If they want a time that isn’t a party time, tap **Another time** (any day, 8 AM to 8 PM; it still checks nothing else is on).',
      'Pick the package, the craft, the number of guests, any extras, and type the host’s name, phone and email.',
      'How they pay: **Send payment link** (the party is booked and its time held now; the host gets an email and a text with a link for the studio fee) or **Take card now** (type their card into Square’s card box).',
      'Crafts are always paid at the studio after the party, never online.',
      'An unpaid party is never cancelled for being unpaid. It shows as “waiting on payment” the week before.',
    ],
  },
  {
    id: 'parties-on',
    title: 'On a party',
    points: [
      'Tap it on the Calendar. Tabs: **Details**, **Guests** (who signed, **Copy invite link** for the host’s guests), **Payments**.',
      '**Move**: lists only free times. Afterwards it shows “Let <name> know” with **Call**, **Text** and **Email <name> the new details**.',
      '**Change details**: guests, craft, host’s phone or email.',
      '**+ Add an extra** after booking: it shows as due. Then **Send payment link** (it asks only for what’s due), **Send it again**, **Copy payment link** or **Take card now**.',
      '**Cancel party**: frees the time. It never gives money back; use **Refund** on Payments for that.',
      'After a move, a cancel or a change, “Not told yet” stays on the party (and in To decide) until you tap **Email <name> the details** or, if you called or texted, **I told them**.',
      'A party that says **Booked in Square** was booked before the switch. You can see it here but only change it in Square, until it has run.',
    ],
    square: [SQ_LEGACY_PARTY],
  },
  {
    id: 'parties-setup',
    title: 'Party days, prices and extras',
    points: [
      'More › **Parties setup**: the weekly party times, dated days (an extra or different time on one date), how far ahead people can book and how much notice, the packages (price, length, guests, who can book) and the extras.',
      'An extra with **Offered on the website** unticked can only be added by you.',
      'A package for **Only with the link** isn’t on /book; send its link to the people it’s for.',
      '**Save** says “Saved. New bookings use these.” Parties already booked keep their time and price and are listed so you can see them.',
      'Leave **Keep their times blocked on the calendar** ticked. It keeps parties booked in Square before the switch from being double-booked. It can only be unticked once none are left to come.',
    ],
  },
  {
    id: 'calendar',
    title: 'The calendar, blocked time and printing',
    points: [
      'Tap a day: everything on it, and **+ New class on this day**, **+ Book a party on this day**, **Block time on this day**, **Print this day**, **Change café hours**, **Edit closed days**.',
      '**Block time** keeps a time free of bookings: pick **Setup**, **Private event** or **Closed**, the times, and a note if you like. If something is already booked then, it says what, and asks before **Block anyway**.',
      'Open a block › **Remove this block** to free the time again.',
    ],
  },
  {
    id: 'online-booking',
    title: 'Pausing online booking',
    points: [
      'More › **Online booking**: parties and classes & workshops each **Open** or **Paused**. It changes the website within a minute. No other step is needed.',
      'Pausing asks first (**Pause parties**). People already booked keep their booking, and payment links already sent still work. The website shows your note and your phone number instead of the booking buttons.',
      'Write a short note for customers (up to 140 letters) and tap **Save note**. Left blank, it says booking is paused and to call or text the studio.',
      'To try booking while it’s paused, tap **Copy party test link** or **Copy class test link** and open it on your phone or iPad. That device can book for 30 days. Bookings made with it are real.',
      '**Make a new test link** stops every test link you gave out before.',
      'While anything is paused, Home says so, with **Open online booking**.',
    ],
  },
  {
    id: 'hours',
    title: 'Hours and Craft Café',
    points: [
      'More › **Hours & Craft Café**: the café’s usual weekly hours, then **Save café hours**. Café days can only be on days the studio opens.',
      '**+ Add a special day**: different hours on one date (a holiday, a grand opening). A special day replaces the usual hours that day; closed days beat both. It can be any day of the week: on a day the studio is usually closed, it opens the studio for Craft Café.',
      '**Studio hours** (same screen, at the bottom): each day **Open** with its times, or **Closed**, then **Save studio hours**. The days with hours are the days the studio opens. The website footer, Google’s business details on the website, the calendar and party times all follow them.',
      'If a party time wouldn’t fit the new hours, it says which one. Move it in **Parties setup** first. Parties and classes already booked stay booked.',
      'Google Maps keeps its own copy of your hours: after a change, tap **Open Google Business Profile** › Edit profile › Hours.',
      'To put a special day on the website, tick **Announce it on the website** when you add it (or tap **Announce it on the website** under a day already there): a headline (up to 60 letters) and how many days before to start showing it. The website shows a bar on every page and a big card on the home and Craft Café pages until the café closes that day. **Change the announcement** to edit or stop it.',
      '**Print a flyer** under any special day opens a letter-size flyer with the same words and a QR code to the Craft Café page. Tap **Print** (on an iPad: Share › Print).',
      'If it says Square didn’t take the café hours, tap **Try again**.',
    ],
  },
  {
    id: 'closed',
    title: 'Closed days',
    points: [
      'More › **Closed days**: add the first and last closed day and a name (Thanksgiving, a holiday week). Parties can’t be booked on closed days.',
      'To open a closed day again, **Open these days**. If something was booked before it closed, the warnings list it.',
    ],
  },
  {
    id: 'inbox',
    title: 'Inbox',
    points: [
      '**Requests** (private events and parties people asked about), **Messages** (the contact form), **Teachers** (applications to teach), and **To decide** (things only an owner should settle, below).',
      'Open one to **Call** or **Email** them. **New only** hides the ones you’ve seen.',
    ],
  },
  {
    id: 'warnings',
    title: 'Warnings and To decide',
    points: [
      'Warnings show on Home under “Needs you”, on the class or party itself, on /staff for the crew, and in the morning warnings email. To decide items are in Inbox › **To decide**.',
      'Each one says what happened and what to tap. The table below has every one of them.',
      'Nothing on either list cancels, refunds or texts anyone by itself.',
    ],
  },
  {
    id: 'reports',
    title: 'Reports',
    points: [
      'More › **Reports**: this month so far: class seats sold, class sales, class refunds, parties booked and party fees taken.',
      'Craft Café, party crafts and anything else rung up on the register are in Square’s own reports (Square Dashboard › Reports).',
    ],
  },
  {
    id: 'square-only',
    title: 'When Square is the only place',
    intro: 'Everything else is done here. Square is needed only for these, each marked “Look in Square” in the table below.',
    points: [
      'Parties and classes booked in Square before the switch, until they’ve run.',
      'Sales rung up on the register (refunds go back on the register).',
    ],
    square: [SQ_LEGACY_PARTY, SQ_LEGACY_CLASS, SQ_REGISTER],
  },
  // ── Arrive with stage 3 (staffing) ──
  {
    id: 'staff',
    title: 'Staff',
    comingWith: 'staffing',
    points: [
      'More › **Staff** › **People**: **+ Add someone** (first and last name, **Crew** or **Owner**, mobile for shift texts, email for shift emails), **Edit**, and **No longer working here** (they’re signed out of /staff and leave every list; their past shifts stay). **Working here again** brings someone back. **Stop their calendar link** turns off a lost phone’s calendar.',
      'Staff passcode: More › **Staff** › **People** › **Change the staff passcode**, type it twice (at least 6 letters or numbers), **Save new passcode**. Everyone on the iPad needs the new one, and anyone signed in to /staff is signed out. Home tells you if lots of wrong passcodes were typed today, or if the saved one can’t be read (then **Set a new staff passcode**).',
      'Who’s on: More › **Staff** shows **Needs someone**, **To check** and **Who can work** for **This week**, **Next week** or **Pick a week**.',
      'On a class or party › **Staff**: set **People needed**, then **Put on** or **Take off** each person (a class on several days also has **Every day** and **Off every day**). With **Tell them by text and email** ticked, they get a message. If a message didn’t go through, the screen says so with Call and Text buttons.',
      '**Calendar link for my phone** (bottom of More › Staff) puts every class and party, with who’s on, in your phone’s calendar.',
      'Crew set when they can work and ask to work things on /staff › My shifts.',
    ],
  },
  // ── Arrive with stage 4 (extras) ──
  {
    id: 'promotions',
    title: 'Promotions and early-bird',
    comingWith: 'extras',
    points: [
      'More › **Promotions** › **+ New code**: the code, **% off** or **$ off**, for **Every class** or **Pick classes**, a last day and a use limit if you want, then **Make the code**. Customers type it when they pay for a class.',
      'On a code: **Edit**, **Turn off** / **Turn on**, and **Who used it**, where **Give this use back** lets someone use it again.',
      'Early-bird: on a class’s Details tick **Early-bird price**, set its last day and price. It ends at midnight that night, online and on the register.',
    ],
  },
  {
    id: 'register',
    title: 'Classes on the register',
    comingWith: 'extras',
    points: [
      'More › **Register setup**: pick the **Class tax (9%)** and the **Classes category** once, then **Save**.',
      'A class that “isn’t on the register yet” can’t be booked online: open it and tap **Put it on the register**.',
      'If the register has the wrong early-bird price, open the class and tap **Fix the register price now**.',
    ],
  },
  {
    id: 'waitlist',
    title: 'Waitlists',
    comingWith: 'extras',
    points: [
      'A full class shows **Join the waitlist** to customers. On the class’s Bookings, **Waitlist** shows who’s waiting.',
      '**Run the waitlist now** adds the next person whose group fits and charges the card they saved. **Remove** takes someone off (their card comes off and they get an email).',
    ],
  },
]

// ── When you see this → tap this ──────────────────────────────────────────

const HOME = 'Home “Needs you”, the morning email'
const TODO = 'Inbox › To decide'
const HOME_STAFF = 'Home › Staffing, the morning email'

export const HELP_ROWS: HelpRow[] = [
  // Parties
  { id: 'party-waiting-payment', see: 'Party waiting on payment', where: HOME, means: 'A party in the next 7 days still owes its studio fee or extras.', tap: 'Open the party › **Send it again**, or call them. Nothing is cancelled for being unpaid.', buttons: ['Send it again'] },
  { id: 'party-no-hold', see: 'Not held on the calendar / Extra time not held on the calendar', where: `${HOME}, the party`, means: 'The party’s time (or its extra time) isn’t blocked, so someone else could book it.', tap: 'Open the party › **Hold this time again**. If something else took the time, it says what: move one of them.', buttons: ['Hold this time again'] },
  { id: 'party-held-longer', see: 'Held longer than the party', where: 'The party', means: 'The calendar blocks more time than the party has.', tap: 'Open the party › **Put the end time back**.', buttons: ['Put the end time back'] },
  { id: 'party-cancelled-held', see: 'A cancelled party’s time still held', where: `${HOME}, the party`, means: 'Nobody can book that time.', tap: 'Open the party › **Free this time**. Nothing is sent and no money moves.', buttons: ['Free this time'] },
  { id: 'party-old-time-held', see: '<time> still held, after a move', where: `${HOME}, the party`, means: 'The party moved, but its old time is still blocked.', tap: 'Open the party › **Free the old time**. The party stays where it is.', buttons: ['Free the old time'] },
  { id: 'party-hold-orphan', see: 'Party time held, no party', where: `${TODO}, ${HOME}`, means: 'A time is blocked with no party on it, usually a booking that stopped halfway.', tap: '**Free this time**. It waits by itself while a payment might still be going through.', buttons: ['Free this time'] },
  { id: 'party-not-told', see: 'Host not told yet', where: `${TODO}, the party`, means: 'You moved, changed or cancelled a party and the host hasn’t heard.', tap: 'Open the party › **Email <name> the details** (or the new details), or after a call or text, **I told them**.', buttons: ['I told them'] },
  { id: 'party-no-confirmation', see: 'Party booked, no confirmation', where: TODO, means: 'The party is paid and booked, but its confirmation email didn’t go.', tap: '**Open the party** › **Email <name> the details**, then **Done** here.', buttons: ['Open the party', 'Done'] },
  { id: 'party-paid-elsewhere', see: 'Party payment to check', where: TODO, means: 'Square took a payment the site couldn’t book a party from (often someone who paid, changed their mind and paid again).', tap: '**Refund it** (the site asks Square first; what is left on the payment goes back to their card, they get a refund email), or, when the party still owes at least that much, **Put it toward the party** (recorded as paid, no money moves). If Square already refunded it, only **It’s already sorted** is offered; if some went back, **Refund the rest**. A refund Square never answered is finished with **Refund it** (never twice). Already settled another way: **It’s already sorted**.', buttons: ['Refund it', 'Put it toward the party', 'It’s already sorted'] },
  { id: 'party-booking-unclear', see: 'Party payment unclear (a new booking)', where: TODO, means: 'Someone was paying for a new party and Square never answered.', tap: '**Confirm the party** or **It wasn’t paid**. Both ask Square first and act only on what it shows: Confirm books it once Square shows the payment (the host gets their confirmation); It wasn’t paid only works when Square shows no payment, and lets the held time go.', buttons: ['Confirm the party', 'It wasn’t paid'] },
  { id: 'party-payment-unclear', see: 'Party payment unclear (on a booked party)', where: TODO, means: 'A payment by link or a card taken here got no answer from Square.', tap: '**Ask Square**. It shows what Square did with the payment, then only the buttons that fit: **It went through** (recorded on the party, the host emailed once) or **It didn’t go through** (a new payment can start). The site asks Square again when you tap, so it can’t record the wrong one. Until you decide, Move and Cancel on that party wait.', buttons: ['Ask Square', 'It went through', 'It didn’t go through'] },
  { id: 'party-paid-after-cancel', see: 'Paid after the party was cancelled', where: `${HOME}, the party`, means: 'Money came in after a cancel.', tap: 'Open the party › Payments › **Refund**, if it should go back.', buttons: ['Refund'] },
  { id: 'two-parties', see: 'Two parties at once', where: HOME, means: 'Two parties are booked too close together.', tap: 'Open one › **Move**. If one says “Booked in Square”, move the other, or move that one in Square.', buttons: ['Move'], square: SQ_LEGACY_PARTY },
  { id: 'party-on-closed-day', see: 'Party booked on a closed day', where: HOME, means: 'A party is on a day you closed.', tap: 'Open the party › **Move**, or More › Closed days › **Open these days**. A party booked in Square is moved in Square.', buttons: ['Move', 'Open these days'], square: SQ_LEGACY_PARTY },
  { id: 'parties-unreadable', see: 'Parties / Parties booked in Square couldn’t be checked', where: HOME, means: 'The check couldn’t read the parties just now (a hiccup reaching our records or Square).', tap: 'Refresh the page to try again. If it’s still there after an hour, look over the day on the Calendar yourself; the check runs again every time Home opens.', buttons: [] },

  // Classes and parties together
  { id: 'class-over-party', see: '<class> is within an hour of the <name> party', where: HOME, means: 'A class and a party are too close together.', tap: 'Open the class › **Dates** to move it, or the party › **Move**. A class or party from Square is moved in Square.', buttons: ['Move'], square: SQ_LEGACY_CLASS },
  { id: 'class-over-class', see: '<class> is within an hour of <class>', where: HOME, means: 'Two classes are too close together.', tap: 'Open one › **Dates** › move it › **Save dates**. A Square class is moved in Square.', buttons: ['Save dates'], square: SQ_LEGACY_CLASS },

  // Classes
  { id: 'oversold', see: '<class>: more seats sold than it has', where: HOME, means: 'More people are booked than the class holds.', tap: 'Open the class › Bookings, then raise the seats on Details or move someone to another date and tell them. A Square class is sorted in Square.', buttons: [], square: SQ_LEGACY_CLASS },
  { id: 'capacity-unknown', see: 'Can’t count seats sold for <class>', where: HOME, means: 'A class from Square has no seat count, so extra bookings can’t be spotted.', tap: 'On /staff, open the class › **⋯** › **Event settings** › **Capacity**, set it, save.', buttons: ['Capacity'] },
  { id: 'picks-missing', see: '<class>: N seats have no <choice>', where: HOME, means: 'Someone booked without picking (usually on Square’s own page).', tap: 'Call them and ask, so you prep the right thing.', buttons: [] },
  { id: 'recorded-over-sold', see: '<class>: recorded seats more than Square shows', where: HOME, means: 'Someone was added here to a class that still runs in Square, but not in Square, so Square could sell their seat again.', tap: 'Add them in Square.', buttons: [], square: SQ_LEGACY_CLASS },
  { id: 'below-minimum', see: 'Short of its minimum', where: `${TODO}, ${HOME}`, means: 'A class hasn’t reached the fewest people it needs by its decide-by day.', tap: '**Keep it running**, or **Text the people booked** (opens Messages with their numbers). To cancel, **Open the class** › **Cancel class**. Nothing cancels on its own.', buttons: ['Keep it running', 'Open the class'] },
  { id: 'pos-unmatched', see: 'Counter sale to match', where: `${TODO}, ${HOME}`, means: 'A class seat was rung up on the register and the site couldn’t tell which class.', tap: 'Pick the class (and the seat) › **Match to a class**, or **Not for a class**.', buttons: ['Match to a class', 'Not for a class'] },
  { id: 'pos-needs-days', see: 'Counter seat needs its day', where: `${TODO}, ${HOME}`, means: 'A seat rung up on the register for a class with several dates needs its day.', tap: 'Pick the day › **Save the day**.', buttons: ['Save the day'] },
  { id: 'door-unpaid', see: 'Not paid at the counter', where: `${TODO}, ${HOME}`, means: 'Someone added at the door to pay at the counter has no matching sale.', tap: '**Mark paid at the counter** if they paid another way, or **Free the seat** to take them off the list.', buttons: ['Mark paid at the counter'] },
  { id: 'counter-match-check', see: 'Check a counter sale', where: `${TODO}, ${HOME}`, means: 'A register sale was matched to someone; make sure it was them.', tap: '**Yes, it was <name>**, or pick who it was › **It was <name>**.', buttons: ['Pick who it was'] },
  { id: 'paid-not-seated', see: 'Paid, no seat', where: `${TODO}, ${HOME}`, means: 'Square shows someone paid online, but their seat was let go (usually a slow payment).', tap: '**Give them their seat** (even if the date is full), or **Refund it** (the site asks Square first; the payment goes back to their card and they get a refund email; tapping twice never refunds twice). Settled another way: **It’s already sorted**.', buttons: ['Give them their seat', 'Refund it', 'It’s already sorted'] },
  { id: 'classes-unreadable', see: 'Classes / Classes in Square couldn’t be checked', where: HOME, means: 'The check couldn’t read the classes just now.', tap: 'Refresh the page to try again. If it’s still there after an hour, look over the day on the Calendar yourself.', buttons: [] },

  // Refunds (classes and parties)
  { id: 'refund-plain', see: 'Refund done in Square', where: `${TODO}, ${HOME}`, means: 'Someone refunded a class booking in Square; the seat is still taken here.', tap: '**Free a seat** (puts it back on sale, no money moves) or **Keep their seat**.', buttons: ['Keep their seat'] },
  { id: 'refund-failed', see: 'Refund didn’t go through', where: `${TODO}, ${HOME}`, means: 'Square couldn’t finish a refund.', tap: '**Ask Square** to see what it shows now. If it failed, **Try the refund again** (a new refund of the same amount; tapping twice never refunds twice; if Square failed it before it was saved here, the site says so and you refund it from the booking itself). Settled another way: **Mark as handled** and say how.', buttons: ['Ask Square', 'Try the refund again', 'Mark as handled'] },
  { id: 'refund-unfinished', see: 'Refund half finished', where: `${TODO}, ${HOME}`, means: 'A refund went through in Square but wasn’t finished here.', tap: '**Finish it**. It marks it done and emails the customer once.', buttons: ['Finish it'] },
  { id: 'refund-unconfirmed', see: 'Refund with no answer', where: `${TODO}, ${HOME}`, means: 'Square never answered about a refund for a day.', tap: '**Ask Square**. It shows what Square did with the refund, then only the buttons that fit: **It went through** (records it with Square’s refund, the customer emailed once), **Try the refund again** (the same request, so never twice) or **It didn’t go through**.', buttons: ['Ask Square', 'It went through', 'Try the refund again', 'It didn’t go through'] },

  // Arrive with stage 3 (staffing)
  { id: 'unstaffed', see: '<event> has no one on yet / has N of M on', where: HOME_STAFF, means: 'A class or party needs people and doesn’t have them.', tap: '**Put someone on** (opens its **Staff** tab) › **Put on**. Or More › Staff › **Needs someone**.', buttons: ['Put someone on', 'Put on'], comingWith: 'staffing' },
  { id: 'assigned-cant', see: '<name> is on <event> but marked that time as Can’t', where: HOME_STAFF, means: 'Someone is on a shift they said they can’t do.', tap: 'Call or text them from the line. If they can’t, **Open** › **Take off**, and put someone else on.', buttons: ['Open', 'Take off'], comingWith: 'staffing' },
  { id: 'assigned-cancelled', see: '<name> is still on <event>, which was cancelled', where: HOME_STAFF, means: 'Someone is on something that isn’t happening. Nobody is told for you.', tap: 'Call or text them from the line, then **Take <name> off**.', buttons: [], comingWith: 'staffing' },
  { id: 'staffing-unreadable', see: 'Couldn’t check staffing', where: HOME_STAFF, means: 'The staffing check couldn’t run just now.', tap: '**Try again**, or **Open Staff** to look yourself.', buttons: ['Try again', 'Open Staff'], comingWith: 'staffing' },
  { id: 'staff-passcode-guesses', see: 'Lots of wrong staff passcodes today', where: 'Home “Needs you”', means: 'Someone typed the wrong /staff passcode many times today. It may be someone guessing.', tap: '**Change the staff passcode**, then tell the crew the new one.', buttons: ['Change the staff passcode'], comingWith: 'staffing' },
  { id: 'staff-passcode-damaged', see: 'The staff passcode can’t be read', where: 'Home “Needs you”', means: 'Nobody can sign in to /staff until a new passcode is set.', tap: '**Set a new staff passcode**, type it twice, **Save new passcode**.', buttons: ['Set a new staff passcode', 'Save new passcode'], comingWith: 'staffing' },

  // Arrive with stage 4 (extras)
  { id: 'not-on-register', see: '<class> isn’t on the register yet', where: HOME, means: 'It can’t be booked online until it is.', tap: 'Open the class › **Put it on the register**.', buttons: [], comingWith: 'extras' },
  { id: 'pos-price-stale', see: 'The register doesn’t have the early-bird price / still rings the early-bird price', where: HOME, means: 'The register’s price is out of date.', tap: 'Open the class › **Fix the register price now**.', buttons: [], comingWith: 'extras' },
  { id: 'waitlist-unknown', see: 'Waitlist charge unclear', where: TODO, means: 'The waitlist charged someone’s saved card and Square didn’t answer. Their seat is held.', tap: '**Check Square again**. If it still can’t tell, look in Square, then **I sorted it out in Square**.', buttons: [], square: SQ_PAYMENT, comingWith: 'extras' },
  { id: 'waitlist-declined', see: 'Waitlist card didn’t go through / Waitlist price went up', where: TODO, means: 'The seat went to the next person; they weren’t charged.', tap: 'Call them if you like, then **Got it**.', buttons: [], comingWith: 'extras' },
]

/** Every warning code → its rows above (a missing code doesn't compile). */
export const WARNING_HELP: Record<WarningCode, string[]> = {
  'class-over-party': ['class-over-party'],
  'class-over-class': ['class-over-class'],
  oversold: ['oversold'],
  'party-on-closed-day': ['party-on-closed-day'],
  'picks-missing': ['picks-missing'],
  'capacity-unknown': ['capacity-unknown'],
  'recorded-over-sold': ['recorded-over-sold'],
  'below-minimum': ['below-minimum'],
  'pos-unmatched': ['pos-unmatched'],
  'pos-needs-days': ['pos-needs-days'],
  'refund-flag': ['refund-plain', 'refund-failed', 'refund-unfinished', 'refund-unconfirmed'],
  'door-unpaid': ['door-unpaid'],
  'counter-match-check': ['counter-match-check'],
  'classes-unreadable': ['classes-unreadable'],
  'paid-not-seated': ['paid-not-seated'],
  'party-waiting-payment': ['party-waiting-payment'],
  'party-hold-no-party': ['party-cancelled-held', 'party-old-time-held', 'party-hold-orphan'],
  'party-no-hold': ['party-no-hold', 'party-held-longer'],
  'two-parties': ['two-parties'],
  'party-paid-after-cancel': ['party-paid-after-cancel'],
  'parties-unreadable': ['parties-unreadable'],
  unstaffed: ['unstaffed'],
  'assigned-cant': ['assigned-cant'],
  'assigned-cancelled': ['assigned-cancelled'],
  'staffing-unreadable': ['staffing-unreadable'],
}

/** Every To decide kind → its rows above (a missing kind doesn't compile). */
export const TO_DECIDE_HELP: Record<ToDecideKind, string[]> = {
  'pos-unmatched': ['pos-unmatched'],
  'refund-plain': ['refund-plain'],
  'refund-failed': ['refund-failed'],
  'refund-unfinished': ['refund-unfinished'],
  'refund-unconfirmed': ['refund-unconfirmed'],
  'pos-needs-days': ['pos-needs-days'],
  'below-minimum': ['below-minimum'],
  'door-unpaid': ['door-unpaid'],
  'counter-match-check': ['counter-match-check'],
  'party-paid-unclear': ['party-paid-elsewhere', 'party-booking-unclear'],
  'paid-not-seated': ['paid-not-seated'],
  'party-not-told': ['party-not-told'],
  'party-payment-unclear': ['party-payment-unclear'],
  'party-no-confirmation': ['party-no-confirmation'],
  'party-hold-orphan': ['party-hold-orphan'],
}

const shown = <T extends { comingWith?: ComingWith }>(x: T) => !x.comingWith || HELP_AVAILABLE.has(x.comingWith)

/** What the Help sheet shows in this build. */
export function visibleHelp(): { sections: HelpSection[]; rows: HelpRow[] } {
  return { sections: HELP_SECTIONS.filter(shown), rows: HELP_ROWS.filter(shown) }
}

/** **bold** → parts for rendering: odd indexes are bold. */
export function boldParts(text: string): string[] {
  return text.split('**')
}
