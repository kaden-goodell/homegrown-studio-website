import '@testing-library/jest-dom'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Module-level kv stores (waiver/checkin/party) fall back to the filesystem in
// tests. Point that fallback at a per-run temp dir so test writes never land
// in the repo (they used to pollute src/lib/ with party-index-*.json junk).
process.env.BLOB_STORE_FS_DIR = mkdtempSync(join(tmpdir(), 'hg-test-blobs-'))
