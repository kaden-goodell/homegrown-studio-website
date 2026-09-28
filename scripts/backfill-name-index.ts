import 'dotenv/config'

/**
 * Backfill the last-name search index (HOM-208's `contact-name-{normalized}`
 * keys) for waiver records written before that index existed. Idempotent —
 * `indexWaiverByName` is the exact function the live sign path calls, and it
 * already de-dupes by recordId, so re-running this is always safe.
 *
 * Usage:
 *   npx tsx scripts/backfill-name-index.ts [--dry-run]
 *
 * Points at whichever store `makeKvStore` resolves to for this environment —
 * Netlify Blobs in prod (needs the Netlify CLI's linked-site context or the
 * NETLIFY_* env vars set), `.data/waivers/` on disk otherwise. Run it once
 * per environment (dev, then prod) after this ships.
 */
import { makeKvStore } from '../src/lib/blob-store'
import { getWaiverRecord, indexWaiverByName } from '../src/lib/waiver-store'

const dryRun = process.argv.includes('--dry-run')
const kv = makeKvStore('waivers', 'waivers')

async function main() {
  const keys = (await kv.list()).filter((k) => k.startsWith('wvr_'))
  console.log(`Found ${keys.length} waiver record(s).`)

  let indexed = 0
  let skipped = 0
  let failed = 0

  for (const id of keys) {
    const record = await getWaiverRecord(id)
    if (!record) { failed++; console.error(`  ! ${id} — couldn’t read record`); continue }
    if (!record.adult.lastName?.trim()) { skipped++; continue }

    if (dryRun) {
      console.log(`  [dry-run] would index "${id}" under last name "${record.adult.lastName.trim()}"`)
      indexed++
      continue
    }
    await indexWaiverByName(record)
    indexed++
  }

  console.log(
    `${dryRun ? 'Would index' : 'Indexed'} ${indexed}, skipped ${skipped} (no last name), ${failed} unreadable.`,
  )
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
