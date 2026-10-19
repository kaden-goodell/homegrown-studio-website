/**
 * Class-day waiver reminder (Kaden, 12 Oct 2026: "rock solid… no false
 * positives/negatives").
 *
 * At 9 AM on class day, every family booked into a class later today whose
 * agreement isn't current gets one email and one text with the signing link.
 * The owners get a summary: who was reminded, who is signed, and anyone the
 * site couldn't check.
 *
 * Who is booked: our seat records (every online booking, every staff comp /
 * door seat), each re-checked with Square: only a booking Square still calls
 * "accepted", for this class at this time, counts. A cancelled one is skipped.
 *
 * Our own classes (stage 1): families come from the seat ledger, every line
 * that still holds a seat (confirmed, or refunded with the seat kept) on a
 * session later today. A class that meets on several days gets its reminder
 * on each of those days. A counter sale with no name yet has no one to
 * contact and is skipped.
 *
 * Signed: any one of (a) a signature made for this very booking (the waiver
 * link carries the booking id), (b) an agreement on file under the booking's
 * email, (c) one under its phone. "Current" is the door check's own rule
 * (src/lib/waiver-coverage.ts).
 *
 * Anything the site can't answer (Square or storage not responding) is never
 * guessed: that family gets no message, and the owners' summary names them.
 * One message per family per day, however many classes and however many runs.
 */
import { providers } from '@config/providers'
import { listSeatChoicesByEvent, type SeatChoiceRecord } from '@lib/seat-choices'
import { listRsvpsByEvent } from '@lib/rsvp-store'
import { getWaiverRecord, lookupHouseholdEntry } from '@lib/waiver-store'
import { agreementState, type AgreementState } from '@lib/waiver-coverage'
import { studioDate, formatTime } from '@lib/studio-time'
import { makeKvStore } from '@lib/blob-store'
import { sendEmail } from '@lib/email'
import { sendQuoText, toE164, quoConfigured } from '@lib/quo'
import { withUtm } from '@lib/utm'
import { siteConfig } from '@config/site.config'
import { createLogger } from '@lib/logger'
import type { Workshop } from '@providers/interfaces/workshop'
import { listClasses } from '@lib/classes/class-store'
import { getLedger, type LedgerLine } from '@lib/classes/seat-ledger'
import { holdsSeat, onStaffConsole, sessionsOn } from '@lib/classes/staff-view'
import { studioDayUtcRange } from '@lib/studio-time'

const logger = createLogger('waiver-reminders')
const sentStore = makeKvStore('waiver-reminders', 'waiver-reminders')

export interface ReminderClass {
  scheduleId: string
  name: string
  startAt: string
  bookingId: string
}

export interface Family {
  key: string
  givenName: string
  familyName: string
  email: string
  phone: string
  classes: ReminderClass[]
}

export interface ReminderPlan {
  day: string
  /** Not signed (or signed but not current): remind them. */
  remind: (Family & { state: 'none' | Exclude<AgreementState, 'current'> })[]
  /** Booked today and covered. */
  signed: Family[]
  /** Booked today but something couldn't be checked: no message, owners told. */
  unsure: (Family & { why: string })[]
  /** Reminded earlier today already. */
  alreadyReminded: Family[]
  /** Whole sources that couldn't be read (our own classes): owners told, nobody guessed at. */
  notes?: string[]
}

const familyKey = (r: SeatChoiceRecord) => r.customer.email.trim().toLowerCase() || `phone:${r.customer.phone.replace(/\D/g, '').slice(-10)}`

/** Is this record's seat still booked in Square, for this class at this time? */
async function stillBooked(r: SeatChoiceRecord, w: Workshop): Promise<boolean> {
  const ids = r.squareBookingIds?.length ? r.squareBookingIds : [r.bookingId]
  // A seat staff added in Square by hand ("I added them in Square") has no
  // Square id here; staff made it today or before, so it stands.
  if (ids.every((id) => !id.startsWith('clsbk_'))) return true
  const answers = await Promise.all(ids.filter((id) => id.startsWith('clsbk_')).map((id) => providers.workshop.getSeatBooking(id)))
  return answers.some((b) => b !== null && b.status === 'accepted' && b.scheduleId === w.scheduleId && Date.parse(b.startAt) === Date.parse(w.startAt))
}

