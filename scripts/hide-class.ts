import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { dashboardFetch } from '../src/lib/square-dashboard'

/**
 * Take a dated class off the calendar (cancels the Square class SCHEDULE; the
 * class item, its description and photos stay, so it can be scheduled again).
 * Refuses any class that has a booking — people must never be dropped silently.
 *
 *   npx tsx scripts/hide-class.ts --workshop clssch_… [--dry-run]
 */
const argv = process.argv.slice(2)
const i = argv.indexOf('--workshop')
const id = i >= 0 ? argv[i + 1] : undefined
if (!id?.startsWith('clssch_')) { console.error('Usage: --workshop clssch_… [--dry-run]'); process.exit(1) }

async function main() {
  const cookie = readFileSync('captures/.square-session', 'utf8').trim()
  const path = `/appointments/api/class-schedules/${id}`
  const got = await dashboardFetch(path, {}, cookie)
  if (!got || !got.ok) { console.error('Could not read the class (signed out?)', got?.status); process.exit(1) }
  const schedule = (await got.json()).class_schedule
  const live = (schedule.class_bookings ?? []).filter((b: any) => !/CANCEL|DECLIN/.test(b.status ?? ''))
  if (live.length) { console.error(`Refusing: ${live.length} booking(s) on this class.`); process.exit(1) }
  console.log(`${id} at ${schedule.start_at}, status ${schedule.status}, no bookings`)
  if (argv.includes('--dry-run')) return
  const r = await dashboardFetch(`${path}/cancel`, { method: 'POST', body: {} }, cookie)
  console.log('cancel →', r?.status, (await r?.text())?.slice(0, 300))
}
main().catch((e) => { console.error(e); process.exit(1) })
