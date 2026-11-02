/**
 * Promo codes and their uses.
 *
 *   promo-codes  code-{CODE}  the code (create-only; edits by compare-and-swap)
 *   promo-uses   uses-{CODE}  paid uses + holds of bookings paying right now
 *
 * A limited code can't be over-used by two buyers at once: a booking reserves
 * a use (a hold that counts until it runs out) before anything is charged,
 * by compare-and-swap on the uses document, so of two buyers racing for the
 * last use one gets "used-up" before any Square call. A paid booking turns
 * its hold into a use; a failed one lets go of it; a refund never gives a
 * use back by itself.
 *
 * M8, the one case that matters: a one-use personal code ("MAYAFREE") is gone
 * once Maya books, even if she later cancels and is refunded (or her free
 * seat is freed). That is on purpose (a refund can't quietly re-arm a code),
 * so an owner gives the use back by hand: `giveUseBack` (Promotions, Task 6:
 * "Give this use back" on the code's list of bookings), or raises the limit.
 *
 * M5: a code can end up one over its limit ("3 of 2 used"): a booking whose
 * hold ran out while Square had not answered, then paid, still counts (the
 * money was taken). `listPromos` says how many are paying right now too.
 *
 * Server only. Writes are refused on a test site with no store of its own (R41).
 */
import { makeKvStore } from '@lib/blob-store'
import type { By } from '@lib/staff-auth'
import { assertClassWritesAllowed } from '@lib/classes/test-site-guard'
import { chicagoYmd } from '@lib/classes/chicago-day'
import { alertOwners } from '@lib/owner-alert'
import { createLogger } from '@lib/logger'
import { normalizeCode, validatePromo } from './rules'
import type { PromoCode, PromoFields, PromoUses } from './types'

const logger = createLogger('promos:store')
const codes = makeKvStore('promo-codes', 'promo-codes')
const usesKv = makeKvStore('promo-uses', 'promo-uses')
const codeKey = (code: string) => `code-${code}`
const usesKey = (code: string) => `uses-${code}`
const ATTEMPTS = 3
const RETRY = 'Concurrent update — please retry'
const HISTORY_CAP = 100

/** A save the owner can fix: `status` 400 (with `field`), 404 or 409. */
export class PromoSaveError extends Error {
  constructor(public status: number, message: string, public field?: string) {
    super(message)
    this.name = 'PromoSaveError'
  }
}

export async function getPromo(raw: string): Promise<PromoCode | null> {
  const code = normalizeCode(raw)
  if (!code) return null
  const json = await codes.get(codeKey(code))
  return json ? (JSON.parse(json) as PromoCode) : null
}

export async function getUses(raw: string): Promise<PromoUses | null> {
  const code = normalizeCode(raw)
  if (!code) return null
  const json = await usesKv.get(usesKey(code))
  return json ? (JSON.parse(json) as PromoUses) : null
}

/**
 * Every code, with how many bookings paid with it and how many are paying
 * with it right now (`payingNow`: holds still running, so "0 left" while
 * someone is at the pay step isn't a mystery).
 */
export async function listPromos(now = new Date()): Promise<(PromoCode & { usedCount: number; payingNow: number })[]> {
  const keys = (await codes.list()).filter((k) => k.startsWith('code-'))
  const all = await Promise.all(keys.map(async (k) => {
    const json = await codes.get(k)
    if (!json) return null
    const p = JSON.parse(json) as PromoCode
    const raw = await usesKv.get(usesKey(p.code))
    const u = raw ? (JSON.parse(raw) as PromoUses) : null
    const payingNow = (u?.holds ?? []).filter((h) => Date.parse(h.until) > now.getTime()).length
    return { ...p, usedCount: u ? u.used.length : 0, payingNow }
  }))
  return all.filter((p): p is PromoCode & { usedCount: number; payingNow: number } => !!p).sort((a, b) => a.code.localeCompare(b.code))
}

