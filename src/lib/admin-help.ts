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
 * Sections marked `comingWith` describe screens from the staffing (stage 3)
 * and extras (stage 4) work; both are merged, so both are in HELP_AVAILABLE.
 * The stage 4 sections, rows and lookups live in admin-help-stage4.ts.
 */
import type { WarningCode } from '@lib/warnings'
import type { ToDecideKind } from '@lib/classes/to-decide'
import { STAGE4_HELP_ROWS, STAGE4_HELP_SECTIONS, STAGE4_TO_DECIDE_HELP, STAGE4_WARNING_HELP } from './admin-help-stage4'

export type ComingWith = 'staffing' | 'extras'

/** The later stages merged into this build. */
export const HELP_AVAILABLE: ReadonlySet<ComingWith> = new Set<ComingWith>(['staffing', 'extras'])

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
      'The crew use /staff on the iPad: who’s coming, check-in, waivers, door seats. Anything only an owner should do is here, except three jobs done on /staff: gift cards, **Comp a seat** and **Sell a seat** (see “Things you do on /staff” below).',
    ],
  },
  {
    id: 'classes-new',
    title: 'Add a class',
    points: [
      'Home › **+ New class**, or Classes › **+ New class**, or tap a day on the Calendar › **+ New class on this day**.',
      'Pick **Start fresh** or **From a past class** (copies its details; you pick new dates).',
      'Fill in the name, the description, the photo, the dates and times, then under **More options** the parts that matter for this class: **Kinds of seat (like Adult and Kid)**, **Ways to book**, **Extras**, **Questions** and **Ages and booking rules**.',
      'Adult and Kid prices: **More options** › Kinds of seat › rename Person to Adult › **+ Add a kind of seat** › type Kid › type each price in the box next to it. (With more than one way to book, like a drop-in as well as the full class, the prices go under Ways to book instead, one box per kind of seat.)',
      '**Add class** puts it on the website for people to book, and in your library. **Save as draft** keeps it just for you until you open it.',
      'If the time clashes with a party, a class or a closed day, it says what with. Pick another time.',
    ],
  },
  {
    id: 'classes-change',
    title: 'Change, move or reopen a class',
    points: [
      'Open the class (Calendar or Classes). The tabs: **Bookings**, **Details**, **Dates**.',
      '**Details**: change anything, then **Save**. It asks **Only this class** or **This class and the library** (so next time starts from the new version too). A class you repeated asks **Just this date** or **All dates in this series** instead.',
      '**Dates**: change a date or time, then **Save dates**. If people are booked it asks first: **Move and I’ll tell them**. Then it lists who to tell, with their numbers to tap, **Text everyone**, **Copy the numbers** and **Email everyone the new details** (each gets their confirmation again with the new time and a new calendar file that replaces the old one). Nothing is sent until you tap it.',
      '**Dates** tab › Status (under the dates): **Open** (people can book), **Closed** (on the website, sign-ups closed) or **Draft** (only you see it). Then **Save dates**.',
      '**Run it again on new dates** makes a new class from this one, a week on, for you to adjust.',
    ],
  },
  {
    id: 'classes-bookings',
    title: 'Who’s coming',
    points: [
      'Class › **Bookings**: everyone booked, their seats, how they paid and anything refunded.',
      '“I never got my email”: under their name tap **Email them their booking again** › **Send it**. It sends their confirmation again (the class, the time, the calendar file and their “Can’t make it?” link). If the email was mistyped, type the right one in the box first: it’s saved on their booking, so later emails go there too.',
      'Home › **Print today**, or a day on the Calendar › **Print this day**, prints the day’s lists for the table.',
      'At the door the crew check people in on /staff, add walk-ins and take payment.',
    ],
  },
  {
    id: 'classes-cancel',
    title: 'Cancel a class',
    points: [
      'Open the class › **Cancel this class** (the red button at the bottom of the **Bookings** tab, or of **Details**) › it lists who’s booked › **Cancel class**. Sign-ups stop and the class comes off the website. It never refunds anyone on its own.',
      'For a class you repeated every week, it also lists who’s booked on the other dates still to come, and asks **Just this date** or **All dates in this series**. Neither refunds anyone.',
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
      'Someone calls and you don’t know which class: Home › **Find a booking** › type their name, email or part of their phone › **Search**. Their class bookings show with **Refund** right under each one (and **Open the class**); their parties show with **Open the party** (refund on its Payments tab), and any waitlist place with **Open the class**. Bookings made in Square before the switch aren’t in it.',
      'A class seat: class › Bookings › under the person’s name, tap **Refund**. Pick **One person** or the whole booking, or **Another amount**, add a reason if you like, then **Confirm refund**. They get one refund email. Freeing a seat with no money back is **Free their seat**.',
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
      'A package for **Only with the link** isn’t on the party booking page; send its link to the people it’s for.',
      '**Save** says “Saved. New bookings use these.” Parties already booked keep their time and price and are listed so you can see them.',
      'Leave **Keep their times blocked on the calendar** ticked. It keeps parties booked in Square before the switch from being double-booked. It can only be unticked once none are left to come.',
    ],
  },
  {
    id: 'crafts',
    title: 'Crafts (party and Craft Café)',
    points: [
      'More › **Crafts**: every party and Craft Café craft, with its photo, price per guest and words. Tap a craft to change it, then **Save craft**. **+ Add a craft** adds a new one (then **Add craft**). Parties setup links here with **Change the crafts**.',
      'Photos are cropped to the card’s shape. A craft with no photo still shows on the website, just without a picture. If it says the photo didn’t go up, choose it again and **Save craft**.',
      'The words box shows how craft descriptions are written (three short paragraphs, about 350 characters, ending with the ages) and suggests fixes as you type, for the name too (no “party”, “birthday” or “kids”). They’re only suggestions; it saves either way.',
      'A new craft gets the same tax as the other crafts, so the register adds it. A craft tagged **No tax on the register** rings up with no tax: tap **Add the tax** next to it.',
      '**Where it’s offered** (Both, Parties only, Craft Café only), **Made to order** and **Most popular** (one craft at a time) are set on each craft.',
      'A new price is used for new bookings and on the register. Crafts are always paid at the studio, so nothing already booked changes.',
      '**Hide on website** takes a craft off the party booking page and the Craft Café menu. It stays on the register, and parties that picked it keep it (their emails still show its words, photo and price). **Show on website** puts it back.',
      'Changes show on the website within a minute. If it says someone changed the craft since you opened it, tap **See the latest**: the form shows the latest, and what you typed is kept beside it. Tap **Use what I typed** to put your words back, then **Save craft**.',
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
      'Pausing asks first (**Pause parties**). People already booked keep their booking, and payment links already sent still work. The website shows your note instead of the booking buttons. The usual note gives the studio phone number; if you write your own, put the number in it.',
      'If the website ever can’t read this setting, it treats everything as paused and says “Online booking is having a hiccup” with the studio phone number, until it can read it again. Nothing booked changes.',
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
      'After **Save studio hours** the website shows the new hours within a minute or two.',
      'If a party time wouldn’t fit the new hours, it says which one. Move it in **Parties setup** first. Parties and classes already booked stay booked.',
      'Google Maps keeps its own copy of your hours: after a change, tap **Open Google Business Profile** › Edit profile › Hours. You need to be an owner or manager of the studio’s Business Profile to change it; if it won’t let you edit, ask whoever is listed as owner there to add you (keep that login on your accounts sheet).',
      'To put a special day on the website, tick **Announce it on the website** when you add it (or tap **Announce it on the website** under a day already there): a headline (up to 60 letters) and how many days before to start showing it. The website shows a bar on every page and a big card on the home and Craft Café pages until the café closes that day. If two announced days overlap, only the sooner one shows; the next takes over once it’s past. **Change the announcement** to edit or stop it.',
      '**Print a flyer** under any special day opens a letter-size flyer with the same words and a QR code to the Craft Café page. Load letter paper and tap **Print** (on an iPad: tap Share, then Print).',
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
      'Warnings show on Home under **Warnings** (in “Needs you”), each with the button that fixes it, or **Open the class** / **Open the party** to sort it there. They also show on the class or party itself, on /staff for the crew, and in the morning warnings email, so you see them even when emails aren’t going out.',
      'To decide items are in Inbox › **To decide**; Home shows how many are waiting. Staffing lines (nobody on, someone on who can’t) are under Home › Staffing.',
      'Each one says what happened and what to tap. The table below has every one of them.',
      'Nothing on either list cancels, refunds or texts anyone by itself.',
    ],
  },
  {
    id: 'reports',
    title: 'Reports',
    points: [
      'More › **Reports**: pick a month, or a whole year, under Show. It shows class seats sold, class sales, class refunds, parties booked and party fees taken.',
      'Under it is the **Tax split** from Square for that month: use tax (classes, Craft Café and party crafts) and sales tax (take-home kits), refunds taken off. Party studio fees carry no tax and show as untaxed. **Download** saves it as a spreadsheet. **Send it now** (it says **Send it again** once it has gone) emails it to the owners picked for it in Notifications, and to the accountant if you added one there. **Send to…** emails that month to any one address you type, like the accountant’s (only the month’s totals go, no customer names).',
      'To send the spreadsheet yourself: **Download** › on the iPad open Files › Downloads › press and hold the file › Share › Mail.',
      'The tax split is also emailed by itself on the 1st of each month. If that email says it couldn’t be made, open Reports, pick that month, and tap **Send it now** once it shows. A month is remembered a week after it ends (late register payments come in by then); **Ask Square again** reads it fresh.',
      'A refund shows in the month it was made, not the month of the sale.',
      'Each sale rung up on the register is in the tax split. For the sale-by-sale detail, Square has its own reports (Square Dashboard › Reports).',
    ],
  },
  {
    id: 'records',
    title: 'Records (waivers, check-ins, who did what)',
    points: [
      'More › **Records**: pick the days (**This year**, **Last year**, **Pick the days** or **Everything**), type your admin passcode, then **Download records**. One .zip file is saved to this device (on an iPad, in Files › Downloads).',
      'Inside: every signed waiver, who said they were coming, check-ins and who picked each child up (custody.csv, the file to hand a lawyer), incident reports, and who did what on /admin and /staff. The waivers and RSVPs behind the events in your days come along too, however long ago they were signed. README.txt in the file says what each part is.',
      'Links and codes that open things (host pages, payment links, pickup codes) are left out on purpose, here and in the weekly email copy.',
      'Nothing on the site is changed or deleted. Keep the file somewhere safe and private: it has children’s details and signatures. Each download is recorded with your name.',
      'If it says it’s too much for one download, pick fewer days and download it in parts. For **Everything**, download a year at a time: **This year**, **Last year**, then **Pick the days** for each year before that.',
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
  {
    id: 'on-staff',
    title: 'Things you do on /staff',
    intro: 'A few owner jobs live on /staff, the crew’s screen: open the studio website with /staff at the end, on the iPad or your phone, and sign in with the staff passcode.',
    points: [
      'Make a gift card: /staff › **Gift cards** › pick an amount (or type one under Other amount), who it’s for and a note › **Make card**. The card number shows: tap **Copy** and paste it into a text or email to them. The list below shows every card made here with what’s left on it; **Number** shows a card’s number again. A gift card pays for a party online or at the register; class seats online can’t be paid with one.',
      'Give someone a free seat (a giveaway, a make-good, or a booking the site couldn’t finish): /staff › open the class (This week, Today or Upcoming) › **Comp a seat** › **Find a customer**, or type their first name, last name and email › the day and how many seats › tick **Email them a confirmation** if they should get one › **Add comped seat**.',
      'Book a class seat for someone on the phone or at the door: /staff › open the class › **Sell a seat** › who’s coming and how many › how they pay: **Pay on the iPad** (their card or Apple Pay, right there; they get the usual confirmation), **Pay at the counter** (**Add seat, pay at the counter**, then ring it up on the register) or **Charge on the reader** (when it’s turned on in More › Register setup).',
      'Check-in, waivers and pickup at the door are the crew’s screens too; everything there is the same for you.',
    ],
    square: [{ why: 'Taking money back off a gift card, or clearing one, is only in Square.', steps: 'Square Dashboard (squareup.com, signed in) › Gift cards › find the card by its number › Refund or Clear balance.' }],
  },
  {
    id: 'connections',
    title: 'Emails, texts and Square',
    intro: 'The website sends emails through the studio’s Google account, texts through Quo, and takes payments through Square. If one stops, Home says so.',
    points: [
      'More › **Email, texts and Square** shows whether each one is working, with **Send me a test email**, **Send me a test text** and **Check Square**. The test email and text go to your own email and mobile in More › Staff › People.',
      'When one stops, Home shows a warning with the same buttons and **What to do**. The owners also hear the other way: a text when emails stop, an email when texts stop. That alert comes at most once every 12 hours for each one, so a service that keeps stopping and starting doesn’t fill your phone. The warning clears by itself as soon as one goes through.',
      'Nothing booked is lost while one is down. Call or text anyone waiting on an email, and take payments on the Square app on the iPad if the website can’t.',
    ],
  },
  {
    id: 'email-broken',
    title: 'If emails stop going out',
    intro: 'Usually because the password of the Google account that sends them changed, or its 2-Step Verification was turned off. Then no confirmations, payment links, refund emails or morning emails go out.',
    points: [
      'First tap **Send me a test email**. If it arrives, it’s working again.',
      'If not, make a new app password: sign in to the sending Google account on a computer › myaccount.google.com › Security › check 2-Step Verification is on › App passwords › create one called Website › copy the 16 letters.',
      'Then put it in the website: More › **Email, texts and Square** › **Paste a new Gmail app password** › paste the 16 letters › **Test it** (it signs in to Google and sends a test email to your own email) › type the admin passcode you use now › **Save it**. It works at once, it’s never shown again, and every owner gets an email and a text saying it was changed.',
      'A password pasted here wins over the one in the hosting settings. So if someone changes GMAIL_APP_PASSWORD in the hosting settings later, first tap **Use the hosting setting instead** under the pasted one, or the pasted one keeps being used.',
      'Only if that screen says it can’t keep a password safely: sign in to the website’s hosting account on a computer (the login is on the studio’s accounts sheet) › Site configuration › Environment variables › GMAIL_APP_PASSWORD › Edit › paste it as the Production value › Save, then Deploys › Trigger deploy › Deploy site. Settings only count after that, and it takes about 3 minutes.',
      'Tap **Send me a test email** again. Until it works, call or text customers who are waiting on an email.',
      'Once it works, send the emails people missed: for a class, open it › Bookings › **Email them their booking again** under each person who booked while emails were down; for a party, open it › **Email <name> the details**.',
    ],
  },
  {
    id: 'texts-broken',
    title: 'If texts stop going out',
    intro: 'Texts go out from the studio number through Quo. They stop when the Quo key stops working or the Quo plan runs out.',
    points: [
      'First tap **Send me a test text**.',
      'If not: open Quo on a computer (quo.com, signed in as the account owner) › check the plan and credits are paid › Settings › API › create a new key › copy it.',
      'Then put it in the website: More › **Email, texts and Square** › **Paste a new Quo key** › paste it › **Test it** (it checks the key belongs to the studio’s number and sends a test text to your own mobile) › type the admin passcode you use now › **Save it**. It works at once, it’s never shown again, and every owner gets an email and a text saying it was changed.',
      'A key pasted here wins over the one in the hosting settings. So if someone changes QUO_API_KEY in the hosting settings later, first tap **Use the hosting setting instead** under the pasted one, or the pasted one keeps being used.',
      'Only if that screen says it can’t keep a key safely: sign in to the website’s hosting account on a computer (the login is on the studio’s accounts sheet) › Site configuration › Environment variables › QUO_API_KEY › Edit › paste it as the Production value › Save, then Deploys › Trigger deploy › Deploy site. Settings only count after that, and it takes about 3 minutes.',
      'Tap **Send me a test text** again. Until it works, text customers from the studio phone yourself.',
    ],
  },
  {
    id: 'square-broken',
    title: 'If Square refuses the website',
    intro: 'The website uses one Square key to take payments, refund and read bookings. It doesn’t run out by itself. It stops only if someone replaced it, removed the studio’s app in Square, or the Square account owner changed.',
    points: [
      'First tap **Check Square**. Square sometimes has a bad few minutes; if it answers, all is well.',
      'The Square key can’t be pasted in /admin, on purpose: whoever has it could send the studio’s payments somewhere else. It stays in the hosting settings.',
      'If Square keeps refusing: sign in at developer.squareup.com on a computer as the Square account owner › Applications › the studio’s app › Credentials › Production › copy the access token. Only tap Replace if there’s no token to copy: it stops the old one at once.',
      'Then put it in the website: sign in to the website’s hosting account on a computer (the login is on the studio’s accounts sheet) › Site configuration › Environment variables › SQUARE_ACCESS_TOKEN › Edit › paste it as the Production value › Save, then Deploys › Trigger deploy › Deploy site. Settings only count after that, and it takes about 3 minutes.',
      'Tap **Check Square** again. Until it works, take payments on the Square app on the iPad and write bookings down.',
    ],
  },
  {
    id: 'admin-access',
    title: 'Owners and the admin passcode',
    points: [
      'More › **Admin access** shows who the owners are and when the /admin passcode was last changed.',
      'The owners are the people marked **Owner** in More › Staff › People. To add an owner, add them (or edit them) as Owner. To take someone off, edit them to **Crew** or tap **No longer working here**. **Change who’s an owner** opens that list. There’s always at least one owner. Each owner picks their name under “Who’s using this?”, and gets the alerts picked for them in More › **Notifications**.',
      '**Change the admin passcode**: type the one you use now, then the new one twice (at least 8 letters or numbers, no space at the start or end, and not the staff passcode), then **Save new admin passcode**. Every other phone or iPad signed in to /admin is signed out. The one you’re on stays signed in. Change it when an owner leaves, a phone is lost, or someone else saw it, and write it somewhere safe. Every owner (you too) gets an email and a text saying it was changed.',
      'Taking an owner off in Staff › People (made **Crew**, or **No longer working here**) asks **Change the admin passcode now?** right there, because their phone may still be signed in to /admin. **Change it now** shows the form; **Not now** leaves it.',
      'When someone is made an owner, an owner is taken off, or an owner’s email or mobile changes, every owner gets an email and a text at the email and mobile they had before (the one taken off or changed too, and you, even if you made the change). It says it came from a signed-in /admin device and which name that device picked, since anyone holding a signed-in phone can pick any name. If you get one you didn’t expect, check Staff › People and **Notifications**, and change the admin passcode.',
      'After 8 wrong passcodes from one place, /admin makes that place wait 15 minutes before trying again. After 20 wrong ones in a day from anywhere, the owners get a text and an email, and **Admin access** says so. After 50 in a day, every try has to wait a few seconds after the last wrong one (never more than 30 seconds), so sign-in slows down but never closes. The email link under **Forgot the passcode?** works too.',
      'Forgot the passcode? On the /admin sign-in page tap **Forgot the passcode?** › **Email the owners a link**. A link goes to every owner’s email in Staff › People (an owner added, or whose email changed, in the last 3 days doesn’t get one). Asking again while that link still works sends nothing new: use the email that came. Open it on the phone or iPad you want to use, type a new passcode twice, **Save new admin passcode**. The link works once, for 15 minutes; every other phone or iPad is signed out, and every owner gets an email and a text saying it was reset. A link that ran out or was used says so: ask for a new one.',
      'If nobody remembers the passcode and email isn’t working either (the last resort): whoever holds the website’s hosting login (it’s on the studio’s accounts sheet) sets the ADMIN_PASSCODE setting there to a new one of at least 8 letters or numbers and redeploys the site. Sign in with that one, then save a new one in **Admin access**. Every owner gets an email and a text when that happens. A setting that was in force at one of the last changes here never works again, even if it’s put back.',
    ],
  },
  {
    id: 'notifications',
    title: 'Who gets texts, emails and reports',
    points: [
      'More › **Notifications** decides who gets each of these: texts when something needs you, “someone just booked”, the morning warnings and heads-up emails, the monthly tax split, and the weekly records archive.',
      'Tick the owners for each one, then **Save notifications**. They go to each owner’s email and mobile in More › Staff › People (**Edit emails and mobiles** opens it).',
      'Until you save here, everything goes where the site was set up to send it, and the screen shows where. The tax split and the records archive go to both owners.',
      'Someone who stops being an owner stops getting them. If nobody picked for one is left, it goes to every owner. An owner with no mobile on file gets no texts; only when nobody picked has a mobile do the texts go to the phone numbers the site was set up with.',
      'The weekly records archive waits a day before it goes to a new owner, or to an owner’s new email. The screen shows when it starts. Saving this screen sends the other owners an email and a text saying what changed.',
      'Keep the weekly archive emails: they are the record of every waiver, check-in and incident.',
      '**Also send the monthly tax split to** (same screen): type one more email, like your accountant’s, then **Save address**. It starts getting the monthly tax split a day later, and every owner gets an email and a text saying so. **Stop sending it there** takes it off.',
    ],
  },
  // ── Stage 4 (extras): promotions, repeating dates, Register setup, waitlists, customers' own cancels, the reader ──
  ...STAGE4_HELP_SECTIONS,
]

// ── When you see this → tap this ──────────────────────────────────────────

const HOME = 'Home › Warnings, the morning email'
const TODO = 'Inbox › To decide'
/** To decide items: settled in Inbox › To decide; Home counts them under “Needs you”. */
const TODO_HOME = 'Inbox › To decide (counted on Home), the morning email'
const HOME_STAFF = 'Home › Staffing, the morning email'

export const HELP_ROWS: HelpRow[] = [
  // Parties
  { id: 'party-waiting-payment', see: 'Party waiting on payment', where: HOME, means: 'A party in the next 7 days still owes its studio fee or extras.', tap: 'Open the party › **Send it again**, or call them. Nothing is cancelled for being unpaid.', buttons: ['Send it again'] },
  { id: 'party-no-hold', see: 'Not held on the calendar / Extra time not held on the calendar', where: `${HOME}, the party`, means: 'The party’s time (or its extra time) isn’t blocked, so someone else could book it.', tap: 'Open the party › **Hold this time again**. If something else took the time, it says what: move one of them.', buttons: ['Hold this time again'] },
  { id: 'party-held-longer', see: 'Held longer than the party', where: 'The party', means: 'The calendar blocks more time than the party has.', tap: 'Open the party › **Put the end time back**.', buttons: ['Put the end time back'] },
  { id: 'party-cancelled-held', see: 'A cancelled party’s time still held', where: `${HOME}, the party`, means: 'Nobody can book that time.', tap: 'Open the party › **Free this time**. Nothing is sent and no money moves.', buttons: ['Free this time'] },
  { id: 'party-old-time-held', see: '<time> still held, after a move', where: `${HOME}, the party`, means: 'The party moved, but its old time is still blocked.', tap: 'Open the party › **Free the old time**. The party stays where it is.', buttons: ['Free the old time'] },
  { id: 'party-hold-orphan', see: 'Party time held, no party', where: TODO_HOME, means: 'A time is blocked with no party on it, usually a booking that stopped halfway.', tap: '**Free this time**. It waits by itself while a payment might still be going through.', buttons: ['Free this time'] },
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
  { id: 'below-minimum', see: 'Short of its minimum', where: TODO_HOME, means: 'A class hasn’t reached the fewest people it needs by its decide-by day.', tap: '**Keep it running**, or **Text the people booked** (opens Messages with their numbers). To cancel, **Open the class** › **Cancel this class** (at the bottom) › **Cancel class**. Nothing cancels on its own.', buttons: ['Keep it running', 'Open the class'] },
  { id: 'pos-unmatched', see: 'Counter sale to match', where: TODO_HOME, means: 'A class seat was rung up on the register and the site couldn’t tell which class.', tap: 'Pick the class (and the seat) › **Match to a class**, or **Not for a class**.', buttons: ['Match to a class', 'Not for a class'] },
  { id: 'pos-needs-days', see: 'Counter seat needs its day', where: TODO_HOME, means: 'A seat rung up on the register for a class with several dates needs its day.', tap: 'Pick the day › **Save the day**.', buttons: ['Save the day'] },
  { id: 'door-unpaid', see: 'Not paid at the counter', where: TODO_HOME, means: 'Someone added at the door to pay at the counter has no matching sale.', tap: '**Mark paid at the counter** if they paid another way, or **Free the seat** to take them off the list.', buttons: ['Mark paid at the counter'] },
  { id: 'counter-match-check', see: 'Check a counter sale', where: TODO_HOME, means: 'A register sale was matched to someone; make sure it was them.', tap: '**Yes, it was <name>**, or pick who it was › **It was <name>**.', buttons: ['Pick who it was'] },
  { id: 'paid-not-seated', see: 'Paid, no seat', where: TODO_HOME, means: 'Square shows someone paid online, but their seat was let go (usually a slow payment).', tap: '**Give them their seat** (even if the date is full), or **Refund it** (the site asks Square first; the payment goes back to their card and they get a refund email; tapping twice never refunds twice). Settled another way: **It’s already sorted**.', buttons: ['Give them their seat', 'Refund it', 'It’s already sorted'] },
  { id: 'classes-unreadable', see: 'Classes / Classes in Square couldn’t be checked', where: HOME, means: 'The check couldn’t read the classes just now.', tap: 'Refresh the page to try again. If it’s still there after an hour, look over the day on the Calendar yourself.', buttons: [] },

  // Refunds (classes and parties)
  { id: 'refund-plain', see: 'Refund done in Square', where: TODO_HOME, means: 'Someone refunded a class booking in Square; the seat is still taken here.', tap: '**Free a seat** (puts it back on sale, no money moves) or **Keep their seat**.', buttons: ['Keep their seat'] },
  { id: 'refund-failed', see: 'Refund didn’t go through', where: TODO_HOME, means: 'Square couldn’t finish a refund.', tap: '**Ask Square** to see what it shows now. If it failed, **Try the refund again** (a new refund of the same amount; tapping twice never refunds twice; if Square failed it before it was saved here, the site says so and you refund it from the booking itself). Settled another way: **Mark as handled** and say how.', buttons: ['Ask Square', 'Try the refund again', 'Mark as handled'] },
  { id: 'refund-unfinished', see: 'Refund half finished', where: TODO_HOME, means: 'A refund went through in Square but wasn’t finished here.', tap: '**Finish it**. It marks it done and emails the customer once.', buttons: ['Finish it'] },
  { id: 'refund-unconfirmed', see: 'Refund with no answer', where: TODO_HOME, means: 'Square never answered about a refund for a day.', tap: '**Ask Square**. It shows what Square did with the refund, then only the buttons that fit: **It went through** (records it with Square’s refund, the customer emailed once), **Try the refund again** (the same request, so never twice) or **It didn’t go through**.', buttons: ['Ask Square', 'It went through', 'Try the refund again', 'It didn’t go through'] },

  // Arrive with stage 3 (staffing)
  { id: 'unstaffed', see: '<event> has no one on yet / has N of M on', where: HOME_STAFF, means: 'A class or party needs people and doesn’t have them.', tap: '**Put someone on** (opens its **Staff** tab) › **Put on**. Or More › Staff › **Needs someone**.', buttons: ['Put someone on', 'Put on'], comingWith: 'staffing' },
  { id: 'assigned-cant', see: '<name> is on <event> but marked that time as Can’t', where: HOME_STAFF, means: 'Someone is on a shift they said they can’t do.', tap: 'Call or text them from the line. If they can’t, **Open** › **Take off**, and put someone else on.', buttons: ['Open', 'Take off'], comingWith: 'staffing' },
  { id: 'assigned-cancelled', see: '<name> is still on <event>, which was cancelled', where: HOME_STAFF, means: 'Someone is on something that isn’t happening. Nobody is told for you.', tap: 'Call or text them from the line, then **Take <name> off**.', buttons: [], comingWith: 'staffing' },
  { id: 'staffing-unreadable', see: 'Couldn’t check staffing', where: HOME_STAFF, means: 'The staffing check couldn’t run just now.', tap: '**Try again**, or **Open Staff** to look yourself.', buttons: ['Try again', 'Open Staff'], comingWith: 'staffing' },
  { id: 'staff-passcode-guesses', see: 'Lots of wrong staff passcodes today', where: 'Home “Needs you”', means: 'Someone typed the wrong /staff passcode many times today. It may be someone guessing.', tap: '**Change the staff passcode**, then tell the crew the new one.', buttons: ['Change the staff passcode'], comingWith: 'staffing' },
  { id: 'staff-passcode-damaged', see: 'The staff passcode can’t be read', where: 'Home “Needs you”', means: 'Nobody can sign in to /staff until a new passcode is set.', tap: '**Set a new staff passcode**, type it twice, **Save new passcode**.', buttons: ['Set a new staff passcode', 'Save new passcode'], comingWith: 'staffing' },

  // Emails, texts and Square (G2): shown on Home, not on the warnings list.
  { id: 'email-failing', see: 'Emails aren’t going out', where: 'Home “Needs you”, a text to the owners', means: 'The website can’t send emails: customers aren’t getting confirmations, payment links or refund emails.', tap: '**Send me a test email**. If it doesn’t arrive, **What to do** has the steps (a new app password for the studio’s Google account, pasted in with **Paste a new Gmail app password**).', buttons: ['Send me a test email', 'What to do'] },
  { id: 'texts-failing', see: 'Texts aren’t going out', where: 'Home “Needs you”, an email to the owners', means: 'The website can’t send texts (Quo).', tap: '**Send me a test text**. If it doesn’t arrive, **What to do** has the steps (a new Quo key pasted in with **Paste a new Quo key**, or pay the Quo plan).', buttons: ['Send me a test text', 'What to do'] },
  { id: 'square-failing', see: 'Square is refusing the website', where: 'Home “Needs you”, a text and an email to the owners', means: 'Online bookings, payments and refunds can’t go through.', tap: '**Check Square**. If it still refuses, **What to do** has the steps (copy the key from Square into the website).', buttons: ['Check Square', 'What to do'] },
  { id: 'admin-reset-notice', see: 'The /admin passcode was reset / changed, or The studio’s owners changed', where: 'An email and a text to the owners', means: 'Someone reset the admin passcode (with the emailed link, the hosting settings, or in Admin access), or changed who the owners are, their emails or mobiles, or who gets alerts.', tap: 'If it was one of you, nothing to do. If not: on the /admin sign-in page tap **Forgot the passcode?**, set a new one, then check More › Staff › People and **Notifications**.', buttons: ['Forgot the passcode?'] },
  { id: 'admin-many-wrong', see: 'Lots of wrong /admin passcodes today', where: 'An email and a text to the owners, More › Admin access', means: 'Someone typed a wrong /admin passcode 20 times today.', tap: 'If it wasn’t one of you, **Change the admin passcode** in More › Admin access.', buttons: ['Change the admin passcode'] },
  { id: 'service-not-set', see: 'Emails / Texts / Square aren’t set up on this site', where: 'Home “Needs you”', means: 'The website has no password or key for it, so nothing goes out that way.', tap: '**What to do** has the steps for each.', buttons: ['What to do'] },

  // Owner alerts that ask for a step (I9)
  { id: 'free-not-recorded', see: 'Class paid, seats not recorded yet … Nothing was charged (a free booking)', where: 'A text to the owners', means: 'Someone booked a free seat (a 100% code) and the site couldn’t write it down. Their seats are held for a day.', tap: 'On /staff, open the class › **Comp a seat** › their name, email and seats › **Add comped seat**, so the seats are theirs for good. The held seats let go by themselves after a day.', buttons: ['Comp a seat', 'Add comped seat'] },
  { id: 'signup-not-saved', see: 'Site sign-up: <email> wants to hear about … (not saved)', where: 'A text and an email to the owners', means: 'Someone asked to be told when booking opens. “Not saved” means that message is the only copy of their sign-up.', tap: 'Keep that email (or write the address down). When booking opens, email or text them.', buttons: [] },

  // Stage 4 (extras): admin-help-stage4.ts
  ...STAGE4_HELP_ROWS,
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
  ...STAGE4_WARNING_HELP,
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
  ...STAGE4_TO_DECIDE_HELP,
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
