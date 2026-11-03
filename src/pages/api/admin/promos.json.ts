import type { APIRoute } from 'astro'
import { adminActor, adminAuthorized } from '@lib/admin-auth'
import { json } from '@lib/classes/admin-actions'
import { recordAudit } from '@lib/audit'
import { createLogger } from '@lib/logger'
import { getClass, listClasses } from '@lib/classes/class-store'
import { listLibrary } from '@lib/classes/library-store'
import { getLedger } from '@lib/classes/seat-ledger'
import { takesSeat } from '@lib/classes/seat-status'
import { shortDay } from '@lib/classes/chicago-day'
import { TestSiteStoreError } from '@lib/classes/test-site-guard'
import { studioDate } from '@lib/studio-time'
import { getPromo, getUses, giveUseBack, listPromos, PromoSaveError, savePromo } from '@lib/promos/promo-store'
import { normalizeCode } from '@lib/promos/rules'
import type { PromoCode } from '@lib/promos/types'
import type { ScheduledClass } from '@lib/classes/types'

export const prerender = false
const logger = createLogger('api:admin:promos')
const YEAR_MS = 400 * 86_400_000
const UNREADABLE = 'The codes couldn’t be loaded. Try again.'

/** A code on the owner's list: the code, how many bookings used it, how many are paying with it right now. */
export type PromoView = PromoCode & { usedCount: number; payingNow: number }
/** A class a code can be for: a library class (every date of it) or one scheduled date. */
export interface PromoChoice { kind: 'library' | 'class'; id: string; name: string; day?: string }
/** One booking that used a code: who, which class, when, and whether they're still coming. */
export interface PromoUseView {
  bookingId: string
  at: string
  classId: string
  className: string
  who: string
  seats: number
  /** Every seat of the booking was freed (refunded or let go): a one-use code's use can be given back. */
  cancelled: boolean
}
export interface PromoGivenBackView { bookingId: string; at: string; by: string; className: string; who: string }

const dayOf = (c: ScheduledClass) => {
  const first = [...c.sessions].sort((a, b) => a.startIso.localeCompare(b.startIso))[0]
  return first ? studioDate(first.startIso) : ''
}

/** Names for the summary lines (library classes, archived too, and any class a code names) and the picker's choices. */
async function namesAndChoices(codes: PromoCode[], now: Date): Promise<{ names: Record<string, string>; choices: PromoChoice[] }> {
  const [library, upcoming] = await Promise.all([
    listLibrary({ includeArchived: true }),
    listClasses({ fromIso: now.toISOString(), toIso: new Date(now.getTime() + YEAR_MS).toISOString() }),
  ])
  const names: Record<string, string> = {}
  const choices: PromoChoice[] = []
  for (const l of library) {
    const name = l.versions.at(-1)?.content.name ?? 'A class'
    names[l.id] = name
    if (!l.archived) choices.push({ kind: 'library', id: l.id, name })
  }
  const classLabel = (c: ScheduledClass) => { const d = dayOf(c); return d ? `${c.content.name} · ${shortDay(d)}` : c.content.name }
  for (const c of upcoming) {
    names[c.id] = classLabel(c)
    if (c.status !== 'cancelled') choices.push({ kind: 'class', id: c.id, name: c.content.name, day: dayOf(c) })
  }
  // A class a code names that isn't coming up any more (a past date): its name still reads in the summary.
  const missing = [...new Set(codes.flatMap((p) => (p.appliesTo.kind === 'classes' ? p.appliesTo.classIds : [])))].filter((id) => !names[id])
  for (const c of (await Promise.all(missing.map((id) => getClass(id).catch(() => null)))).filter((x): x is ScheduledClass => !!x)) {
    names[c.id] = classLabel(c)
  }
  choices.sort((a, b) => (a.kind === b.kind ? (a.day ?? '').localeCompare(b.day ?? '') || a.name.localeCompare(b.name) : a.kind === 'library' ? -1 : 1))
  return { names, choices }
}

/** Who used a code, from each class's seat ledger (one read per class). */
async function usesOf(code: string): Promise<{ uses: PromoUseView[]; givenBack: PromoGivenBackView[] }> {
  const u = await getUses(code)
  if (!u) return { uses: [], givenBack: [] }
  const classIds = [...new Set([...u.used.map((x) => x.classId), ...(u.givenBack ?? []).map((x) => x.classId)])]
  const read = await Promise.all(classIds.map(async (id) => {
    const [cls, ledger] = await Promise.all([getClass(id).catch(() => null), getLedger(id).catch(() => ({ classId: id, lines: [] }))])
    return [id, { cls, ledger }] as const
  }))
  const byClass = new Map(read)
  const now = new Date()
  const about = (bookingId: string, classId: string) => {
    const r = byClass.get(classId)
    const lines = (r?.ledger.lines ?? []).filter((l) => l.bookingId === bookingId && l.state !== 'released')
    const c = lines.find((l) => l.customer)?.customer
    return {
      className: r?.cls ? `${r.cls.content.name}${dayOf(r.cls) ? ` · ${shortDay(dayOf(r.cls))}` : ''}` : 'A class',
      who: c ? `${c.givenName} ${c.familyName}`.trim() : 'Someone',
      seats: lines.length,
      cancelled: lines.length > 0 && !lines.some((l) => takesSeat(l, now)),
    }
  }
  return {
    uses: u.used.map((x) => ({ bookingId: x.bookingId, at: x.at, classId: x.classId, ...about(x.bookingId, x.classId) })).sort((a, b) => b.at.localeCompare(a.at)),
    givenBack: (u.givenBack ?? []).map((g) => {
      const a = about(g.bookingId, g.classId)
      return { bookingId: g.bookingId, at: g.at, by: g.by.name, className: a.className, who: a.who }
    }).sort((a, b) => b.at.localeCompare(a.at)),
  }
}

