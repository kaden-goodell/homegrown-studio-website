import type { APIRoute } from 'astro'
import { cafeOn } from '@lib/cafe-days'
import { getStudioDays } from '@lib/studio-settings'
import { staffAuthorized, byOf } from '@lib/staff-auth'
import {
  checkInOpenStudio, dayTotals, entryCounts, getCafeWaiting, getOpenStudioDay, removeCafeWaiting, undoOpenStudio, waitingMatches,
  DATE_RE, type CafeWaiting, type OpenStudioDay,
} from '@lib/open-studio-store'
import { getWaiverRecord, householdFrom, lookupHouseholdEntry, lookupHouseholdsByName, type HouseholdOnFile, type WaiverRecord } from '@lib/waiver-store'
import { classWritesRefusal } from '@lib/classes/test-site-guard'
import { addDays } from '@lib/kit-dates'
import { isCurrent } from '@lib/waiver-coverage'
import { householdMatchOf } from '@lib/door-household'
import { studioDate } from '@lib/studio-time'
import { createLogger } from '@lib/logger'
import { recordAudit } from '@lib/audit'
import { paymentBypassEnabled } from '@lib/dev-flags'

export const prerender = false

const logger = createLogger('api:staff:open-studio')

const STORAGE = 'Couldn’t reach storage — check wifi and try again.'
const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

function today(): string {
  return studioDate(new Date().toISOString())
}

/** Walk-ins are only checked in on a day Craft Café runs (Reports and the Calendar count the same days). */
export const NOT_A_CAFE_DAY = 'Only on Craft Café days — ask Catherine or Kaden to add a special day.'
/** The waiver on file has expired or is on older terms. */
export const SIGN_AGAIN = 'Their waiver needs signing again before they craft. Tap Get them signed again.'
/** How far back crew can open a day's Craft Café list (owners: any day). */
export const CREW_DAYS_BACK = 7

/** "Jane Doe" and who came by name, in personIds order. */
function snapshotOf(w: WaiverRecord, personIds: string[]): { name: string; people: string[] } {
  const name = `${w.adult.firstName} ${w.adult.lastName}`.trim()
  const people = personIds.map((id) => (id === 'adult' ? name : w.minors[Number(id.slice('child:'.length))]?.name ?? 'Someone'))
  return { name, people }
}

/** The people a waiver has: the signer, and each of their kids. */
const personIdsOf = (w: WaiverRecord) => ['adult', ...w.minors.map((_, i) => `child:${i}`)]

/**
 * POST { recordId, personIds[], waitingId? } → check a family in at Craft
 * Café today. Their waiver must be good for today (no waiver, no crafting).
 * Idempotent — re-checking the same household just updates who came and
 * when. Clears them off "Waiting on a waiver" (the entry the kiosk carried,
 * and any entry their signed waiver matches).
 */
