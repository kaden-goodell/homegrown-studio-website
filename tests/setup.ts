import '@testing-library/jest-dom'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Module-level kv stores (waiver/checkin/party) fall back to the filesystem in
// tests. Point that fallback at a per-run temp dir so test writes never land
// in the repo (they used to pollute src/lib/ with party-index-*.json junk).
process.env.BLOB_STORE_FS_DIR = mkdtempSync(join(tmpdir(), 'hg-test-blobs-'))

// Booking/payment endpoints are gated closed in production pre-opening
// (see src/lib/bookings-gate.ts). Tests exercise the real booking behavior,
// so open the gate here; the gate's own logic is covered in bookings-gate.test.ts.
process.env.BOOKINGS_OPEN = 'true'
// LEGACY FALLBACK — delete after 2027-01-15 (this setting).
// The own booking system's tests run on it; production starts on the old
// Square booking (booking-switch.ts envSystems). Tests of that default and of
// the old party checkout clear this themselves.
process.env.BOOKING_SYSTEMS = 'own'

// /admin remembers a few per-device choices (the Classes segment) in sessionStorage: each test starts clean.
import { afterEach as clearAfterEach } from 'vitest'
clearAfterEach(() => {
  try { globalThis.sessionStorage?.clear() } catch { /* node environment: none */ }
})