async function viewOf(code: string, now = new Date()): Promise<PromoView | null> {
  return (await listPromos(now)).find((p) => p.code === code) ?? null
}

/**
 * GET: every code (with uses and paying-now counts), names for the summary
 * lines, and the classes a code can be for. `?code=X`: that code and who used
 * it (and uses given back). Owners only.
 */
export const GET: APIRoute = async ({ request }) => {
  if (!(await adminAuthorized(request))) return json(401, { error: 'Sign in first.' })
  const now = new Date()
  const asked = new URL(request.url).searchParams.get('code')
  try {
    if (asked !== null) {
      const code = normalizeCode(asked)
      const view = code ? await viewOf(code, now) : null
      if (!code || !view) return json(404, { error: 'That code is gone. Go back to the list.' })
      const [{ names }, uses] = await Promise.all([namesAndChoices([view], now), usesOf(code)])
      return json(200, { data: { code: view, names, ...uses } })
    }
    const codes = await listPromos(now)
    const { names, choices } = await namesAndChoices(codes, now)
    return json(200, { data: { codes, names, choices } })
  } catch (e) {
    logger.error('Promo codes read failed', { error: e instanceof Error ? e.message : String(e) })
    return json(503, { error: UNREADABLE })
  }
}

/**
 * POST, owners only:
 * - { action: 'save', fields, expectedUpdatedAt }: null makes a new code
 *   ("That code is taken." when it exists); otherwise an edit, refused (409,
 *   `stale`) when someone saved it since. The code text never changes.
 * - { action: 'active', code, active, expectedUpdatedAt }: turn it on or off.
 * - { action: 'give-back', code, bookingId }: M8, give one booking's use back
 *   (a one-use personal code whose booking was refunded), so it works once more.
 * Every change is in the audit log (promo.save, promo.active, promo.give-back).
 */
export const POST: APIRoute = async ({ request }) => {
  if (!(await adminAuthorized(request))) return json(401, { error: 'Sign in first.' })
  const body = await request.json().catch(() => null)
  const by = await adminActor(request)
  const audit = (action: string, code: string, details: Record<string, string | number | boolean | null>) =>
    recordAudit({ by: { ...by, role: 'owner' }, action, target: { kind: 'promo', id: code, label: `Code ${code}` }, details })
  const expected = body?.expectedUpdatedAt
  if (expected !== undefined && expected !== null && typeof expected !== 'string') return json(400, { error: 'Reload the page and try again.' })
  try {
    if (body?.action === 'save') {
      const isNew = expected === null || expected === undefined
      const saved = await savePromo(body.fields, by, isNew ? null : expected)
      await audit('promo.save', saved.code, { made: isNew, change: saved.history.at(-1)?.change ?? '' })
      return json(200, { data: { code: await viewOf(saved.code) } })
    }
    if (body?.action === 'active') {
      const cur = typeof body.code === 'string' ? await getPromo(body.code) : null
      if (!cur) return json(404, { error: 'That code is gone. Go back to the list.' })
      if (typeof expected !== 'string') return json(400, { error: 'Reload the page and try again.' })
      const saved = await savePromo({ ...cur, active: body.active === true }, by, expected)
      await audit('promo.active', saved.code, { active: saved.active })
      return json(200, { data: { code: await viewOf(saved.code) } })
    }
    if (body?.action === 'give-back') {
      const code = typeof body.code === 'string' ? normalizeCode(body.code) : null
      const bookingId = typeof body.bookingId === 'string' ? body.bookingId : ''
      if (!code || !bookingId) return json(400, { error: 'Reload the page and try again.' })
      const done = await giveUseBack(code, bookingId, by)
      if (!done) return json(409, { error: 'That use was already given back. Reload to see it.' })
      await audit('promo.give-back', code, { bookingId })
      return json(200, { data: { code: await viewOf(code), ...(await usesOf(code)) } })
    }
    return json(400, { error: 'Reload the page and try again.' })
  } catch (e) {
    if (e instanceof PromoSaveError) return json(e.status, { error: e.message, ...(e.field ? { field: e.field } : {}), ...(e.status === 409 && e.field !== 'code' ? { stale: true } : {}) })
    if (e instanceof TestSiteStoreError) return json(503, { error: e.message })
    logger.error('Promo save failed', { error: e instanceof Error ? e.message : String(e) })
    return json(503, { error: 'Didn’t save. Try again.' })
  }
}
