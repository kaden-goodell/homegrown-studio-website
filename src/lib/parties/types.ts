/**
 * Party settings the owners edit in /admin › Parties setup: when parties can
 * start, the packages, and the extras. Until an owner first saves, the config
 * (src/config/party.config.ts) is used as these settings
 * (configPartySettings() in ./party-times.ts).
 *
 * Client-safe: types only.
 */
import type { By } from '../staff-auth'

export type Cents = number

export interface PartyPackage {
  /** 'pkg_whole' for the one from config; new ones 'pkg_…'. Booked parties keep the id. */
  id: string
  /** 'Whole studio' */
  name: string
  priceCents: Cents
  /** Party length, without cleanup. */
  minutes: number
  minGuests: number
  maxGuests: number
  defaultGuests: number
  quickPicks: number[]
  /** link = bookable online only by /book?package=<id> (the test package); admin = only from /admin. */
  who: 'everyone' | 'link' | 'admin'
  archived: boolean
}

export interface PartyAddOn {
  id: string
  label: string
  priceCents: Cents
  /** goodie bags are per guest */
  per: 'party' | 'guest'
  extraMinutes: 0 | 15 | 30 | 45 | 60
  /** per party; 1 for extra time */
  maxQty: number
  /** offered on /book; always offered on /admin */
  online: boolean
  archived: boolean
}

export type WeekdayKey = '0' | '1' | '2' | '3' | '4' | '5' | '6'

export interface PartyTimes {
  /** Studio-local 'HH:MM' starts per weekday (0 = Sunday). */
  weekly: Record<WeekdayKey, string[]>
  /** 'YYYY-MM-DD' → starts replacing that weekday; [] = no parties; may precede opensDate. */
  dates: Record<string, string[]>
  bookingWindowDays: number
  minLeadDays: number
  /** First day parties can be booked online (a dated day before it is still offered). */
  opensDate: string
}

export interface PartySettingsInput {
  times: PartyTimes
  packages: PartyPackage[]
  addOns: PartyAddOn[]
  /** Read parties booked in Square (legacy) as taking their times. */
  readSquareBookings: boolean
}

export interface PartySettingsChange {
  at: string
  by: By
  changed: string[]
  before: PartySettingsInput
}

export interface PartySettings extends PartySettingsInput {
  /** null = never saved (config in use) */
  updatedAt: string | null
  by: By | null
  /** newest first, capped at 50 */
  history: PartySettingsChange[]
}