/** How the family's agreement stands for this booking. Throws when storage can't answer. */
async function coverage(r: SeatChoiceRecord, scheduleId: string, now: Date): Promise<'current' | 'none' | Exclude<AgreementState, 'current'>> {
  const states: AgreementState[] = []
  // (a) signed through this booking's own link
  const ids = new Set([r.bookingId, ...(r.squareBookingIds ?? [])])
  for (const rsvp of await listRsvpsByEvent('workshop', scheduleId)) {
    if (!rsvp.ref?.bookingId || !ids.has(rsvp.ref.bookingId)) continue
    const w = await getWaiverRecord(rsvp.waiverId)
    if (w) states.push(agreementState(w, now))
  }
  // (b) email, (c) phone
  for (const contact of [r.customer.email, r.customer.phone]) {
    if (!contact?.trim()) continue
    if (!contact.includes('@') && contact.replace(/\D/g, '').length < 10) continue
    const h = await lookupHouseholdEntry(contact)
    if (h) states.push(agreementState(h, now))
  }
  if (states.includes('current')) return 'current'
  if (states.includes('expired')) return 'expired'
  if (states.includes('outdated')) return 'outdated'
  return 'none'
}

interface OwnBooking {
  bookingId: string
  customer: NonNullable<LedgerLine['customer']>
  cls: ReminderClass
}

/**
 * Bookings on our own classes with a session later today: one per booking,
 * from the ledger lines that still hold a seat on that session. Lines with no
 * name (a counter sale not yet named) are skipped: there is no one to contact.
 * Throws when the classes or a ledger can't be read.
 */
async function ownClassBookingsToday(day: string, now: Date): Promise<OwnBooking[]> {
  const { startIso, endIso } = studioDayUtcRange(day)
  const classes = (await listClasses({ fromIso: startIso, toIso: endIso })).filter(onStaffConsole)
  const out: OwnBooking[] = []
  for (const cls of classes) {
    const session = sessionsOn(cls, day).find((x) => Date.parse(x.startIso) > now.getTime())
    if (!session) continue
    const ledger = await getLedger(cls.id)
    const seen = new Set<string>()
    for (const l of ledger.lines) {
      if (!holdsSeat(l) || !l.sessionIds.includes(session.id) || !l.customer) continue
      if (seen.has(l.bookingId)) continue
      seen.add(l.bookingId)
      out.push({ bookingId: l.bookingId, customer: l.customer, cls: { scheduleId: cls.id, name: cls.content.name, startAt: session.startIso, bookingId: l.bookingId } })
    }
  }
  return out.sort((a, b) => Date.parse(a.cls.startAt) - Date.parse(b.cls.startAt))
}

