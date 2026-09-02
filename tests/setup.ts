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
