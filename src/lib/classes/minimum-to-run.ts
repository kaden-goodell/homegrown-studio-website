/**
 * Minimum to run (audit N2 / I5): a class with a minimum that hasn't reached
 * it by its decide-by gets the owners a text and an email, on the day before
 * the decide-by day and on the day itself:
 *   "Potholders has 4 of 6, needs 6 by Thu 5 PM"
 * Run each morning inside the daily-warnings job. It only tells: nothing here
 * cancels, refunds or frees anything; the owners decide on /admin.
 *
 * Once per class per day, however many runs: a marker is claimed before the
 * alert goes. A day when nothing reached the owners is marked failed and the
 * next run that day tries again.
 *
 * decideByIso is stored as a UTC instant made from the studio date and time
 * the owner picked; its day and time are read back in studio time.
 */
import { makeKvStore } from '@lib/blob-store'
import { siteConfig } from '@config/site.config'
import { sendEmail } from '@lib/email'
import { alertOwners } from '@lib/owner-alert'
import { addDays } from '@lib/kit-dates'
import { createLogger } from '@lib/logger'
import { formatTime, studioDate } from '@lib/studio-time'
import { partyConfig } from '@config/party.config'
import { listClasses } from './class-store'
import { getLedger, seatsTaken, type Ledger } from './seat-ledger'
import { onStaffConsole } from './staff-view'
import type { ScheduledClass } from './types'

const logger = createLogger('classes:minimum-to-run')
const markers = makeKvStore('class-alerts', 'class-alerts')

export interface MinimumAlert {
  classId: string
  name: string
  booked: number
  count: number
  decideByIso: string
  /** studio day the alert is for */
  day: string
}

/** Classes below their minimum whose decide-by is today or tomorrow (studio days). Pure. */
export function minimumAlertsDue(rows: { cls: ScheduledClass; ledger: Ledger }[], now: Date): MinimumAlert[] {
  const today = studioDate(now.toISOString())
  const out: MinimumAlert[] = []
  for (const { cls, ledger } of rows) {
    const min = cls.content.rules.minimumToRun
    if (!min || !onStaffConsole(cls)) continue
    const first = [...cls.sessions].sort((a, b) => a.startIso.localeCompare(b.startIso))[0]
    if (!first || Date.parse(first.startIso) <= now.getTime()) continue
    const decideDay = studioDate(min.decideByIso)
    if (today !== decideDay && today !== addDays(decideDay, -1)) continue
    const booked = seatsTaken(ledger, first.id, now)
    if (booked >= min.count) continue
    out.push({ classId: cls.id, name: cls.content.name, booked, count: min.count, decideByIso: min.decideByIso, day: today })
  }
  return out
}

/** "Potholders has 4 of 6, needs 6 by Thu 5 PM" */
export function minimumAlertText(a: MinimumAlert): string {
  const weekday = new Date(a.decideByIso).toLocaleDateString('en-US', { weekday: 'short', timeZone: partyConfig.timezone })
  return `${a.name} has ${a.booked} of ${a.count}, needs ${a.count} by ${weekday} ${formatTime(a.decideByIso).replace(':00', '')}`
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const markerKey = (a: MinimumAlert) => `min-${a.classId}-${a.day}`

/** Claims today's alert for this class; false when it was already sent (or is being sent). */
async function claim(a: MinimumAlert, now: Date): Promise<boolean> {
  const { value, etag } = await markers.getWithMeta(markerKey(a))
  if (value) {
    const prev = JSON.parse(value) as { state?: string }
    if (prev.state !== 'failed') return false
  }
  return markers.setIfMatch(markerKey(a), JSON.stringify({ state: 'sending', at: now.toISOString() }), etag, value !== null)
}

export interface MinimumRun { alerted: MinimumAlert[]; failed: MinimumAlert[]; already: number }

export async function runMinimumToRunAlerts(now: Date): Promise<MinimumRun> {
  const horizon = new Date(now.getTime() + 400 * 86_400_000).toISOString()
  const classes = (await listClasses({ fromIso: now.toISOString(), toIso: horizon })).filter((c) => c.content.rules.minimumToRun && onStaffConsole(c))
  const rows = await Promise.all(classes.map(async (cls) => ({ cls, ledger: await getLedger(cls.id) })))
  const run: MinimumRun = { alerted: [], failed: [], already: 0 }
  for (const a of minimumAlertsDue(rows, now)) {
    if (!(await claim(a, now).catch(() => false))) { run.already++; continue }
    const line = minimumAlertText(a)
    const body = [line, '', 'Decide on /admin whether it runs. Nothing has been cancelled.']
    const [text, email] = await Promise.all([
      alertOwners(`${line}. Decide on /admin. Nothing has been cancelled.`).then((r) => r.sent > 0).catch(() => false),
      sendEmail({ to: siteConfig.ownerEmails.join(', '), subject: line, text: body.join('\n'), html: body.filter(Boolean).map((l) => `<p>${esc(l)}</p>`).join('') })
        .then((r) => r.sent)
        .catch(() => false),
    ])
    const ok = text || email
    await markers.set(markerKey(a), JSON.stringify({ state: ok ? 'sent' : 'failed', at: now.toISOString(), text, email })).catch(() => undefined)
    if (ok) run.alerted.push(a)
    else run.failed.push(a)
    logger.info('Minimum-to-run alert', { classId: a.classId, booked: a.booked, count: a.count, text, email })
  }
  return run
}