/** What an edit changed, in the owner's words. */
function changes(a: PromoFields, b: PromoFields): string[] {
  const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y)
  const out: string[] = []
  if (a.active !== b.active) out.push(b.active ? 'Turned it on' : 'Turned it off')
  if (!same(a.off, b.off)) out.push('Money off')
  if (a.per !== b.per) out.push('Each person or the whole booking')
  if (!same(a.appliesTo, b.appliesTo)) out.push('Classes')
  if (a.includeExtras !== b.includeExtras) out.push('Extras')
  if (a.endsYmd !== b.endsYmd) out.push('Last day')
  if (a.maxUses !== b.maxUses) out.push('Use limit')
  if (a.label !== b.label) out.push('Note')
  return out
}

const fieldsOf = (p: PromoCode): PromoFields => ({
  code: p.code, label: p.label, off: p.off, per: p.per, appliesTo: p.appliesTo,
  includeExtras: p.includeExtras, endsYmd: p.endsYmd, maxUses: p.maxUses, active: p.active,
})

/**
 * Create (expectedUpdatedAt null: create-only, "That code is taken." when it
 * exists) or edit (compare-and-swap on updatedAt). The code text never
 * changes: it is the key. A last day in the past is refused on create, and
 * on an edit that changes it.
 */
export async function savePromo(input: unknown, by: By, expectedUpdatedAt: string | null, now = new Date()): Promise<PromoCode> {
  assertClassWritesAllowed() // R41
  const today = chicagoYmd(now)
  const loose = validatePromo(input)
  if (!loose.ok) throw new PromoSaveError(400, loose.error, loose.field)
  const k = codeKey(loose.value.code)
  const at = now.toISOString()

  if (expectedUpdatedAt === null) {
    const checked = validatePromo(input, { todayYmd: today })
    if (!checked.ok) throw new PromoSaveError(400, checked.error, checked.field)
    const p: PromoCode = { ...checked.value, createdAt: at, updatedAt: at, by, history: [{ at, by, change: 'Made the code' }] }
    if (!(await codes.setIfMatch(k, JSON.stringify(p), null, false))) throw new PromoSaveError(409, 'That code is taken.', 'code')
    return p
  }

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const { value, etag } = await codes.getWithMeta(k)
    if (!value) throw new PromoSaveError(404, 'That code is gone. Reload and try again.')
    const cur = JSON.parse(value) as PromoCode
    if (cur.updatedAt !== expectedUpdatedAt) throw new PromoSaveError(409, 'Someone changed this code just now. Reload to see it, then try again.')
    let next = loose.value
    if (next.endsYmd !== cur.endsYmd) {
      const checked = validatePromo(input, { todayYmd: today })
      if (!checked.ok) throw new PromoSaveError(400, checked.error, checked.field)
      next = checked.value
    }
    const what = changes(fieldsOf(cur), next)
    if (!what.length) return cur
    const stamp = at > cur.updatedAt ? at : new Date(Date.parse(cur.updatedAt) + 1).toISOString()
    const saved: PromoCode = {
      ...next, createdAt: cur.createdAt, updatedAt: stamp, by,
      history: [...cur.history, { at: stamp, by, change: what.join(' · ') }].slice(-HISTORY_CAP),
    }
    if (await codes.setIfMatch(k, JSON.stringify(saved), etag, true)) return saved
  }
  throw new Error(RETRY)
}

/** Read-modify-write of a code's uses by compare-and-swap. `fn` returns the next doc (null = write nothing) and a result. */
async function mutateUses<T>(raw: string, fn: (cur: PromoUses) => { next: PromoUses | null; result: T }): Promise<T> {
  assertClassWritesAllowed() // R41
  const code = normalizeCode(raw)
  if (!code) throw new Error('That code is not readable.')
  const k = usesKey(code)
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const { value, etag } = await usesKv.getWithMeta(k)
    const cur: PromoUses = value ? JSON.parse(value) : { code, used: [], holds: [] }
    const { next, result } = fn(cur)
    if (!next) return result
    if (await usesKv.setIfMatch(k, JSON.stringify(next), etag, value !== null)) return result
  }
  throw new Error(RETRY)
}

/**
 * Reserve a use for a booking until `untilIso` (its seat hold's end). Counts
 * paid uses and holds still running; the same booking asking again is ok
 * (its hold is kept, never doubled). Throws when the store can't be written
 * (fail closed: nothing is charged).
 */