export async function planWaiverReminders(now: Date): Promise<ReminderPlan> {
  const day = studioDate(now.toISOString())
  const workshops = ((await providers.workshop.listAllWorkshops?.()) ?? [])
    .filter((w) => studioDate(w.startAt) === day && Date.parse(w.startAt) > now.getTime())
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))

  type Seen = Family & { states: string[]; whys: string[] }
  const families = new Map<string, Seen>()
  const familyOf = (r: Pick<SeatChoiceRecord, 'customer'>): Seen => {
    const key = familyKey(r as SeatChoiceRecord)
    const f: Seen = families.get(key) ?? {
      key,
      givenName: r.customer.givenName,
      familyName: r.customer.familyName,
      email: r.customer.email.trim(),
      phone: r.customer.phone.trim(),
      classes: [],
      states: [],
      whys: [],
    }
    if (!f.phone && r.customer.phone.trim()) f.phone = r.customer.phone.trim()
    return f
  }
  for (const w of workshops) {
    const records = (await listSeatChoicesByEvent('workshop', w.scheduleId)).filter((r) => r.simulated !== true)
    for (const r of records) {
      const f = familyOf(r)
      const key = f.key
      let booked: boolean
      try {
        booked = await stillBooked(r, w)
      } catch (err) {
        f.classes.push({ scheduleId: w.scheduleId, name: w.name, startAt: w.startAt, bookingId: r.bookingId })
        f.whys.push(`couldn't confirm their ${w.name} booking with Square`)
        families.set(key, f)
        logger.warn('Booking status unknown', { bookingId: r.bookingId, error: err instanceof Error ? err.message : String(err) })
        continue
      }
      if (!booked) continue
      f.classes.push({ scheduleId: w.scheduleId, name: w.name, startAt: w.startAt, bookingId: r.bookingId })
      try {
        f.states.push(await coverage(r, w.scheduleId, now))
      } catch (err) {
        f.whys.push(`couldn't read the signed agreements`)
        logger.warn('Coverage unknown', { bookingId: r.bookingId, error: err instanceof Error ? err.message : String(err) })
      }
      families.set(key, f)
    }
  }

  const notes: string[] = []
  try {
    for (const b of await ownClassBookingsToday(day, now)) {
      const f = familyOf(b)
      f.classes.push(b.cls)
      try {
        f.states.push(await coverage(b as unknown as SeatChoiceRecord, b.cls.scheduleId, now))
      } catch (err) {
        f.whys.push(`couldn't read the signed agreements`)
        logger.warn('Coverage unknown', { bookingId: b.bookingId, error: err instanceof Error ? err.message : String(err) })
      }
      families.set(f.key, f)
    }
  } catch (err) {
    notes.push("Our own classes couldn't be read, so nobody booked in them was checked or reminded. Please check today's rosters by hand.")
    logger.error('Own classes unreadable for waiver reminders', { error: err instanceof Error ? err.message : String(err) })
  }

  const plan: ReminderPlan = { day, remind: [], signed: [], unsure: [], alreadyReminded: [], ...(notes.length ? { notes } : {}) }
  for (const f of families.values()) {
    const { states, whys, ...family } = f
    if (family.classes.length === 0) continue
    // Covered through any one booking means the household has a current agreement.
    if (states.includes('current')) { plan.signed.push(family); continue }
    if (whys.length > 0) { plan.unsure.push({ ...family, why: [...new Set(whys)].join('; ') }); continue }
    if (!family.email && !toE164(family.phone)) { plan.unsure.push({ ...family, why: 'no email or phone to reach them' }); continue }
    let reminded: string | null
    try {
      reminded = await sentStore.get(sentKey(day, family.key))
    } catch {
      plan.unsure.push({ ...family, why: `couldn't tell whether they were already reminded` })
      continue
    }
    if (reminded) { plan.alreadyReminded.push(family); continue }
    const state = states.includes('expired') ? 'expired' : states.includes('outdated') ? 'outdated' : 'none'
    plan.remind.push({ ...family, state })
  }
  return plan
}

const sentKey = (day: string, familyKey: string) => `reminded-${day}-${familyKey}`

/** "1 PM" / "7:30 PM": no ":00", and never a colon when it can be avoided. */
export function shortTime(iso: string): string {
  return formatTime(iso).replace(':00', '')
}

