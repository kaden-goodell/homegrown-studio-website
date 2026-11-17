/**
 * Applies db/migrations/*.sql to the database in DATABASE_URL, in name order,
 * each once (recorded in schema_migrations), each in its own transaction.
 * Safe to run any number of times. Prints what it did; never prints the URL.
 *
 *   DATABASE_URL="$(npx netlify env:get DATABASE_URL --context <context>)" npx tsx scripts/db-migrate.ts
 *   … --dry-run   (lists what would run)
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Client } from '@neondatabase/serverless'

const dry = process.argv.includes('--dry-run')
const url = process.env.DATABASE_URL
if (!url) {
  console.error('Set DATABASE_URL (read it from Netlify; it is never stored in the repo).')
  process.exit(1)
}

const dir = join(process.cwd(), 'db', 'migrations')
const files = readdirSync(dir).filter((f) => /^\d+_.+\.sql$/.test(f)).sort()

const client = new Client(url)
await client.connect()
try {
  await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())')
  const done = new Set((await client.query('SELECT version FROM schema_migrations')).rows.map((r: { version: string }) => r.version))
  const todo = files.filter((f) => !done.has(f))
  console.log(`${host(url)}: ${done.size} applied, ${todo.length} to apply${dry ? ' (dry run)' : ''}`)
  for (const f of todo) {
    console.log(`  ${dry ? 'would apply' : 'applying'} ${f}`)
    if (dry) continue
    await client.query('BEGIN')
    try {
      await client.query(readFileSync(join(dir, f), 'utf8'))
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [f])
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    }
  }
  console.log(dry ? 'Dry run: nothing changed.' : 'Done.')
} finally {
  await client.end()
}

function host(u: string): string {
  try {
    const p = new URL(u)
    return `${p.hostname}${p.pathname}`
  } catch {
    return '(database)'
  }
}
