/**
 * Promo code rules: the code's spelling, what an owner may save, and whether
 * a code works on a class right now. Pure and browser-safe.
 */
import { formatMoney } from '@lib/money'
import { chicagoYmd, isYmd, onOrBeforeDay, shortDay } from '@lib/classes/chicago-day'
import type { ScheduledClass } from '@lib/classes/types'
import type { Result } from '@lib/classes/validate'
import type { PromoCode, PromoFields, PromoUses } from './types'

const CODE_RE = /^[A-Z0-9]{3,20}$/
const MIN_AMOUNT_CENTS = 50
const MAX_AMOUNT_CENTS = 100_000
const MAX_LABEL = 80
const MAX_USES = 100_000

/** What a customer reads when a code doesn't work. Unknown and turned-off codes read the same. */
export const PROMO_REFUSALS = {
  invalid: "That code isn't valid.",
  ended: 'That code has ended.',
  usedUp: 'That code has been used up.',
  notThisClass: "That code isn't for this class.",
} as const

/** "fall friends" → "FALLFRIENDS"; null when it isn't 3–20 letters or numbers. */
export function normalizeCode(raw: string): string | null {
  if (typeof raw !== 'string') return null
  const c = raw.replace(/\s+/g, '').toUpperCase()
  return CODE_RE.test(c) ? c : null
}

const fail = <T>(error: string, field: string): Result<T> => ({ ok: false, error, field })
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const ids = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()))] : [])

/**
 * What an owner saves, checked. `todayYmd` (Chicago) refuses a last day in
 * the past: pass it on create, and on an edit that changes the last day.
 */
export function validatePromo(raw: unknown, opts: { todayYmd?: string } = {}): Result<PromoFields> {
  if (!isObj(raw)) return fail('The code is not readable.', 'code')
  const code = normalizeCode(raw.code)
  if (!code) return fail('A code is 3 to 20 letters or numbers, with no spaces or symbols.', 'code')
  const label = typeof raw.label === 'string' ? raw.label.trim() : ''
  if (label.length > MAX_LABEL) return fail(`The note can be up to ${MAX_LABEL} characters.`, 'label')

  const o = raw.off
  let off: PromoFields['off']
  if (isObj(o) && o.kind === 'percent') {
    if (!Number.isInteger(o.percent) || o.percent < 1 || o.percent > 100) return fail('Percent off is a whole number from 1 to 100.', 'off')
    off = { kind: 'percent', percent: o.percent }
  } else if (isObj(o) && o.kind === 'amount') {
    if (!Number.isInteger(o.cents) || o.cents < MIN_AMOUNT_CENTS) return fail('Take off at least $0.50.', 'off')
    if (o.cents > MAX_AMOUNT_CENTS) return fail('Take off up to $1,000.', 'off')
    off = { kind: 'amount', cents: o.cents }
  } else {
    return fail('Choose dollars or percent off.', 'off')
  }
  // A percent comes off each line as it is; only a dollar amount needs "each person or the whole booking".
  const per: PromoFields['per'] = off.kind === 'amount' && raw.per === 'seat' ? 'seat' : 'booking'

  const a = raw.appliesTo
  let appliesTo: PromoFields['appliesTo']
  if (a === undefined || (isObj(a) && a.kind === 'all')) {
    appliesTo = { kind: 'all' }
  } else if (isObj(a) && a.kind === 'classes') {
    const libraryIds = ids(a.libraryIds), classIds = ids(a.classIds)
    if (!libraryIds.length && !classIds.length) return fail('Pick at least one class, or choose Everything.', 'appliesTo')
    appliesTo = { kind: 'classes', libraryIds, classIds }
  } else {
    return fail('Choose Everything or pick classes.', 'appliesTo')
  }

  let endsYmd: string | null = null
  if (raw.endsYmd !== undefined && raw.endsYmd !== null && raw.endsYmd !== '') {
    if (!isYmd(raw.endsYmd)) return fail('Pick a last day from the calendar.', 'endsYmd')
    if (opts.todayYmd && raw.endsYmd < opts.todayYmd) return fail("The last day can't be in the past.", 'endsYmd')
    endsYmd = raw.endsYmd
  }

  let maxUses: number | null = null
  if (raw.maxUses !== undefined && raw.maxUses !== null && raw.maxUses !== '') {
    if (!Number.isInteger(raw.maxUses) || raw.maxUses < 1 || raw.maxUses > MAX_USES) return fail('The use limit is a whole number of 1 or more.', 'maxUses')
    maxUses = raw.maxUses
  }

  return {
    ok: true,
    value: {
      code, label, off, per, appliesTo,
      // M5 (stage 1): only a real yes is yes.
      includeExtras: raw.includeExtras === true,
      endsYmd, maxUses,
      active: raw.active === undefined ? true : raw.active === true,
    },
  }
}

/** Is this class one the code is for? A library id covers every date of that class. */
export function promoCoversClass(p: Pick<PromoCode, 'appliesTo'>, cls: Pick<ScheduledClass, 'id' | 'libraryId'>): boolean {
  if (p.appliesTo.kind === 'all') return true
  return p.appliesTo.classIds.includes(cls.id) || (!!cls.libraryId && p.appliesTo.libraryIds.includes(cls.libraryId))
}

/**
 * Uses left: the limit minus paid uses and holds still running (null = no
 * limit). `forBookingId`'s own hold doesn't count against it.
 */
export function usesLeft(p: Pick<PromoCode, 'maxUses'>, uses: PromoUses | null, now: Date, forBookingId?: string): number | null {
  if (p.maxUses === null) return null
  const used = uses?.used.length ?? 0
  const held = (uses?.holds ?? []).filter((h) => h.bookingId !== forBookingId && Date.parse(h.until) > now.getTime()).length
  return Math.max(0, p.maxUses - used - held)
}

/** null when the code works on this class now; otherwise the sentence the customer reads. */
export function promoRefusal(p: PromoCode | null, cls: Pick<ScheduledClass, 'id' | 'libraryId'>, now: Date, left: number | null): string | null {
  if (!p || !p.active) return PROMO_REFUSALS.invalid
  if (p.endsYmd && !onOrBeforeDay(p.endsYmd, now)) return PROMO_REFUSALS.ended
  if (!promoCoversClass(p, cls)) return PROMO_REFUSALS.notThisClass
  if (left !== null && left <= 0) return PROMO_REFUSALS.usedUp
  return null
}

/** The owner's one-line summary: "10% off · every class · ends Mon Nov 30". */
export function describePromo(p: Pick<PromoCode, 'off' | 'per' | 'appliesTo' | 'includeExtras' | 'endsYmd'>): string {
  const off = p.off.kind === 'percent'
    ? `${p.off.percent}% off`
    : `${formatMoney(p.off.cents)} off ${p.per === 'seat' ? 'each person' : 'the booking'}`
  const n = p.appliesTo.kind === 'classes' ? p.appliesTo.libraryIds.length + p.appliesTo.classIds.length : 0
  const forWhat = p.appliesTo.kind === 'all' ? 'every class' : `${n} class${n === 1 ? '' : 'es'}`
  return [off, forWhat, p.includeExtras ? 'extras too' : '', p.endsYmd ? `ends ${shortDay(p.endsYmd)}` : ''].filter(Boolean).join(' · ')
}

/** Today in Chicago, for the "not in the past" check on save. */
export const promoToday = (now: Date) => chicagoYmd(now)
