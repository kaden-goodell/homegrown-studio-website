/**
 * Flip an event's drop-off setting (and optionally its multi-day span) from
 * the command line — the same `event-meta` record the staff console's gear
 * sheet writes, so the roster, the registration form (pickup fields) and the
 * pickup-code flow all follow it.
 *
 * Writes the PRODUCTION Netlify Blobs store through the authed `netlify` CLI
 * (site stores are site-wide, not per deploy), so no staff passcode or
 * browser session is needed. For local dev use the gear on /staff instead
 * (dev keeps event-meta on disk under .data/).
 *
 * Usage:
 *   npx tsx scripts/set-dropoff.ts --workshop clssch_akg2jc5wai5buy --on
 *   npx tsx scripts/set-dropoff.ts --workshop clssch_… --off
 *   npx tsx scripts/set-dropoff.ts --party <bookingId> --on
 *   npx tsx scripts/set-dropoff.ts --workshop clssch_… --days 2026-10-18,2026-10-19
 *   npx tsx scripts/set-dropoff.ts --workshop clssch_… --show
 *
 * Workshops are keyed by their Square class SCHEDULE id (clssch_…, from
 * scripts/list-classes.ts), parties by their booking id.
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const STORE = 'event-meta'
const HISTORY_CAP = 50
const BY = { id: 'kaden', name: 'Kaden (CLI)' }

const argv = process.argv.slice(2)
const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined }
const has = (n: string) => argv.includes(`--${n}`)

const kind = flag('workshop') ? 'workshop' : flag('party') ? 'party' : null
const id = flag('workshop') ?? flag('party')
if (!kind || !id) {
  console.error('Usage: set-dropoff.ts (--workshop <clssch_id> | --party <bookingId>) (--on | --off | --days a,b | --show)')
  process.exit(1)
}
const key = `event-meta-${kind}:${id}`

function netlify(args: string[]): string {
  return execFileSync('netlify', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function read(): any | null {
  try {
    const out = netlify(['blobs:get', STORE, key])
    const start = out.indexOf('{')
    return start >= 0 ? JSON.parse(out.slice(start)) : null
  } catch {
    return null // missing key
  }
}

const current = read() ?? { dropOff: false, days: null, updatedAt: new Date(0).toISOString(), by: { id: '', name: '' }, history: [] }

if (has('show')) {
  console.log(JSON.stringify(current, null, 2))
  process.exit(0)
}

const dropOff = has('on') ? true : has('off') ? false : current.dropOff
const daysArg = flag('days')
const days = daysArg !== undefined ? (daysArg ? daysArg.split(',').map((s) => s.trim()).filter(Boolean).sort() : null) : current.days
const now = new Date().toISOString()
const next = {
  dropOff,
  days,
  updatedAt: now,
  by: BY,
  history: [...(current.history ?? []), { at: now, by: BY, dropOff, days }].slice(-HISTORY_CAP),
}

const file = join(mkdtempSync(join(tmpdir(), 'event-meta-')), 'meta.json')
writeFileSync(file, JSON.stringify(next))
netlify(['blobs:set', STORE, key, '--input', file])

const after = read()
console.log(`${kind} ${id}: dropOff=${after?.dropOff} days=${after?.days ? after.days.join(',') : '(single day)'}  (store ${STORE}, key ${key})`)