/** "Bedazzled Pumpkin Pails at 1 PM" / "A at 1 PM and B at 4 PM". */
export function classList(classes: ReminderClass[]): string {
  const parts = classes.map((c) => `${c.name} at ${shortTime(c.startAt)}`)
  return parts.length <= 2 ? parts.join(' and ') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

export function waiverLink(origin: string, c: ReminderClass, medium: 'email' | 'sms' = 'email'): string {
  return withUtm(`${origin.replace(/\/$/, '')}/waiver?workshop=${encodeURIComponent(c.scheduleId)}&booking=${encodeURIComponent(c.bookingId)}`, {
    source: 'reminder',
    medium,
    campaign: 'waiver_class_day',
  })
}

// No name in the greeting: the name on a booking is often the child's
// ("Flynn Boone"), and the message goes to the parent.
export function reminderText(f: Family, link: string): string {
  return `Hometown Studio here. You're booked for ${classList(f.classes)} today. We still need a signed participation agreement before class. It takes about two minutes. ${link}`
}

export function reminderEmail(f: Family, link: string): { subject: string; text: string; html: string } {
  const address = '525 Hughes Rd, Suite F, Madison, AL 35758'
  const lines = [
    `Hi there,`,
    `You're booked for ${classList(f.classes)} today. We still need a signed participation agreement before class, so please sign it before you come. It takes about two minutes.`,
  ]
  const after = `Already signed with a different email or phone? Just reply and we'll match it up.`
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const P = 'margin:0 0 12px;font-size:15px;color:#3d3630;line-height:1.55'
  const BUTTON = 'display:inline-block;margin:4px 0 16px;padding:12px 22px;border-radius:9999px;background:#7a4a2e;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none'
  return {
    subject: 'Please sign before class today',
    text: [...lines, '', `Sign the agreement ${link}`, '', after, '', 'See you soon!', `Hometown Studio · ${address}`].join('\n'),
    html: `
<div style="max-width:560px;margin:0 auto;padding:8px 4px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <p style="margin:0 0 14px;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#7a4a2e;font-weight:700;">Hometown Studio</p>
  ${lines.map((l) => `<p style="${P}">${esc(l)}</p>`).join('\n  ')}
  <a href="${esc(link)}" style="${BUTTON}">Sign the agreement</a>
  <p style="${P}">${esc(after)}</p>
  <p style="${P}">See you soon!</p>
  <p style="margin:0;font-size:12px;color:#6f635b;">Hometown Studio &middot; ${esc(address)}</p>
</div>`,
  }
}

export interface ReminderRun {
  plan: ReminderPlan
  sent: { family: Family; email: boolean; text: boolean }[]
  summarySent: boolean
}

/** Plan, send, remember, and tell the owners. Never throws for one family's failure. */
export async function runWaiverReminders(now: Date, origin: string): Promise<ReminderRun> {
  const plan = await planWaiverReminders(now)
  const sent: ReminderRun['sent'] = []
  for (const f of plan.remind) {
    const link = waiverLink(origin, f.classes[0])
    const mail = reminderEmail(f, link)
    const [email, text] = await Promise.all([
      f.email ? sendEmail({ to: f.email, ...mail }).then((r) => r.sent).catch(() => false) : Promise.resolve(false),
      toE164(f.phone) && quoConfigured()
        ? sendQuoText({ to: f.phone, content: reminderText(f, waiverLink(origin, f.classes[0], 'sms')) }).then(() => true).catch(() => false)
        : Promise.resolve(false),
    ])
    if (email || text) {
      await sentStore.set(sentKey(plan.day, f.key), JSON.stringify({ at: now.toISOString(), email, text })).catch(() => undefined)
    }
    sent.push({ family: f, email, text })
    logger.info('Waiver reminder', { family: f.key, email, text })
  }
  const summarySent = await sendOwnerSummary(plan, sent).catch(() => false)
  return { plan, sent, summarySent }
}

export function ownerSummary(plan: ReminderPlan, sent: ReminderRun['sent']): { subject: string; text: string } | null {
  const notes = plan.notes ?? []
  const any = plan.remind.length + plan.signed.length + plan.unsure.length + plan.alreadyReminded.length + notes.length
  if (any === 0) return null
  const who = (f: Family) => `${f.givenName} ${f.familyName}`.trim()
  const how = (s: ReminderRun['sent'][number]) =>
    s.email && s.text ? 'emailed and texted' : s.email ? 'emailed (text failed or no phone)' : s.text ? 'texted (email failed or no email)' : 'NOT REACHED, email and text both failed'
  const lines: string[] = []
  if (notes.length) {
    lines.push(...notes)
    lines.push('')
  }
  if (sent.length) {
    lines.push('Reminded to sign (not on file yet)')
    for (const s of sent) lines.push(`  ${who(s.family)}, ${classList(s.family.classes)}, ${how(s)}${s.family.phone ? `, ${s.family.phone}` : ''}`)
    lines.push('')
  }
  if (plan.alreadyReminded.length) {
    lines.push('Reminded earlier today, still not signed')
    for (const f of plan.alreadyReminded) lines.push(`  ${who(f)}, ${classList(f.classes)}`)
    lines.push('')
  }
  if (plan.unsure.length) {
    lines.push("Couldn't check, so NOT reminded (please check by hand)")
    for (const f of plan.unsure) lines.push(`  ${who(f)}, ${classList(f.classes)}. ${f.why}`)
    lines.push('')
  }
  if (plan.signed.length) {
    lines.push('Signed and good to go')
    for (const f of plan.signed) lines.push(`  ${who(f)}, ${classList(f.classes)}`)
  }
  const missing = sent.length + plan.alreadyReminded.length
  return {
    subject: `Waivers for today's classes${missing ? `, ${missing} not signed yet` : ', everyone signed'}${plan.unsure.length || notes.length ? `, ${plan.unsure.length + notes.length} to check` : ''}`,
    text: lines.join('\n').trim(),
  }
}

async function sendOwnerSummary(plan: ReminderPlan, sent: ReminderRun['sent']): Promise<boolean> {
  const summary = ownerSummary(plan, sent)
  if (!summary) return false
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const html = `<pre style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;white-space:pre-wrap;">${esc(summary.text)}</pre>`
  const results = await Promise.all(siteConfig.ownerEmails.map((to) => sendEmail({ to, subject: summary.subject, text: summary.text, html }).then((r) => r.sent).catch(() => false)))
  return results.some(Boolean)
}
