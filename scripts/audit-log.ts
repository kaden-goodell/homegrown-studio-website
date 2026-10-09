/**
 * Read the PRODUCTION staff audit log: who did what, newest first, one line
 * each. Reads the production Netlify Blobs store through the authed `netlify`
 * CLI (the app's own store falls back to local disk off Netlify).
 *
 * Usage:
 *   npx tsx scripts/audit-log.ts [--limit 100] [--by <staffId>] [--since YYYY-MM-DD] [--with-simulated]
 *
 * Previews share production's stores, so their simulated actions are hidden
 * unless --with-simulated is given (then they're marked [simulated]).
 */
import { AUDIT_PREFIX, auditKeysNewestFirst, type AuditEntry } from '../src/lib/audit'
import { blobGet, blobKeys, mapLimit, requireNetlifyCli } from './lib/netlify-blobs'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

export function formatLine(e: AuditEntry): string {
  const target = `${e.target.kind}:${e.target.label ?? e.target.id}`
  const details = e.details
    ? Object.entries(e.details).filter(([, v]) => v !== null && v !== '').map(([k, v]) => `${k}=${v}`).join(' ')
    : ''
  return [e.at, `${e.by.name} (${e.by.role})`, e.action + (e.simulated ? ' [simulated]' : ''), target, details].join(' · ')
}

const BATCH = 8

async function main() {
  requireNetlifyCli()
  const rawLimit = Number(arg('limit') ?? 100)
  const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? rawLimit : 100
  const byId = arg('by')
  const withSimulated = process.argv.includes('--with-simulated')

  const keys = auditKeysNewestFirst(await blobKeys('audit', AUDIT_PREFIX), arg('since'))
  const out: AuditEntry[] = []
  // Fetch a batch at a time, newest first, until the limit is reached.
  for (let i = 0; i < keys.length && out.length < limit; i += BATCH) {
    const texts = await mapLimit(keys.slice(i, i + BATCH), BATCH, (k) => blobGet('audit', k))
    for (const text of texts) {
      if (!text || out.length >= limit) continue
      let e: AuditEntry
      try { e = JSON.parse(text.slice(text.indexOf('{'))) as AuditEntry } catch { continue }
      if (!withSimulated && e.simulated === true) continue
      if (byId && e.by?.id !== byId) continue
      out.push(e)
    }
  }
  if (out.length === 0) console.log('(no audit entries)')
  for (const e of out) console.log(formatLine(e))
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