export const POST: APIRoute = async ({ request }) => {
  const staff = await staffAuthorized(request)
  if (!staff) return json({ error: 'Unauthorized' }, 401)
  const refusal = classWritesRefusal(request)
  if (refusal) return json({ error: refusal, code: 'NO_TEST_STORE' }, 503)

  const body = await request.json().catch(() => null)
  const recordId = typeof body?.recordId === 'string' ? body.recordId : ''
  const asked: string[] = Array.isArray(body?.personIds) ? body.personIds.map((s: unknown) => String(s).trim()).filter(Boolean) : []
  const waitingId = typeof body?.waitingId === 'string' ? body.waitingId : ''
  const anyway = body?.anyway === true
  if (!recordId || asked.length === 0) return json({ error: 'Missing recordId or personIds' }, 400)

  const date = today()
  let waiver: WaiverRecord | null
  try {
    // Only on a day Craft Café runs: a check-in on any other day couldn't be seen or undone on /staff.
    if (!cafeOn(date, await getStudioDays())) return json({ error: NOT_A_CAFE_DAY, code: 'NOT_A_CAFE_DAY' }, 409)
    waiver = await getWaiverRecord(recordId)
  } catch (err) {
    logger.error('Craft Café check-in: waiver read failed', { recordId, error: err instanceof Error ? err.message : String(err) })
    return json({ error: STORAGE }, 503)
  }
  if (!waiver) return json({ error: 'We couldn’t find that family’s waiver. Search for them again.' }, 404)
  // Like classes: sign again first; "Mark here anyway" stays possible, and the log says so.
  const needsSigning = !isCurrent(waiver, new Date())
  if (needsSigning && !anyway) return json({ error: SIGN_AGAIN, needsSigning: true }, 409)
  const valid = new Set(personIdsOf(waiver))
  const personIds = [...new Set(asked)].filter((id) => valid.has(id))
  if (personIds.length === 0) return json({ error: 'Pick who’s here.' }, 400)

  try {
    await checkInOpenStudio(date, recordId, personIds, byOf(staff), snapshotOf(waiver, personIds))
  } catch (err) {
    logger.error('Craft Café check-in failed', { recordId, error: err instanceof Error ? err.message : String(err) })
    return json({ error: STORAGE }, 503)
  }

  // Off "Waiting on a waiver": an extra, never fails the check-in.
  try {
    const signed = { firstName: waiver.adult.firstName, lastName: waiver.adult.lastName, phone: waiver.adult.phone, signedAt: waiver.signedAt }
    const waiting = await getCafeWaiting(date)
    // By the entry the kiosk carried, the waiver it signed, the phone or the full name: a last name alone could be another family.
    const done = waiting.filter((w) => w.id === waitingId || w.recordId === recordId || waitingMatches(w, signed, { lastNameOnly: false })).map((w) => w.id)
    await removeCafeWaiting(date, done)
  } catch (err) {
    logger.error('Craft Café waiting list not cleared', { recordId, error: err instanceof Error ? err.message : String(err) })
  }

  await recordAudit({
    by: staff,
    action: 'checkin.here',
    target: { kind: 'household', id: recordId, label: `${waiver.adult.firstName} ${waiver.adult.lastName}`.trim() },
    details: { people: personIds.length, where: 'craft-cafe', date, ...(needsSigning ? { anyway: true } : {}) },
    ...(paymentBypassEnabled(request) ? { simulated: true as const } : {}),
  })
  return json({ data: { ok: true } }, 200)
}

/**
 * DELETE ?recordId= → Undo: take a family off today's Craft Café list
 * (checked in by mistake, or the wrong family). Logged with who did it.
 */
export const DELETE: APIRoute = async ({ request, url }) => {
  const staff = await staffAuthorized(request)
  if (!staff) return json({ error: 'Unauthorized' }, 401)
  const refusal = classWritesRefusal(request)
  if (refusal) return json({ error: refusal, code: 'NO_TEST_STORE' }, 503)
  const recordId = (url ?? new URL(request.url)).searchParams.get('recordId') ?? ''
  if (!recordId) return json({ error: 'Missing recordId' }, 400)
  const date = today()
  let gone
  try {
    gone = await undoOpenStudio(date, recordId)
  } catch (err) {
    logger.error('Craft Café undo failed', { recordId, error: err instanceof Error ? err.message : String(err) })
    return json({ error: STORAGE }, 503)
  }
  // Already off the list (a second tap, or another iPad got there first): nothing to log.
  if (!gone) return json({ data: { ok: true, already: true } }, 200)
  await recordAudit({
    by: staff,
    action: 'checkin.undone',
    target: { kind: 'household', id: recordId, ...(gone.name ? { label: gone.name } : {}) },
    details: { people: gone.personIds.length, where: 'craft-cafe', date },
    ...(paymentBypassEnabled(request) ? { simulated: true as const } : {}),
  })
  return json({ data: { ok: true } }, 200)
}

/** Families on a day's list, newest first, with names (older entries are looked up). */
async function entriesOf(day: OpenStudioDay) {
  const rows = await Promise.all(Object.entries(day).map(async ([recordId, e]) => {
    let name = e.name
    let people = e.people
    if (!name || !people) {
      const w = await getWaiverRecord(recordId).catch(() => null)
      if (w) ({ name, people } = snapshotOf(w, e.personIds))
    }
    const { adults, kids } = entryCounts(e)
    return { recordId, name: name || 'A family', people: people ?? [], at: e.at, by: e.by?.name ?? '', adults, kids }
  }))
  return rows.sort((a, b) => b.at.localeCompare(a.at))
}

