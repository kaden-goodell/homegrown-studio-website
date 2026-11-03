/**
 * The stores the weekly self-archive exports (HOM-217), one list shared by
 * netlify/functions/archive-records.ts and scripts/archive-records.ts.
 *
 * Alias-free on purpose: the Netlify function imports it by a relative path.
 *
 * Legal records first (waivers, RSVPs, custody logs, incidents, event and
 * Craft Café settings), then the records of our own classes (stage 1): the
 * classes and their library, every seat sold (seat ledger), blocked time,
 * counter sales still to sort out, refund flags and saved refund requests,
 * the legacy seat picks, the minimum-to-run alert markers, the New class
 * create keys (which Add made which class), the To decide decisions, and
 * the class photos. Also the studio settings (Craft Café hours, special days,
 * closed days) and the party settings (party times, packages, extras), each
 * with their change history, the party records (Square-booked and our own,
 * with what was bought, every payment and refund) and the index of which party
 * each Square payment is for, the party book (which party holds which time) and the party checkouts still in flight or unclear.
 * Stage 4 adds the waitlists, reader sales, promo codes and their uses, the
 * saved-card setup alert markers and the customers' own cancels (D2).
 * tests/lib/archive-stores.test.ts fails when a store under src/lib/classes,
 * src/lib/parties or src/lib/promos (or the saved-card alerts) is missing here.
 *
 * Staffing (stage 3): when each person said they can and can't work, who
 * is on each class and party (with who asked, the history, and the party
 * index kept in the same store), and the last-known team list.
 *
 * Deliberately left out: `otps` (one-time SMS codes, 10-minute life),
 * `warnings-seen` (which daily-email lines were already shown), throwaway
 * data with no record value, `calendar-feeds` (scrambled calendar-link
 * keys only; a lost one is replaced with "Make a new link"), and
 * `staff-access` (the staff passcode's salted hash; an owner sets a new one
 * in /admin), `site-switches` (the online booking switch, which holds
 * the test link's secret; who changed it is in the audit log; the in-app
 * Records download reads ARCHIVE_STORES, so it skips it too), `tax-reports`
 * (Square's tax numbers for ended months, kept so /admin › Reports needn't
 * ask again; "Ask Square again" rebuilds them), and `craft-save-keys`
 * (which craft save already landed, so a retry says Saved; a day's worth
 * of no record value), `admin-access` (the /admin passcode's salted hash, its marker,
 * recovery-link tokens and the wrong-passcode count), `outbound-keys` (the
 * Gmail app password and Quo key pasted in /admin, encrypted) and
 * `outbound-health` (whether emails, texts and Square are working).
 * `staff-people` keeps its `import-failures` counter next to the
 * list; it is harmless in an export.
 */
export interface ArchiveStoreEntry {
  name: string
  /** Values larger than this are listed by key and size, not copied (photos can be 4 MB each). */
  maxValueBytes?: number
}

export const ARCHIVE_STORES: ArchiveStoreEntry[] = [
  { name: 'waivers' },
  { name: 'rsvps' },
  { name: 'checkins' },
  { name: 'incidents' },
  { name: 'event-meta' },
  { name: 'open-studio' },
  // Craft Café hours, special days and closed days set on /admin, with who changed them
  { name: 'studio-settings' },
  // Party times, packages and extras set in /admin › Parties setup, with who changed them
  { name: 'party-settings' },
  // Party records (host, guests, what was bought, payments and refunds) and which party each Square payment is for
  { name: 'parties' },
  { name: 'party-payments' },
  // The party book: which party holds or has booked which time (one document per month)
  { name: 'party-book' },
  // One short lease per party while a move, cancel or extra-time change runs (kept for completeness; tiny)
  { name: 'party-locks' },
  // Party charges in flight or unclear (what's needed to record a party Square says is paid)
  { name: 'party-checkouts' },
  // Which parties each host email has (a hash of the email, the party ids), for the booking's same-person check
  { name: 'party-by-host' },
  // Where the 10-minute sweep of stuck party checkouts carries on from (one party id)
  { name: 'party-sweep' },
  // Where an unfinished nightly classes reconcile carries on from, and where the last one ended (one document)
  { name: 'reconcile-classes' },
  // our own classes
  { name: 'classes' },
  { name: 'class-library' },
  { name: 'seat-ledger' },
  { name: 'blocked-time' },
  { name: 'seat-choices' },
  { name: 'refund-flags' },
  { name: 'refund-requests' },
  // a refund To decide sent again in place of one Square failed (so Square's events on it are never recorded twice)
  { name: 'refund-replacements' },
  { name: 'unmatched-pos' },
  { name: 'pos-needs-days' },
  { name: 'class-alerts' },
  { name: 'class-create-keys' },
  // our online bookings Square showed paid with no seat left (R42), and which confirmations went out
  { name: 'paid-not-seated' },
  // I-5: bookings paid just as their class was cancelled (To decide: refund them)
  { name: 'paid-on-cancelled' },
  // background-job checks: Square notices arriving at another address (owner Home line)
  { name: 'system-checks' },
  // Stage 4 (I2): one marker per class per day so the stale-register text goes out once.
  { name: 'pos-price-alerts' },
  { name: 'class-confirmations' },
  // who decided what in /admin › To decide
  { name: 'to-decide' },
  // Stage 4: each class's waitlist (who joined, consent, card brand and last 4, every try; never card numbers; the saved-card id and leave-link hash are left out of every file)
  { name: 'waitlists' },
  // Stage 4: "Charge on the reader" sales (who, what, how much, how each ended) and which Square order paid which
  { name: 'reader-sales' },
  { name: 'reader-orders' },
  // Stage 4: promo codes (with their change history) and who used each one (bookings, holds, uses given back)
  { name: 'promo-codes' },
  { name: 'promo-uses' },
  // Stage 4: one marker per Chicago day when Square refused a saved-card request (the owners' text went out once)
  { name: 'card-setup-alerts' },
  // D2: customers' own online cancels and their "Send us a note" requests (what they asked, what happened)
  { name: 'class-cancels' },
  // A small photo comes along; a large one is listed by key (the live store keeps it).
  { name: 'class-photos', maxValueBytes: 300 * 1024 },
  // staffing: who can work when, who is on what (and the party index), our own staff list (D5),
  // and the old last-known copy of the Square team (no longer written; kept while it exists)
  { name: 'staff-availability' },
  { name: 'staffing' },
  { name: 'staff-people' },
  { name: 'staff-team' },
  // crafts (/admin › More › Crafts): which are hidden on the website (with who and when), and which Add made which craft
  { name: 'craft-settings' },
  { name: 'craft-create-keys' },
]

export const ARCHIVE_STORE_NAMES: string[] = ARCHIVE_STORES.map((s) => s.name)
