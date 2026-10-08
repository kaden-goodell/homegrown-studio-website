/**
 * Read the staff audit log: who did what, newest first, one line each.
 *
 * Usage:
 *   npx tsx scripts/audit-log.ts [--limit 100] [--by <staffId>] [--since YYYY-MM-DD]
 */
import 'dotenv/config'
import { listAudit, type AuditEntry } from '../src/lib/audit'

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

async function main() {
  const limit = Number(arg('limit') ?? 100)
  const entries = await listAudit({ limit: Number.isInteger(limit) && limit > 0 ? limit : 100, byId: arg('by'), since: arg('since') })
  if (entries.length === 0) console.log('(no audit entries)')
  for (const e of entries) console.log(formatLine(e))
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
