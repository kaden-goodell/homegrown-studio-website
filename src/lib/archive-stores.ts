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
 * closed days) with their change history. tests/lib/archive-stores.test.ts fails when a store under
 * src/lib/classes is missing here.
 *
 * Deliberately left out: `otps` (one-time SMS codes, 10-minute life) and
 * `warnings-seen` (which daily-email lines were already shown), throwaway
 * data with no record value.
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
  // our own classes
  { name: 'classes' },
  { name: 'class-library' },
  { name: 'seat-ledger' },
  { name: 'blocked-time' },
  { name: 'seat-choices' },
  { name: 'refund-flags' },
  { name: 'refund-requests' },
  { name: 'unmatched-pos' },
  { name: 'pos-needs-days' },
  { name: 'class-alerts' },
  { name: 'class-create-keys' },
  // who decided what in /admin › To decide
  { name: 'to-decide' },
  // A small photo comes along; a large one is listed by key (the live store keeps it).
  { name: 'class-photos', maxValueBytes: 300 * 1024 },
]

export const ARCHIVE_STORE_NAMES: string[] = ARCHIVE_STORES.map((s) => s.name)
