// Class domain types (own booking system, stage 1).
export type Cents = number
export interface TicketType { id: string; label: string }            // default [{id:'person',label:'Person'}]
export type PassCovers =
  | { kind: 'all' }                       // full series
  | { kind: 'choose'; count: number }     // buyer picks N sessions
  | { kind: 'fixed'; sessionIds: string[] } // e.g. weekend
  | { kind: 'remaining' }                 // join partway: every session not yet started at purchase
export interface Pass { id: string; label: string; covers: PassCovers }
export interface SeatQuestion { id: string; label: string; choices: string[] }
export interface AddOn { id: string; label: string; priceCents: Cents; maxPerSeat: number }
export interface Session { id: string; startIso: string; endIso: string; capacity: number }
export interface ClassRules {
  ages: string            // free text shown on card, '' = none
  dropOff: boolean
  madeToOrder: boolean
  taxable: boolean        // default true
  maxPerBooking: number   // default 10
  signupCutoffHours: number | null // null = default (0, or 24 when madeToOrder or questions)
  minimumToRun: { count: number; decideByIso: string } | null
  linkOnly: boolean
  joinPartway: boolean    // when false, a 'remaining' pass is never offered once the first session starts
  waitlistCutoffHours: number // default 2 (stage 4 uses it)
  canShareRoom: boolean   // allows overlap with another class
}
export interface ClassContent {
  name: string
  description: string     // paragraphs separated by blank lines
  imageUrl: string | null
  instructor: string | null // null/'' shows nothing
  rules: ClassRules
  ticketTypes: TicketType[]
  passes: Pass[]
  /** prices[passId][ticketTypeId] = cents; a missing cell is not sold. */
  prices: Record<string, Record<string, Cents>>
  questions: SeatQuestion[]
  addOns: AddOn[]
  defaultCapacity: number
  defaultMinutes: number
}
/** `changed`: what this version changed from the one before, in the owner's words ("Price", "Description"); absent on old versions. */
export interface LibraryVersion { version: number; at: string; by: { id: string; name: string }; content: ClassContent; note: string; changed?: string[] }
export interface LibraryClass { id: string; archived: boolean; versions: LibraryVersion[] } // versions newest last
export type ClassStatus = 'draft' | 'open' | 'closed' | 'cancelled'
export interface ScheduledClass {
  id: string                 // 'cls_' + 10 base36
  libraryId: string | null
  libraryVersion: number | null
  content: ClassContent      // the editable copy
  sessions: Session[]        // sorted by startIso
  status: ClassStatus
  /** POS item. variations key `${passId}:${ticketTypeId}` (seats) or `addon:${addOnId}` → variation id.
   *  imageUrl = the class image last uploaded to Square (re-uploaded only when it changes). */
  square: { itemId: string | null; variations: Record<string, string>; imageUrl?: string | null }
  createdAt: string
  updatedAt: string
  by: { id: string; name: string }
  history: { at: string; by: { id: string; name: string }; change: string }[] // capped at 100
}