export async function reserveUse(code: string, bookingId: string, untilIso: string, now: Date, maxUses: number | null): Promise<'ok' | 'used-up'> {
  return mutateUses(code, (cur) => {
    if (cur.used.some((u) => u.bookingId === bookingId)) return { next: null, result: 'ok' as const }
    const live = cur.holds.filter((h) => Date.parse(h.until) > now.getTime())
    const mine = live.find((h) => h.bookingId === bookingId)
    if (mine) {
      if (Date.parse(untilIso) <= Date.parse(mine.until)) return { next: null, result: 'ok' as const }
      return { next: { ...cur, holds: live.map((h) => (h === mine ? { ...h, until: untilIso } : h)) }, result: 'ok' as const }
    }
    if (maxUses !== null && cur.used.length + live.length >= maxUses) return { next: null, result: 'used-up' as const }
    return { next: { ...cur, holds: [...live, { bookingId, until: untilIso }] }, result: 'ok' as const }
  })
}

/** Paid: the hold becomes a use. Safe to call again. Recorded even if the hold ran out (the money is taken); never again once given back. */
export async function confirmUse(code: string, bookingId: string, classId: string, now = new Date()): Promise<void> {
  await mutateUses(code, (cur) => {
    const holds = cur.holds.filter((h) => h.bookingId !== bookingId)
    // Counted already, or an owner gave this booking's use back (a replayed payment notice never takes it again).
    if (cur.used.some((u) => u.bookingId === bookingId) || (cur.givenBack ?? []).some((g) => g.bookingId === bookingId)) {
      return { next: holds.length === cur.holds.length ? null : { ...cur, holds }, result: undefined }
    }
    return { next: { ...cur, holds, used: [...cur.used, { bookingId, at: now.toISOString(), classId }] }, result: undefined }
  })
}

/**
 * Paid seats confirmed (by the request itself, Square's payment notice, the
 * nightly catch-up, or an owner's "Give them their seat"): the booking's use
 * of the code is counted, exactly once (confirmUse is safe to repeat; the
 * reservation is keyed by the booking id). Tried twice; if it still fails
 * the owners get a text, since a limited code could then go one over.
 * Never throws.
 */
export async function countUse(code: string, bookingId: string, cls: { id: string; name: string }, now = new Date()): Promise<boolean> {
  for (let i = 0; i < 2; i++) {
    try {
      await confirmUse(code, bookingId, cls.id, now)
      return true
    } catch (err) {
      if (i === 1) {
        logger.error('PROMO USE NOT RECORDED on a paid booking', { bookingId, code, error: String(err) })
        await alertOwners(`Code ${code} was used on a paid booking (${bookingId}, ${cls.name}) but the use wasn't counted. If it has a use limit, it may go one over.`).catch(() => undefined)
      }
    }
  }
  return false
}

/** A booking that didn't go through lets go of its hold. A paid use is never taken back. */
export async function releaseUse(code: string, bookingId: string): Promise<void> {
  await mutateUses(code, (cur) => {
    const holds = cur.holds.filter((h) => h.bookingId !== bookingId)
    return { next: holds.length === cur.holds.length ? null : { ...cur, holds }, result: undefined }
  })
}

/** No answer from Square (R15): keep the booking's hold until `untilIso`, so the use stays its own. */
export async function extendUse(code: string, bookingId: string, untilIso: string): Promise<void> {
  await mutateUses(code, (cur) => {
    if (cur.used.some((u) => u.bookingId === bookingId)) return { next: null, result: undefined }
    const others = cur.holds.filter((h) => h.bookingId !== bookingId)
    return { next: { ...cur, holds: [...others, { bookingId, until: untilIso }] }, result: undefined }
  })
}

/**
 * M8: an owner gives one booking's use back (a one-use personal code whose
 * booking was cancelled). The use is moved to `givenBack`, so the code works
 * once more. false when that booking never used the code (nothing changed).
 * Never called by a refund: only by an owner's tap (Task 6).
 */
export async function giveUseBack(code: string, bookingId: string, by: By, now = new Date()): Promise<boolean> {
  return mutateUses(code, (cur) => {
    const use = cur.used.find((u) => u.bookingId === bookingId)
    if (!use) return { next: null, result: false }
    return {
      next: {
        ...cur,
        used: cur.used.filter((u) => u !== use),
        givenBack: [...(cur.givenBack ?? []), { bookingId, at: now.toISOString(), by, classId: use.classId }],
      },
      result: true,
    }
  })
}