/** Lookups per sheet load stay bounded. */
const WAITING_LOOKUPS = 20

/**
 * A waiting family's waiver, once they've signed one that's good for today.
 * Found by the waiver signed on this iPad, the texted phone, or the typed
 * name. A name two signed families share is never guessed: `many` says how
 * many, and the crew search and pick.
 */
async function signedFor(w: CafeWaiting, now: Date): Promise<{ match: HouseholdOnFile | null; many: number }> {
  if (w.recordId) {
    const r = await getWaiverRecord(w.recordId)
    const h = r ? householdFrom(r) : null
    if (h && isCurrent(h, now)) return { match: h, many: 0 }
  }
  let found: HouseholdOnFile[] = []
  if (w.phone) {
    const h = await lookupHouseholdEntry(w.phone)
    found = h ? [h] : []
  } else {
    const last = w.name.trim().split(/\s+/).pop() ?? ''
    if (last.length >= 2 && w.name.trim().toLowerCase() !== 'new family') found = await lookupHouseholdsByName(last)
  }
  const matches = found.filter((h) => isCurrent(h, now) && waitingMatches(w, h))
  if (matches.length > 1) return { match: null, many: matches.length }
  return { match: matches[0] ?? null, many: 0 }
}

/**
 * GET ?date=YYYY-MM-DD → { count, cafe, hours, totals } — the Craft Café row
 * on This week and Today ("☕ Craft Café 9 AM – 1 PM · 6 here").
 * Add `&detail=1` for the Craft Café sheet: everyone checked in (family,
 * who, when, who checked them in) and "Waiting on a waiver" (with the
 * family's waiver once they've signed, so the crew can check them in).
 */
export const GET: APIRoute = async ({ request, url }) => {
  const staff = await staffAuthorized(request)
  if (!staff) return json({ error: 'Unauthorized' }, 401)
  const u = url ?? new URL(request.url)
  const asked = u.searchParams.get('date')
  const date = asked && DATE_RE.test(asked) ? asked : today()
  const detail = u.searchParams.get('detail') === '1'
  // Who came, by name: crew see today and the last week (what the door needs); owners see any day.
  if (detail && staff.role !== 'owner' && date < addDays(today(), -CREW_DAYS_BACK)) {
    return json({ error: 'You can open the last week’s Craft Café lists. Catherine and Kaden can see older ones in /admin.' }, 403)
  }
  try {
    const [day, days] = await Promise.all([getOpenStudioDay(date), getStudioDays()])
    const totals = dayTotals(day)
    // Whether Craft Café runs that day (the owners' hours and closed days), so the row shows only then.
    const hours = cafeOn(date, days)
    const base = { date, count: totals.people, cafe: hours, hours, totals, isToday: date === today() }
    if (!detail) return json({ data: base }, 200)

    const now = new Date()
    const waitingRaw = date === today() ? await getCafeWaiting(date).catch((): CafeWaiting[] => []) : []
    const waiting = (await Promise.all(waitingRaw.slice(-WAITING_LOOKUPS).map(async (w) => {
      const { match: h, many } = await signedFor(w, now).catch(() => ({ match: null, many: 0 }))
      // Already checked in another way: they're not waiting any more.
      if (h && day[h.recordId]) return null
      return {
        id: w.id, name: w.name, how: w.how, at: w.at, by: w.by?.name ?? '',
        signed: h ? householdMatchOf(h, day, now) : null,
        ...(many > 1 ? { signedMany: many } : {}),
        ...(w.how === 'text' && w.sent === false ? { textFailed: true } : {}),
      }
    }))).filter((w) => w !== null)
    return json({ data: { ...base, entries: await entriesOf(day), waiting } }, 200)
  } catch (err) {
    logger.error('Craft Café day failed', { date, error: err instanceof Error ? err.message : String(err) })
    return json({ error: STORAGE }, 503)
  }
}
