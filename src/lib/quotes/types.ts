/**
 * Private event quotes (Kaden, 17 Nov 2026): owners turn a private-event
 * request into up to three packages on an invitation-style page; the customer
 * pays a deposit and it becomes a booked party of ours.
 * Spec: docs/plans/2026-11-17-event-value-quote-spec.md
 *
 * Shared by server and browser code: no node imports here.
 */
export type Per = 'person' | 'event'

/** One thing a package can hold: a Square catalog variation or an owner's own item (e.g. Travel). */
export interface MenuItem {
  id: string
  source: 'square' | 'own'
  squareItemId?: string
  squareVariationId?: string
  name: string
  photoUrl: string | null
  /** Normal price, per person or per event. */
  cents: number
  per: Per
  /** Material cost. Owners only; null when unknown. */
  costCents: number | null
  tags: string[]
  hidden: boolean
  /** Gone from Square on the last complete sync. */
  gone?: boolean
  updatedAt: string
}

/** A line in a package: a snapshot, so later menu edits don't change a sent quote. */
export interface QuoteLine {
  itemId: string | null
  label: string
  photoUrl: string | null
  cents: number
  per: Per
  costCents: number | null
}

export type TierKey = 'simple' | 'pick' | 'all' | 'custom'

export interface Tier {
  id: string
  key: TierKey
  name: string
  photoUrl: string | null
  hidden: boolean
  lines: QuoteLine[]
  /** The customer's price per person. */
  priceCents: number
}

export interface SavedPackage {
  id: string
  name: string
  photoUrl: string | null
  lines: QuoteLine[]
  savedAt: string
  by: string
}

export interface QuoteSettings {
  capPct: number
  yellowFromPct: number
  depositPct: number
  expiryDays: number
  updatedAt: string
}

export const DEFAULT_SETTINGS: QuoteSettings = { capPct: 25, yellowFromPct: 20, depositPct: 50, expiryDays: 14, updatedAt: '' }

export type Crafters = 'kids' | 'adults' | 'both'
export type QuoteStatus = 'draft' | 'sent' | 'picked' | 'paying' | 'paid' | 'withdrawn'

export interface QuoteHistory { at: string; by: string; what: string }

export interface Quote {
  id: string
  requestId: string
  /** The party this quote becomes; holds sit under it from Send. */
  partyId: string
  token: string
  version: number
  priceKey: string
  status: QuoteStatus
  place: 'studio' | 'away'
  address: string
  startIso: string | null
  endIso: string | null
  guests: number
  crafters: Crafters
  targetCents: number
  note: string
  depositPct: number
  expiresAt: string
  tiers: Tier[]
  held: boolean
  sentAt?: string
  sentBy?: string
  updatedAt?: string
  views: number
  lastViewedAt?: string
  pickedTierId?: string
  paying?: { attemptId: string; at: string }
  paidAt?: string
  expiryTold?: boolean
  history: QuoteHistory[]
}

export type Meter = 'green' | 'yellow' | 'red'

/** The middle of each budget answer on the private-events form. */
export const BUDGET_MIDPOINT_CENTS: Record<string, number> = { 'under-1000': 50000, '1000-2500': 175000, '2500-plus': 300000 }
export const TIER_FACTORS = { simple: 0.8, pick: 1, all: 1.3 } as const
export const TIER_NAMES = { simple: 'Simple', pick: 'Our pick', all: 'All out' } as const

/** True when a sent or picked quote is past its expiry. */
export function isExpired(q: Pick<Quote, 'status' | 'expiresAt'>, now: Date = new Date()): boolean {
  return (q.status === 'sent' || q.status === 'picked') && now.getTime() >= Date.parse(q.expiresAt)
}
