import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import type { Query } from '@lib/db/client'

/** An in-process Postgres with every migration in db/migrations applied, as a Query function. */
export async function pgliteQuery(): Promise<{ query: Query; pg: PGlite }> {
  const pg = new PGlite()
  const dir = join(process.cwd(), 'db', 'migrations')
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) await pg.exec(readFileSync(join(dir, f), 'utf8'))
  const query: Query = async (text, params = []) => (await pg.query(text, params as any[])).rows as Record<string, unknown>[]
  return { query, pg }
}
