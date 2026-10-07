/**
 * Change an event's settings from the command line — the same `event-meta`
 * record the staff console's gear sheet writes, under the same rules
 * (`mergeEventMeta`): drop-off, multi-day span, per-seat questions and the
 * sign-up cutoff.
 *
 * Writes the PRODUCTION Netlify Blobs store through the authed `netlify` CLI
 * (site stores are site-wide, not per deploy). For local dev use the gear on
 * /staff instead (dev keeps event-meta on disk under .data/).
 *
 * Usage:
 *   npx tsx scripts/set-event.ts --workshop clssch_… --option "Pumpkin color=Light Pink|Light Blue|Black|Lavender"
 *   npx tsx scripts/set-event.ts --workshop clssch_… --cutoff 24          (or --cutoff default)
 *   npx tsx scripts/set-event.ts --workshop clssch_… --no-options
 *   npx tsx scripts/set-event.ts --workshop clssch_… --on | --off | --days 2026-10-18,2026-10-19
 *   npx tsx scripts/set-event.ts --workshop clssch_… --show
 *
 * `--option` may repeat; the list given REPLACES the class's questions. Once
 * anyone has picked, questions can't be added or removed and existing
 * choices can't be removed or renamed (adding choices is fine).
 *
 * Workshops are keyed by their Square class SCHEDULE id (clssch_…, from
 * scripts/list-classes.ts), parties by their booking id.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { classifyBlobRead, echoOptionIds, parseSetEventArgs } from '../src/lib/event-meta-cli'
import { emptyEventMeta, mergeEventMeta, normalizeEventMeta, type EventMeta } from '../src/lib/event-meta'
import { effectiveCutoffHours } from '../src/lib/seat-options'

const STORE = 'event-meta'
const CHOICES_STORE = 'seat-choices'
const BY = { id: 'kaden', name: 'Kaden (CLI)' }

const parsed = parseSetEventArgs(process.argv.slice(2))
if ('error' in parsed) {
  console.error(parsed.error)
  process.exit(1)
}
const { kind, id, show, patch } = parsed
const key = `event-meta-${kind}:${id}`

function netlify(args: string[]): string {
  return execFileSync('netlify', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

/** null = the key doesn't exist yet. Any other failure stops here, before a write. */
function read(): EventMeta | null {
  let stdout = ''
  let stderr = ''
  let status = 0
  try {
    const r = spawnSync('netlify', ['blobs:get', STORE, key], { encoding: 'utf8' })
    stdout = r.stdout ?? ''
    stderr = r.stderr ?? ''
    status = r.error ? 1 : (r.status ?? 1)
    if (r.error) stderr += String(r.error)
  } catch (err) {
    stderr = String(err)
    status = 1
  }
  const kindOfRead = classifyBlobRead(stdout, stderr, status)
  if (kindOfRead === 'missing') return null
  if (kindOfRead === 'error') {
    console.error(`✗ Couldn't read the current settings for ${key} — nothing was changed. (${(stderr || stdout).trim().slice(0, 300) || `exit ${status}`})`)
    process.exit(1)
  }
  return normalizeEventMeta(JSON.parse(stdout.slice(stdout.indexOf('{'))))
}

/** Has anyone picked for this class? If we can't tell, assume yes (the stricter rule). */
function hasPicks(): boolean {
  if (kind !== 'workshop') return false
  try {
    return netlify(['blobs:list', CHOICES_STORE]).includes(`seat-choices-workshop:${id}-`)
  } catch {
    console.warn('  could not list seat-choices; treating this class as already picked for')
    return true
  }
}

function summary(m: EventMeta): string {
  const questions = m.options.map((o) => `${o.label}=${o.choices.join('|')}`).join('; ') || '(none)'
  const cutoff = `${effectiveCutoffHours(m)}h${m.signupCutoffHours === null ? ' (default)' : ''}`
  return `dropOff=${m.dropOff} days=${m.days ? m.days.join(',') : '(single day)'} questions=${questions} cutoff=${cutoff}`
}

const current = read() ?? emptyEventMeta()

if (show) {
  console.log(JSON.stringify(current, null, 2))
  console.log(summary(current))
  process.exit(0)
}
if (Object.keys(patch).length === 0) {
  console.error('Nothing to change. Add --on/--off, --days, --option, --no-options or --cutoff (or --show to read).')
  process.exit(1)
}

if (patch.options) patch.options = echoOptionIds(current.options, patch.options)

let next: EventMeta
try {
  next = mergeEventMeta(current, patch, BY, new Date().toISOString(), patch.options !== undefined && hasPicks())
} catch (err) {
  console.error(`✗ ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}

const file = join(mkdtempSync(join(tmpdir(), 'event-meta-')), 'meta.json')
writeFileSync(file, JSON.stringify(next))
netlify(['blobs:set', STORE, key, '--input', file])

const after = read()
console.log(`${kind} ${id}: ${after ? summary(after) : '(could not read back)'}  (store ${STORE}, key ${key})`)
