/**
 * The owners' Activity log (/admin › More › Activity, DV19): the audit log in
 * plain words, filterable by person, area and how far back. Owners only: the
 * entries name customers, refund reasons, gift-card recipients and the
 * addresses of refused sign-ins (crew used to be able to read them at
 * /api/staff/audit.json, which is gone).
 *
 * Client-safe: no imports beyond types.
 */
import type { AuditEntry } from '@lib/audit'

export const ACTIVITY_AREAS = ['money', 'door', 'staffing', 'setup'] as const
export type ActivityArea = (typeof ACTIVITY_AREAS)[number]

export const AREA_LABEL: Record<ActivityArea, string> = {
  money: 'Money: refunds, comps, gift cards, sales',
  door: 'At the door: check-ins, pickups, waivers',
  staffing: 'Staff: sign-ins, shifts, availability',
  setup: 'Setup and everything else',
}

/** Which area an audited action belongs to. */
export function areaOf(action: string): ActivityArea {
  const a = action.toLowerCase()
  if (/refund|gift-card|comped|sold|seat\.reader|take-card|party-card|paid-elsewhere|paid-not-seated|free-seat|forfeit|waitlist-run/.test(a)) return 'money'
  if (/checkin|pickup|custody|waiver|rsvp|incident|reissue-code|code-sent/.test(a)) return 'door'
  if (/^staff|staffing|feed\.|availability|assign|^ask$|unask/.test(a)) return 'staffing'
  return 'setup'
}

const money = (cents: unknown) => (typeof cents === 'number' && Number.isFinite(cents) ? `$${(cents / 100).toFixed(2)}` : '')
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

/** What happened, in plain words, without the person (shown next to it). */
export function activityWhat(e: Pick<AuditEntry, 'action' | 'target' | 'details'>): string {
  const d = e.details ?? {}
  const label = str(e.target?.label)
  const reason = str(d.reason)
  const withReason = (s: string) => (reason ? `${s}: “${reason}”` : s)
  switch (e.action) {
    case 'class-refund': return withReason(`Refunded ${money(d.cents)} on ${label || 'a class'}`)
    case 'party-refund': return withReason(`Refunded ${money(d.cents)} on ${label || 'a party'}`)
    case 'seat.reader-refund': return withReason(`Refunded a reader payment of ${money(d.cents)}${label ? ` (${label})` : ''}`)
    case 'class-paid-not-seated-refund': case 'party-paid-elsewhere-refund': return withReason(`Refunded ${money(d.cents)}${label ? ` (${label})` : ''}`)
    case 'class-free-seat': return withReason(`Freed a seat on ${label || 'a class'} (no refund)`)
    case 'seat.comped': {
      const seats = typeof d.seats === 'number' ? d.seats : 1
      const who = str(d.name)
      return withReason(`Comped ${seats === 1 ? 'a seat' : `${seats} seats`}${who ? ` for ${who}` : ''} on ${label || 'a class'}`)
    }
    case 'seat.sold-at-door': {
      const who = str(d.name)
      return `Sold a seat at the door${who ? ` to ${who}` : ''} on ${label || 'a class'}${money(d.dueCents) ? ` (${money(d.dueCents)} at the register)` : ''}`
    }
    case 'gift-card.minted': return `Made a ${money(d.amountCents)} gift card for ${str(d.forWhom) || label || 'someone'}${str(d.note) ? `: “${str(d.note)}”` : ''}`
    case 'event.settings':
      if (d.dropOff === false) return `Turned drop-off off for ${label || 'an event'} (kids leave without a pickup code)`
      if (d.dropOff === true) return `Turned drop-off on for ${label || 'an event'}`
      return `Changed the settings of ${label || 'an event'}`
    case 'checkin.here':
      if (d.where === 'craft-cafe') return `Checked ${label || 'a family'} in at Craft Café${typeof d.people === 'number' ? ` (${d.people} ${d.people === 1 ? 'person' : 'people'})` : ''}`
      return label ? `Checkin here: ${label}` : 'Checkin here'
    case 'checkin.undone':
      if (d.where === 'craft-cafe') return `Took ${label || 'a family'} off the Craft Café list (Undo)`
      return label ? `Checkin undone: ${label}` : 'Checkin undone'
    case 'waiver.started': return `Started ${label || 'a new family'} on a waiver at Craft Café (${d.how === 'qr' ? 'QR code' : 'on the iPad'})`
    case 'waiver.waiting-removed': return `Took ${label || 'a family'} off “Waiting on a waiver”`
    case 'staff.switched': return `Switched person (${label})`
    case 'staff.signed-in': return 'Signed in to /staff'
    case 'staff.login-refused': return 'Wrong staff passcode'
    default: {
      const words = e.action.replace(/[._-]+/g, ' ').trim()
      const head = words ? words[0].toUpperCase() + words.slice(1) : 'Did something'
      return label ? `${head}: ${label}` : head
    }
  }
}

export interface ActivityRow {
  id: string
  at: string
  who: string
  role: 'owner' | 'crew' | 'customer'
  byId: string
  area: ActivityArea
  what: string
  action: string
}

export function toActivityRow(e: AuditEntry): ActivityRow {
  return {
    id: e.id, at: e.at, who: e.by?.name ?? 'Someone', role: e.by?.role === 'owner' || e.by?.role === 'customer' ? e.by.role : 'crew', byId: e.by?.id ?? '',
    area: areaOf(e.action), what: activityWhat(e), action: e.action,
  }
}
