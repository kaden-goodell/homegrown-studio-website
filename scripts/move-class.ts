import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { dashboardFetch } from '../src/lib/square-dashboard'

/**
 * Reschedule a class (Square class schedule) via the dashboard session.
 * Reads the cookie from captures/.square-session (see save-square-session.ts).
 *
 *   npx tsx scripts/move-class.ts --workshop clssch_… --start 2026-10-17T19:00 [--dry-run]
 *
 * --start is America/Chicago local time. Refuses a class with bookings.
 */
const argv = process.argv.slice(2)
const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined }
const id = flag('workshop')
const start = flag('start')
const dry = argv.includes('--dry-run')
if (!id || !start || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(start)) { console.error('Usage: --workshop clssch_… --start YYYY-MM-DDTHH:mm'); process.exit(1) }

/** Chicago local → UTC ISO (handles CDT/CST). */
function chicagoToUtc(local: string): string {
  const guess = new Date(`${local}:00Z`)
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  const p = Object.fromEntries(fmt.formatToParts(guess).map((x) => [x.type, x.value]))
  const asChicago = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute)
  return new Date(guess.getTime() + (guess.getTime() - asChicago)).toISOString()
}

async function main() {
  const cookie = readFileSync('captures/.square-session', 'utf8').trim()
  const path = `/appointments/api/class-schedules/${id}`
  const got = await dashboardFetch(path, {}, cookie)
  if (!got || !got.ok) { console.error('Could not read the class (signed out?)', got?.status); process.exit(1) }
  const schedule = (await got.json()).class_schedule
  const live = (schedule.class_bookings ?? []).filter((b: any) => !/CANCEL|DECLIN/.test(b.status ?? ''))
  if (live.length) { console.error(`Refusing: ${live.length} booking(s) on this class. Move it in Square so they are told.`); process.exit(1) }
  const startAt = chicagoToUtc(start!)
  const body = { class_schedule: { ...schedule, start_at: startAt } }
  if (body.class_schedule.resource_id === '') delete body.class_schedule.resource_id
  console.log(`${schedule.start_at} → ${startAt}`)
  if (dry) return
  const put = await dashboardFetch(path, { method: 'PUT', body }, cookie)
  if (!put || !put.ok) { console.error('Move failed', put?.status, await put?.text()); process.exit(1) }
  console.log('Moved.', (await put.json()).class_schedule?.start_at)
}
main().catch((e) => { console.error(e); process.exit(1) })
