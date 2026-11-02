/**
 * Promo codes (stage 4). A code takes money off class seats: a dollar amount
 * or a whole percent, on every class or on chosen ones, until a last day,
 * up to a number of bookings.
 *
 * Browser-safe: types only.
 */
import type { By } from '@lib/staff-auth'

export type PromoOff = { kind: 'amount'; cents: number } | { kind: 'percent'; percent: number }
export type PromoAppliesTo = { kind: 'all' } | { kind: 'classes'; libraryIds: string[]; classIds: string[] }

export interface PromoCode {
  /** A–Z 0–9, 3–20, stored upper case; unique; never renamed (it is the store key). */
  code: string
  /** The owner's own note, e.g. "Grand opening". Never shown to customers. */
  label: string
  off: PromoOff
  /** OWNER-S4-6: a $ code comes off the whole booking or each person. A % code is always per line ('booking' stored). */
  per: 'booking' | 'seat'
  /** A library class covers every date of it; a class id covers only that date. */
  appliesTo: PromoAppliesTo
  /** OWNER-S4-5: take money off extras (add-ons) too. Default false. */
  includeExtras: boolean
  /** The last Chicago day it works (all of that day); null = no end. */
  endsYmd: string | null
  /** Whole bookings; null = no limit. */
  maxUses: number | null
  active: boolean
  createdAt: string
  updatedAt: string
  by: By
  history: { at: string; by: By; change: string }[]
}

/** What the owner fills in. */
export type PromoFields = Omit<PromoCode, 'createdAt' | 'updatedAt' | 'by' | 'history'>

/**
 * Uses of one code. `used`: bookings that paid with it (a refund never gives
 * a use back by itself). `holds`: bookings paying right now; a hold counts
 * until it runs out, so two buyers can't both take the last use.
 * `givenBack`: uses an owner gave back (M8), kept so the history adds up.
 */
export interface PromoUses {
  code: string
  used: { bookingId: string; at: string; classId: string }[]
  holds: { bookingId: string; until: string }[]
  givenBack?: { bookingId: string; at: string; by: By; classId: string }[]
}
