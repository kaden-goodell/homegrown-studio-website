import 'dotenv/config'
import { SquareClient, SquareEnvironment } from 'square'

/**
 * Count the "tell me when…" sign-ups kept in Square. Read-only: it changes
 * nothing and sends nothing.
 *
 * Sign-ups live in each customer's note, one dated line per sign-up. By
 * default only totals are printed: no names, no addresses, nothing a visitor
 * typed. Pass --people to list who signed up for what.
 *
 * Usage:
 *   npx tsx scripts/list-signups.ts            # totals only
 *   npx tsx scripts/list-signups.ts --people   # each person and their lines
 */

const client = new SquareClient({ token: process.env.SQUARE_ACCESS_TOKEN!, environment: SquareEnvironment.Production })
const showPeople = process.argv.includes('--people')

const KINDS = [
  'party', 'party-date', 'party-time', 'party-craft', 'party-later',
  'workshops', 'workshop', 'workshop-soon', 'workshop-waitlist', 'kits', 'kit-theme',
]

/** "asked: party-later", "emailed: workshop", or "other" — never the visitor's own words. */
function shapeOf(line: string): string {
  const m = line.match(/^\d{4}-\d{2}-\d{2} (Asked to be told|Emailed|Email failed): (.*)$/)
  if (!m) return 'a line in some other format'
  const what = m[1] === 'Asked to be told' ? 'asked' : m[1].toLowerCase()
  if (m[2] === 'when booking opens') return `${what}: (nothing named)`
  const kind = m[2].split(/[: ]/)[0]
  return `${what}: ${KINDS.includes(kind) ? kind : '(something else)'}`
}

async function main() {
  let customers = 0
  let withLines = 0
  const counts = new Map<string, number>()
  for await (const c of await client.customers.list({ limit: 100, sortField: 'DEFAULT', sortOrder: 'ASC' })) {
    customers++
    const note = (c as any).note as string | undefined
    if (!note) continue
    const lines = note.split('\n').filter((l) => /asked to be told|emailed:|email failed:/i.test(l))
    if (lines.length === 0) continue
    withLines++
    if (showPeople) console.log(`\n${(c as any).emailAddress ?? '(no email)'}`)
    for (const line of lines) {
      if (showPeople) console.log(`  ${line}`)
      const shape = shapeOf(line.trim())
      counts.set(shape, (counts.get(shape) ?? 0) + 1)
    }
  }
  console.log(`\n${customers} customers in Square, ${withLines} with a sign-up line.`)
  for (const [shape, n] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`  ${n}  ${shape}`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
