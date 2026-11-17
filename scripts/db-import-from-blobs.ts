/**
 * One-time copy of the race-critical stores (src/lib/db/pg-stores.ts) from a
 * deploy's Netlify Blobs into Postgres (kv_store), plus their display copies.
 * Dry run by default. Never overwrites a record already in Postgres (prints
 * it as "kept"). Run it for the deploy whose blobs and database go together:
 *
 *   DATABASE_URL="$(npx netlify env:get DATABASE_URL --context branch:kaden/own-booking-system)" \
 *   STORE_NAMESPACE="$(npx netlify env:get STORE_NAMESPACE --context branch:kaden/own-booking-system)" \
 *   NETLIFY_SITE_ID=… NETLIFY_AUTH_TOKEN=… npx tsx scripts/db-import-from-blobs.ts [--write]
 *
 * (Production: STORE_NAMESPACE empty and the production DATABASE_URL. Its
 * stores for the new system are empty today, so it copies nothing.)
 */
import { getStore } from '@netlify/blobs'
import { neon } from '@neondatabase/serverless'
import { blobStoreName } from '../src/lib/blob-store-name'
import { PG_STORES } from '../src/lib/db/pg-stores'

const write = process.argv.includes('--write')
const { DATABASE_URL, NETLIFY_SITE_ID, NETLIFY_AUTH_TOKEN } = process.env
if (!DATABASE_URL || !NETLIFY_SITE_ID || !NETLIFY_AUTH_TOKEN) {
  console.error('Needs DATABASE_URL, NETLIFY_SITE_ID and NETLIFY_AUTH_TOKEN (and STORE_NAMESPACE for a preview).')
  process.exit(1)
}
const sql = neon(DATABASE_URL)
let copied = 0, kept = 0
for (const name of PG_STORES) {
  const table = blobStoreName(name, { STORE_NAMESPACE: process.env.STORE_NAMESPACE ?? '' })
  const blob = getStore({ name: table, siteID: NETLIFY_SITE_ID, token: NETLIFY_AUTH_TOKEN, consistency: 'strong' })
  const mirror = getStore({ name: `${table}-snapshot`, siteID: NETLIFY_SITE_ID, token: NETLIFY_AUTH_TOKEN, consistency: 'strong' })
  const { blobs } = await blob.list()
  const keys = blobs.map((b: { key: string }) => b.key).filter((k: string) => k !== '__probe__')
  if (!keys.length) continue
  console.log(`${table}: ${keys.length} record(s)`)
  for (const key of keys) {
    const value = await blob.get(key, { type: 'text' })
    if (value === null) continue
    if (!write) { copied++; continue }
    const rows = await sql.query(
      'INSERT INTO kv_store (store, key, value, version) VALUES ($1, $2, $3, 1) ON CONFLICT (store, key) DO NOTHING RETURNING version',
      [table, key, value],
    )
    if (rows.length) {
      copied++
      await mirror.set(key, JSON.stringify({ v: 1, value }))
    } else kept++
  }
}
console.log(write ? `Copied ${copied}; kept ${kept} already in Postgres.` : `Dry run: would copy ${copied}. Add --write to copy.`)
