import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { agesLabel } from '@lib/workshop-copy'
import { checkoutPolicySummary, POLICY_PATH, POLICY_ANCHORS } from '@config/policy-content'
import { STUDIO_ADDRESS, STUDIO_ADDRESS_LINE, STUDIO_DIRECTIONS_URL } from '@config/studio-address'
import { attemptIdFor, forgetPendingAttempt, newAttemptId, pendingAttempt, rememberPendingAttempt } from '@lib/checkout-attempt'
import { messageForFailure, outcomeUnknown, workshopMessages, UNKNOWN_OUTCOME_MESSAGE } from '@lib/checkout-messages'
import { contactStarted, EMPTY_CONTACT, type Contact } from '@lib/contact-rules'
import { rememberContact, rememberedContact } from '@lib/remembered-contact'
import { formatMoney } from '@lib/money'
import { googleCalendarUrl, buildIcs, icsDataUrl } from '@lib/party-share'
import { workshopRefundLine } from '@lib/refund-lines'
import { formatDayAndSpan } from '@lib/studio-time'
import { seatsLeftLabel } from '@lib/workshop-rules'
import { quote, type BookingRequest, type Quote } from '@lib/classes/pricing'
import { asScheduledClass, currentPriceCents, type OwnClassData, type PublicPass } from '@lib/classes/public-class'
import { openQuestions } from '@lib/classes/questions-close'
import { shortDay } from '@lib/classes/chicago-day'
import type { WorkshopData } from '@components/workshops/WorkshopExplorer'
import BookingPanel, { PAYMENT_GOING_THROUGH } from '@components/shared/BookingPanel'
import EmailMeThisClass from '@components/workshops/EmailMeThisClass'
import { pluralWord } from '@lib/ticket-types'
import BookingConfirmed, { ConfirmedBlock } from '@components/shared/BookingConfirmed'
import ContactFields, { type ContactFieldsHandle } from '@components/shared/ContactFields'
import PaymentForm from '@components/checkout/PaymentForm'
import type { PaymentFormRef } from '@components/checkout/PaymentForm'
import {
  trackWizardStarted,
  trackWizardStepCompleted,
  trackPaymentStarted,
  trackPaymentCompleted,
  trackPaymentFailed,
  trackBookingCompleted,
  trackWorkshopSeatBooked,
  trackViewItem,
  trackBeginCheckout,
  trackAddPaymentInfo,
  trackBookingAbandoned,
  trackBookingProblem,
  type AnalyticsItem,
  posthogId,
  identifyBooker,
  trackAddToCalendar,
  trackWaiverLinkClick,
} from '@lib/analytics'
import { readAttribution } from '@lib/attribution'
import { consentText, joinedLine, WAITLIST_MESSAGES, WAITLIST_NOTHING_NOW, waitlistPriceLine, waitlistReason } from '@lib/classes/waitlist-words'

export interface ClassBookingPanelProps {
  /** A list row for one of our own classes (`own` set). */
  workshop: WorkshopData & { own?: OwnClassData }
  onClose: () => void
  /** Once booked: the sessions and the seats bought, so the list can show what is left. */
  onBooked?: (sessionIds: string[], seats: number) => void
  /** Fresh seat counts from the server (after a "sold out" answer): the parent swaps them in. */
  onAvailability?: (own: OwnClassData) => void
  /** Keep ?w=<id> in the address while open (the /workshops list). Off on /classes/<id>. */
  syncUrl?: boolean
  /**
   * "Pay on the iPad" at the door (/staff Sell a seat): the same checkout,
   * run on the studio iPad. A session stays open until it ends, seats are
   * recorded as door seats by the signed-in crew member, and nothing about
   * the last customer is remembered on the shared iPad.
   */
  door?: boolean
  /** Door mode: the roster's day, picked to start with on a pick-your-days option. */
  initialSessionId?: string
  /** Door mode: Back on the first step returns to "How are they paying?". */
  onExit?: () => void
}

type Step = 'details' | 'seats' | 'pay'
const STEP_NAMES: Record<Step, string> = { details: 'Details', seats: 'For each person', pay: 'Your details and payment' }
/** Stage 4: the last step when they're joining the waitlist instead of paying. */
const WAITLIST_STEP_NAME = 'Your details and card'
const POLICY_UNTICKED = 'Tick the box to agree to the booking and cancellation policy.'
/** While the card is being saved for the waitlist (nothing charged). */
const SAVING_CARD = { title: 'Saving your card', body: 'Stay on this page. It only takes a moment.' }
/** C2: an earlier payment for this class from this tab never got a clear answer. */
const EARLIER_PENDING = 'Your last payment for this class may still be going through. Check your email for a receipt before you pay again.'
const visuallyHidden = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' } as const

/** What the server says about a class booking it couldn't finish; its own sentence wins. */
const CLASS_MESSAGES = {
  ...workshopMessages,
  already_booked: 'You already have a seat in this class. Check your email for the confirmation.',
  not_open: 'This class isn’t open for booking. Nothing was charged.',
}

/** The quote takes an early-bird off somewhere. */
const hasEarlyBird = (q: Quote | null): boolean => !!q?.lines.some((l) => l.discounts?.some((d) => d.kind === 'early-bird'))

/** Discounts on a quote, added up by name in the order they first come off: "Early-bird", then "Code FALLFRIENDS". */
function discountRows(q: Quote): { name: string; kind: 'early-bird' | 'promo' | 'waitlist'; cents: number }[] {
  const rows: { name: string; kind: 'early-bird' | 'promo' | 'waitlist'; cents: number }[] = []
  for (const l of q.lines) {
    for (const d of l.discounts ?? []) {
      const row = rows.find((r) => r.name === d.name)
      if (row) row.cents += d.cents
      else rows.push({ name: d.name, kind: d.kind, cents: d.cents })
    }
  }
  return rows.filter((r) => r.cents > 0).sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'early-bird' ? -1 : 1))
}

const linkButton = {
  background: 'none', border: 0, padding: '0.25rem 0', minHeight: '2.75rem', font: 'inherit', fontSize: '0.9375rem',
  fontWeight: 600, color: 'var(--color-primary)', textDecoration: 'underline', cursor: 'pointer',
} as const

type SeatInfo = { answers: Record<string, string>; addOns: Record<string, number> }
const EMPTY_SEAT: SeatInfo = { answers: {}, addOns: {} }

const plural = (n: number, word: string) => `${n} ${n === 1 ? word : `${word}s`}`

const counterButton = {
  width: '2.75rem',
  height: '2.75rem',
  borderRadius: '0.75rem',
  border: '1.5px solid var(--color-field-border)',
  background: 'var(--color-surface)',
  fontSize: '1.375rem',
  lineHeight: 1,
  color: 'var(--color-dark)',
  cursor: 'pointer',
} as const

const choiceButton = (on: boolean, enabled = true) =>
  ({
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '0.75rem',
    width: '100%',
    minHeight: '2.75rem',
    padding: '0.625rem 0.875rem',
    borderRadius: '0.75rem',
    border: `1.5px solid ${on ? 'var(--color-primary)' : 'var(--color-field-border)'}`,
    background: on ? 'rgba(var(--color-primary-rgb), 0.08)' : 'var(--color-surface)',
    color: 'var(--color-dark)',
    font: 'inherit',
    fontSize: '0.9375rem',
    textAlign: 'left',
    cursor: enabled ? 'pointer' : 'default',
    opacity: enabled ? 1 : 0.5,
  }) as const

const selectStyle = {
  width: '100%',
  minHeight: '2.75rem',
  padding: '0.5rem 0.75rem',
  borderRadius: '0.75rem',
  border: '1.5px solid var(--color-field-border)',
  background: 'var(--color-surface)',
  fontSize: '1rem',
  color: 'var(--color-dark)',
} as const

function Counter({ label, value, canLess, canMore, onLess, onMore, spoken }: {
  label: string; value: number; canLess: boolean; canMore: boolean; onLess: () => void; onMore: () => void; spoken: string
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
      <button type="button" aria-label={`Fewer ${label}`} onClick={onLess} disabled={!canLess} style={{ ...counterButton, opacity: canLess ? 1 : 0.35, cursor: canLess ? 'pointer' : 'default' }}>
        <span aria-hidden="true">&minus;</span>
      </button>
      <span aria-live="polite" aria-atomic="true" style={{ minWidth: '2rem', textAlign: 'center', fontSize: '1.25rem', fontWeight: 600, color: 'var(--color-dark)' }}>
        <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{spoken}</span>
        <span aria-hidden="true">{value}</span>
      </span>
      <button type="button" aria-label={`More ${label}`} onClick={onMore} disabled={!canMore} style={{ ...counterButton, opacity: canMore ? 1 : 0.35, cursor: canMore ? 'pointer' : 'default' }}>
        <span aria-hidden="true">+</span>
      </button>
    </div>
  )
}

/**
 * Booking one of our own classes: pass and days, then how many of each
 * ticket, then each person's picks and extras (when the class asks), then
 * contact and payment. One card token pays for the whole booking. The total
 * shown is worked out here with the same `quote` the server uses; the server
 * prices it again from the class and charges its own total.
 */

const LOUD = {
  trackWizardStarted,
  trackWizardStepCompleted,
  trackPaymentStarted,
  trackPaymentCompleted,
  trackPaymentFailed,
  trackBookingCompleted,
  trackWorkshopSeatBooked,
  trackViewItem,
  trackBeginCheckout,
  trackAddPaymentInfo,
  trackBookingAbandoned,
  trackBookingProblem,
  trackAddToCalendar,
  trackWaiverLinkClick,
  identifyBooker,
}
const SILENT: typeof LOUD = Object.fromEntries(Object.keys(LOUD).map((k) => [k, () => undefined])) as unknown as typeof LOUD

export default function ClassBookingPanel({ workshop, onClose, onBooked, onAvailability, syncUrl = true, door = false, initialSessionId, onExit }: ClassBookingPanelProps) {
  // Door sales on the studio iPad are not site visitors: no analytics from door mode.
  const tr = useMemo(() => (door ? SILENT : LOUD), [door])
  const own = workshop.own!
  const cls = useMemo(() => asScheduledClass(own, workshop.name), [own, workshop.name])
  const shownPasses = own.passes.filter((p) => p.state !== 'closed')
  // At the door a full option can still be picked: the crew decide to add over capacity.
  // Stage 4: online, a full option can still be picked when its waitlist is open (they join it instead of paying).
  const sessionWl = (id: string) => own.sessions.find((s) => s.id === id)?.waitlist
  const passWaitlistOpen = (p: PublicPass) => !door && (p.covers.kind === 'choose'
    ? own.sessions.some((s) => !s.closed && s.waitlist?.open)
    : !!p.sessionIds?.length && p.sessionIds.every((id) => sessionWl(id)?.open))
  const canBook = (p: PublicPass) => p.state === 'open' || (p.state === 'full' && (door || passWaitlistOpen(p)))
  const firstOpen = shownPasses.find((p) => p.state === 'open') ?? (door ? shownPasses.find(canBook) : undefined) ?? shownPasses[0] ?? own.passes[0]

  const [step, setStep] = useState<Step>('details')
  const [passId, setPassId] = useState<string>(firstOpen?.id ?? '')
  const pass = own.passes.find((p) => p.id === passId) as PublicPass
  const choose = pass?.covers.kind === 'choose' ? pass.covers.count : 0
  const [picked, setPicked] = useState<string[]>(() =>
    door && initialSessionId && firstOpen?.covers.kind === 'choose' && own.sessions.some((s) => s.id === initialSessionId && !s.closed) ? [initialSessionId] : [])
  /** Door mode: the crew chose to seat them on a full day. */
  const [over, setOver] = useState(false)
  const soldTypes = (id: string) => own.ticketTypes.filter((t) => own.prices[id]?.[t.id] !== undefined)
  const [counts, setCounts] = useState<Record<string, number>>(() => {
    const first = soldTypes(firstOpen?.id ?? '')[0]
    return first ? { [first.id]: 1 } : {}
  })
  // Each person's picks, kept per ticket type, so changing one count never moves answers between people.
  const [seatInfo, setSeatInfo] = useState<Record<string, SeatInfo[]>>({})
  const [problem, setProblem] = useState<string | null>(null)
  const [pickNote, setPickNote] = useState<string | null>(null)
  // The server couldn't say how the last try ended (or it is still running): no editing and paying again here.
  const [stuck, setStuck] = useState<string | null>(null)

  const [initialContact] = useState<Contact>(() => (door ? EMPTY_CONTACT : rememberedContact() ?? EMPTY_CONTACT))
  const [contact, setContact] = useState<Contact>(initialContact)
  const [agreedToPolicy, setAgreedToPolicy] = useState(false)
  const [policyProblem, setPolicyProblem] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [paymentReady, setPaymentReady] = useState(false)
  const [booked, setBooked] = useState<null | {
    bookingId: string | null; receiptUrl: string | null; emailSent: boolean; chargedCents: number | null; ticketsLabel: string | null; sessionIds: string[]
  }>(null)
  const [askToLeave, setAskToLeave] = useState(false)
  // Stage 4 waitlist: the consent tick, and the answer once they're on it.
  const [consented, setConsented] = useState(false)
  // I2: the server's amount and close time after it refused a stale consent (for this booking shape only).
  const [wlTerms, setWlTerms] = useState<{ shape: string; maxCents: number; closesIso: string } | null>(null)
  const [consentProblem, setConsentProblem] = useState(false)
  const [joined, setJoined] = useState<null | { position: number; last4: string; emailSent: boolean }>(null)
  const consentRef = useRef<HTMLInputElement>(null)
  const consentErrorId = useId()
  // Stage 4: a code, priced by the server for this exact booking (shape); and the server's own total after "the price changed".
  const [codeOpen, setCodeOpen] = useState(false)
  const [codeText, setCodeText] = useState('')
  const [codeError, setCodeError] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)
  const [applied, setApplied] = useState<null | { code: string; quote: Quote; shape: string }>(null)
  const [repriced, setRepriced] = useState<null | { quote: Quote; shape: string; code: string | null; note: string }>(null)
  const codeInputId = useId()
  const codeErrorId = useId()

  const paymentFormRef = useRef<PaymentFormRef>(null)
  const contactRef = useRef<ContactFieldsHandle>(null)
  const policyRef = useRef<HTMLInputElement>(null)
  const formId = useId()
  const policyErrorId = useId()

  const types = soldTypes(passId)
  // Seats in ticket type order, each type repeated by its count (the order `quote` uses).
  const seatTypes = own.ticketTypes.flatMap((t) => Array.from({ length: counts[t.id] ?? 0 }, () => t))
  const total = seatTypes.length
  // Questions can close before sign-ups do (a tee size a week out): after that, new seats come without a pick.
  const askedSessionIds = choose ? picked : pass?.sessionIds ?? []
  const questions = openQuestions(cls, askedSessionIds, new Date())
  const needsSeats = questions.length > 0 || own.addOns.length > 0
  const steps: Step[] = needsSeats ? ['details', 'seats', 'pay'] : ['details', 'pay']
  /** Seat i (in ticket type order) → its ticket type and its place among that type. */
  const seatSlot = (i: number) => {
    const t = seatTypes[i]
    return { typeId: t.id, k: seatTypes.slice(0, i).filter((x) => x.id === t.id).length }
  }
  const openIds = new Set(questions.map((qu) => qu.id))
  const seats = seatTypes.map((_, i) => {
    const { typeId, k } = seatSlot(i)
    const info = seatInfo[typeId]?.[k] ?? EMPTY_SEAT
    // Only answers to questions still open are sent.
    return Object.keys(info.answers).every((id) => openIds.has(id)) ? info : { ...info, answers: Object.fromEntries(Object.entries(info.answers).filter(([id]) => openIds.has(id))) }
  })

  // Seats left on every session this booking needs.
  const pickedSessions = own.sessions.filter((s) => picked.includes(s.id))
  const roomLeft = choose
    ? (pickedSessions.length ? Math.min(...pickedSessions.map((s) => s.left)) : pass.left)
    : pass?.left ?? 0
  // m6: on a pick-a-day option, only once a day is picked.
  const needsOver = door && (!choose || picked.length > 0) && roomLeft < Math.max(1, Object.values(counts).reduce((a, b) => a + (b || 0), 0))
  // Stage 4: the waitlist is open for what's picked (every picked date, or any date before one is picked).
  const wlSessions = choose ? pickedSessions : own.sessions.filter((s) => pass?.sessionIds?.includes(s.id))
  const wlOpen = !door && !!pass && (choose && !picked.length ? passWaitlistOpen(pass) : wlSessions.length > 0 && wlSessions.every((s) => s.waitlist?.open))
  // At the door the counters go up to a full booking; past the seats left needs "Add over capacity".
  // Online with the waitlist open they do too: past the seats left means joining the waitlist.
  const maxSeats = door || wlOpen ? own.rules.maxPerBooking : Math.max(0, Math.min(own.rules.maxPerBooking, roomLeft))
  const wantSeats = Object.values(counts).reduce((a, b) => a + (b || 0), 0)
  const waitlistMode = wlOpen && (!choose || picked.length === choose) && wantSeats > 0 && wantSeats > roomLeft
  const wlClosesIso = wlSessions.map((s) => s.waitlist?.closesIso ?? '').filter(Boolean).sort()[0] ?? null
  const wlFirstStart = [...wlSessions].sort((a, b) => a.startIso.localeCompare(b.startIso))[0]?.startIso ?? null

  const request: BookingRequest = {
    passId,
    ...(choose ? { sessionIds: picked } : {}),
    tickets: counts,
    ...(needsSeats ? { seats } : {}),
  }
  const now = new Date()
  const sale = door ? { door: true } : {}
  const full = quote(cls, request, now, own.taxPercent, sale)
  // Before each person's picks are in: the seats alone.
  const seatsOnly = quote({ ...cls, content: { ...cls.content, questions: [], addOns: [] } }, { ...request, seats: undefined }, now, own.taxPercent, sale)
  const q: Quote | null = full.ok ? full.value : null

  // One attempt id per checkout. While we don't know how a try ended, a retry
  // sends the same id, so the server can never charge twice. Changing what is
  // being booked starts a new one. C2: the id of a try still going through is
  // kept for this tab, so closing, reloading or swiping back and booking the
  // same seats again resumes that try instead of charging twice. Never at the
  // door: the shared iPad carries nothing from one customer to the next.
  const shape = JSON.stringify([passId, picked, counts, seats])
  const scope = door ? null : `class:${own.classId}`
  const attemptId = useRef<string>('')
  if (!attemptId.current) attemptId.current = scope ? attemptIdFor(scope, shape) : newAttemptId()
  useEffect(() => {
    attemptId.current = scope ? attemptIdFor(scope, shape) : newAttemptId()
  }, [shape])
  /** That attempt is over (booked, or nothing charged): forget it, and the next try is a new one. */
  function endAttempt() {
    if (scope) forgetPendingAttempt(scope, attemptId.current)
    attemptId.current = newAttemptId()
  }
  // An earlier try from this tab that never got a clear answer (the panel was closed or the page reloaded).
  const [earlierPending] = useState(() => (scope ? pendingAttempt(scope) : null))
  // The last booking request, so "Check again" can send the very same one (same attempt, same card token).
  const lastBody = useRef<string | null>(null)
  const [checking, setChecking] = useState(false)
  // The server saw a booking by the same person for this class minutes ago: they say whether to book again.
  const [repeatAsk, setRepeatAsk] = useState<string | null>(null)
  const confirmRepeat = useRef(false)
  // VoiceOver: what just changed with the code, and where focus goes next.
  const [codeStatus, setCodeStatus] = useState('')
  const [focusNext, setFocusNext] = useState<null | 'pay' | 'code'>(null)
  const payButtonRef = useRef<HTMLButtonElement>(null)
  const haveCodeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!focusNext) return
    ;(focusNext === 'pay' ? payButtonRef.current : haveCodeRef.current)?.focus()
    setFocusNext(null)
  }, [focusNext])

  // What the Pay button, the summary and the wallet say: the server's total after "the price changed", else
  // the server's price with the code, else the same quote the server makes (early-bird included).
  const codeQ = applied && applied.shape === shape ? applied.quote : null
  const serverQ = repriced && repriced.shape === shape && repriced.code === (codeQ ? applied!.code : null) ? repriced.quote : null
  const shown: Quote | null = serverQ ?? codeQ ?? q
  const free = !!shown && shown.totalCents === 0
  // M7: the early-bird ran when they reached the pay step and has ended since (Chicago midnight): say why the total rose.
  const [ebAtPay, setEbAtPay] = useState(false)
  useEffect(() => {
    setEbAtPay(step === 'pay' && hasEarlyBird(shown))
  }, [step])
  const ebEndedNote = step === 'pay' && ebAtPay && shown && !hasEarlyBird(shown) && !(serverQ && repriced?.note)
    ? `The early-bird ended at midnight, so the price is now ${formatMoney(shown.totalCents, workshop.currency)}.`
    : null
  // Back to change the booking with a code on: price it again for the new seats.
  useEffect(() => {
    if (applied && applied.shape !== shape && step === 'pay') void applyCode(applied.code, true)
  }, [shape, step])

  const classItem = (quantity = Math.max(1, total)): AnalyticsItem => ({
    item_id: own.classId, item_name: workshop.name, item_category: 'class', price: workshop.price / 100, quantity,
  })

  useEffect(() => {
    tr.trackWizardStarted('workshop')
    tr.trackViewItem(classItem(1))
  }, [])

  useEffect(() => {
    if (!syncUrl) return
    const url = new URL(window.location.href)
    if (url.searchParams.get('w') !== workshop.id) {
      url.searchParams.set('w', workshop.id)
      window.history.replaceState(window.history.state, '', url)
    }
    return () => {
      const after = new URL(window.location.href)
      after.searchParams.delete('w')
      window.history.replaceState(window.history.state, '', after)
    }
  }, [workshop.id, syncUrl])

  // New seat counts from the server: drop days that are now full or closed, and
  // bring the counts down to what is left.
  useEffect(() => {
    setPicked((p) => {
      const still = p.filter((id) => own.sessions.some((s) => s.id === id && !s.closed && (door || s.left > 0)))
      return still.length === p.length ? p : still
    })
  }, [own])
  useEffect(() => {
    if (total <= maxSeats) return
    let over = total - maxSeats
    setCounts((c) => {
      const next = { ...c }
      for (const t of [...own.ticketTypes].reverse()) {
        const cut = Math.min(over, next[t.id] ?? 0)
        if (cut) next[t.id] -= cut
        over -= cut
      }
      return next
    })
  }, [maxSeats])

  async function refreshAvailability() {
    try {
      const res = await fetch(door ? `/api/staff/class.json?id=${encodeURIComponent(own.classId)}` : `/api/classes/${encodeURIComponent(own.classId)}.json`, { cache: 'no-store' })
      if (!res.ok) return
      const fresh = (await res.json().catch(() => null))?.workshop?.own as OwnClassData | undefined
      if (fresh) onAvailability?.(fresh)
    } catch {
      // The sold-out message stands on its own.
    }
  }

  function choosePass(id: string) {
    if (id === passId) return
    setOver(false)
    setPassId(id)
    setPicked([])
    setPickNote(null)
    setProblem(null)
    // Keep only tickets this pass sells.
    const sold = new Set(soldTypes(id).map((t) => t.id))
    setCounts((c) => {
      const next = Object.fromEntries(Object.entries(c).filter(([k]) => sold.has(k)))
      if (!Object.values(next).some((n) => n > 0)) {
        const first = soldTypes(id)[0]
        return first ? { [first.id]: 1 } : {}
      }
      return next
    })
  }

  function toggleSession(id: string) {
    setProblem(null)
    setOver(false)
    setPickNote(null)
    if (picked.includes(id)) return setPicked(picked.filter((x) => x !== id))
    if (choose === 1) return setPicked([id])
    if (picked.length >= choose) return setPickNote(`You’ve picked ${choose} days. Tap one to change it.`)
    setPicked([...picked, id])
  }

  function setSeat(i: number, change: (s: SeatInfo) => SeatInfo) {
    setProblem(null)
    const { typeId, k } = seatSlot(i)
    setSeatInfo((all) => {
      const list = [...(all[typeId] ?? [])]
      for (let j = list.length; j <= k; j++) list[j] = EMPTY_SEAT
      list[k] = change(list[k] ?? EMPTY_SEAT)
      return { ...all, [typeId]: list }
    })
  }

  const seatName = (i: number) => {
    if (own.ticketTypes.length <= 1) return `Person ${i + 1}`
    const t = seatTypes[i]
    return `${t.label} ${seatTypes.slice(0, i + 1).filter((x) => x.id === t.id).length}`
  }

  const ticketsLabel = own.ticketTypes.length <= 1
    ? plural(total, 'seat')
    : own.ticketTypes.filter((t) => (counts[t.id] ?? 0) > 0).map((t) => `${counts[t.id]} ${counts[t.id] === 1 ? t.label : pluralWord(t.label)}`).join(', ')

  /** The details step is in order: says what isn't. */
  function detailsReady(): boolean {
    if (!pass || !canBook(pass)) {
      setProblem('Pick an option that still has seats.')
      return false
    }
    if (needsOver && !over) {
      setProblem('That day is full. Tick Add over capacity to seat them anyway.')
      return false
    }
    if (choose && picked.length !== choose) {
      setProblem(choose === 1 ? 'Pick a day.' : `Pick ${choose} days.`)
      return false
    }
    if (total < 1) {
      setProblem('Choose at least one person.')
      return false
    }
    if (total > maxSeats) {
      setProblem(maxSeats > 0 ? `Only ${plural(maxSeats, 'seat')} can be booked here.` : 'There are no seats left on that day.')
      return false
    }
    if (!seatsOnly.ok) {
      setProblem(seatsOnly.error)
      return false
    }
    return true
  }

  function next() {
    if (step === 'details') {
      if (!detailsReady()) return
      tr.trackWizardStepCompleted('details')
      if (!needsSeats) tr.trackBeginCheckout('workshop', (q?.totalCents ?? 0) / 100, [classItem()], { seats: total })
      setStep(needsSeats ? 'seats' : 'pay')
    } else if (step === 'seats') {
      if (!full.ok) {
        setProblem(full.error)
        return
      }
      tr.trackWizardStepCompleted('seats')
      tr.trackBeginCheckout('workshop', full.value.totalCents / 100, [classItem()], { seats: total })
      setStep('pay')
    }
    setProblem(null)
  }

  function back() {
    setError(null)
    setStep(steps[Math.max(0, steps.indexOf(step) - 1)])
  }

  function closeAndRecord() {
    if (!booked) tr.trackBookingAbandoned('workshop', step, { class: workshop.name, seats: total, class_id: own.classId })
    onClose()
  }
  const started = step !== 'details' || picked.length > 0 || (contact !== initialContact && contactStarted(contact))
  function requestClose() {
    if (booked || !started) return closeAndRecord()
    setAskToLeave(true)
  }
  function finish() {
    if (booked) onBooked?.(booked.sessionIds, total)
    onClose()
  }

  function readyToPay(): boolean {
    if (!full.ok) {
      setError(full.error)
      return false
    }
    const contactOk = contactRef.current?.check() ?? false
    if (!agreedToPolicy) {
      setPolicyProblem(true)
      if (contactOk) {
        policyRef.current?.focus()
        policyRef.current?.scrollIntoView?.({ block: 'center' })
      }
    }
    if (!contactOk || !agreedToPolicy) {
      setError(null)
      return false
    }
    return true
  }

  /** "Have a code?": the server prices this booking with it, or says why not. Nothing is held. */
  async function applyCode(raw: string, quiet = false) {
    const code = raw.trim()
    if (!code) {
      setCodeError('Type the code first.')
      return
    }
    if (!full.ok) return
    setApplying(true)
    setCodeError(null)
    try {
      const res = await fetch(door ? '/api/classes/promo.json?door=1' : '/api/classes/promo.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classId: own.classId, code, request }),
      })
      const body = await res.json().catch(() => null)
      if (res.ok && body?.data?.quote) {
        const newQuote = body.data.quote as Quote
        setApplied({ code: String(body.data.code), quote: newQuote, shape })
        setRepriced(null)
        setCodeOpen(false)
        setCodeText('')
        setError(null)
        if (!quiet) {
          setCodeStatus(`Code ${String(body.data.code)} applied. New total ${formatMoney(newQuote.totalCents, workshop.currency)}.`)
          setFocusNext('pay')
        }
        return
      }
      setApplied(null)
      setCodeOpen(true)
      setCodeError(typeof body?.detail === 'string' ? body.detail : 'We couldn’t check that code just now. Try again in a minute.')
    } catch {
      if (quiet) setApplied(null)
      setCodeOpen(true)
      setCodeError('We couldn’t check that code just now. Try again in a minute.')
    } finally {
      setApplying(false)
    }
  }

  function removeCode() {
    setApplied(null)
    setRepriced(null)
    setCodeError(null)
    setCodeStatus(q ? `Code removed. New total ${formatMoney(q.totalCents, workshop.currency)}.` : 'Code removed.')
    setFocusNext('code')
  }

  /**
   * Stage 4: join the waitlist. Square saves the card (STORE, card only);
   * nothing is charged now. The server prices it, checks it is still full and
   * the waitlist still open, and keeps only Square's card id.
   */
  /** I2: the consent exactly as shown (its amount, close time and words), or null before it can be shown. */
  function consentShown(): { maxCents: number; closesIso: string; text: string; firstStartIso: string } | null {
    const terms = wlTerms && wlTerms.shape === shape ? wlTerms : null
    const maxCents = terms?.maxCents ?? q?.totalCents ?? 0
    const closesIso = terms?.closesIso ?? wlClosesIso
    if (!closesIso || !wlFirstStart || maxCents <= 0) return null
    return { maxCents, closesIso, firstStartIso: wlFirstStart, text: consentText({ className: workshop.name, startIso: wlFirstStart, more: wlSessions.length > 1, closesIso, maxCents }) }
  }

  async function handleJoin(e?: FormEvent) {
    e?.preventDefault()
    if (processing || !paymentReady) return
    if (!full.ok || !q) {
      setError(full.ok ? workshopMessages.unavailable : full.error)
      return
    }
    const contactOk = contactRef.current?.check() ?? false
    if (!consented) {
      setConsentProblem(true)
      if (contactOk) {
        consentRef.current?.focus()
        consentRef.current?.scrollIntoView?.({ block: 'center' })
      }
    }
    if (!contactOk || !consented) {
      setError(null)
      return
    }
    setError(null)
    setProcessing(true)
    try {
      let card: { token: string; verificationToken?: string }
      try {
        card = await paymentFormRef.current!.tokenizeAndVerify({
          givenName: contact.firstName.trim(), familyName: contact.lastName.trim(), email: contact.email.trim(), phone: contact.phone.trim(),
        })
      } catch {
        setError('We couldn’t read that card. Check the number, date and code, then try again. Nothing was charged.')
        return
      }
      let res: Response
      try {
        res = await fetch('/api/classes/waitlist.json', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'join', classId: own.classId, attemptId: attemptId.current, passId,
            ...(choose ? { sessionIds: picked } : {}), tickets: counts, seats, consent: true, consentShown: consentShown(),
            cardToken: card.token, verificationToken: card.verificationToken ?? null,
            customer: { givenName: contact.firstName.trim(), familyName: contact.lastName.trim(), email: contact.email.trim(), phone: contact.phone.trim() },
          }),
        })
      } catch {
        // Nothing came back. A retry sends the same attempt, so it can't add them twice.
        setError('We couldn’t tell whether that went through. Check your email, or try again. Nothing was charged.')
        return
      }
      const body = await res.json().catch(() => null)
      if (res.ok && body?.data) {
        setJoined({ position: Number(body.data.position) || 1, last4: String(body.data.card?.last4 ?? ''), emailSent: body.data.emailSent === true })
        setAskToLeave(false)
        if (!door) rememberContact(contact)
        return
      }
      attemptId.current = newAttemptId()
      if (body?.code) tr.trackBookingProblem('workshop', `waitlist_${String(body.code)}`)
      // A seat opened while they were joining: the card came back off, and they book it instead.
      if (body?.code === 'spot_open') void refreshAvailability()
      // I2: the price or close time changed since the consent was shown. Nothing was saved: show the new terms, untick.
      if (body?.code === 'consent_changed' && Number.isInteger(body.maxCents) && typeof body.closesIso === 'string') {
        setWlTerms({ shape, maxCents: Number(body.maxCents), closesIso: body.closesIso })
        setConsented(false)
        void refreshAvailability()
      }
      setError(typeof body?.detail === 'string' ? body.detail : WAITLIST_MESSAGES.unavailable)
    } finally {
      setProcessing(false)
    }
  }

  /** `walletToken`: Apple Pay or Google Pay already approved the payment. */
  async function handlePay(e?: FormEvent, walletToken?: string) {
    e?.preventDefault()
    if (processing || (!walletToken && !free && !paymentReady)) return
    if (!readyToPay() || !q || !shown) return
    setError(null)
    setProcessing(true)
    tr.trackPaymentStarted(shown.totalCents / 100)
    try {
      // One order, one charge: one token pays for every seat. A free booking (D3) needs no card at all.
      let token: string
      let verificationToken: string | undefined
      let sourceKind: 'card' | 'gift_card' | 'wallet' | 'free'
      if (free) {
        token = ''
        sourceKind = 'free'
      } else if (walletToken) {
        token = walletToken
        sourceKind = 'wallet'
      } else {
        try {
          // Money M5: the bank's own check (3-D Secure) where the card asks for one, as the waitlist does.
          const t = await paymentFormRef.current!.tokenizeAndVerify({
            givenName: contact.firstName.trim(), familyName: contact.lastName.trim(), email: contact.email.trim(), phone: contact.phone.trim(),
            amount: (shown.totalCents / 100).toFixed(2), currencyCode: 'USD',
          })
          token = t.token
          verificationToken = t.verificationToken
          sourceKind = t.kind ?? 'card'
        } catch {
          tr.trackBookingProblem('workshop', 'card_unreadable')
          throw new Error('We couldn’t read that card. Check the number, date and code, then try again. Nothing was charged.')
        }
      }
      if (sourceKind !== 'free') tr.trackAddPaymentInfo('workshop', shown.totalCents / 100, sourceKind)

      const requestBody = JSON.stringify({
            classId: own.classId,
            passId,
            sessionIds: choose ? picked : [],
            ...(door && over ? { overCapacity: true } : {}),
            tickets: counts,
            seats,
            attemptId: attemptId.current,
            paymentToken: token,
            ...(verificationToken ? { verificationToken } : {}),
            ...(codeQ ? { promoCode: applied!.code } : {}),
            // Review I2: the total on the Pay button; a higher one now charges nothing.
            expectedTotalCents: shown.totalCents,
            customer: {
              givenName: contact.firstName.trim(),
              familyName: contact.lastName.trim(),
              email: contact.email.trim(),
              phone: contact.phone.trim(),
            },
            attribution: readAttribution(),
            posthogId: posthogId(),
            sourceKind,
            ...(confirmRepeat.current ? { confirmRepeat: true } : {}),
          })
      await sendBooking(requestBody)
    } catch (err) {
      tr.trackPaymentFailed(err instanceof Error ? err.message : 'unknown')
      setError(err instanceof Error ? err.message : workshopMessages.unavailable)
    } finally {
      setProcessing(false)
    }
  }

  /** "Check again" after an unclear answer: the very same request, so the server answers with that try's result. */
  async function checkAgain() {
    if (!lastBody.current || processing) return
    setChecking(true)
    setProcessing(true)
    setStuck(null)
    try {
      await sendBooking(lastBody.current)
    } catch (err) {
      setError(err instanceof Error ? err.message : workshopMessages.unavailable)
    } finally {
      setChecking(false)
      setProcessing(false)
    }
  }

  /** Sends one booking request and shows what came of it. Throws the message for a plain "nothing charged". */
  async function sendBooking(requestBody: string) {
    if (!q || !shown) return
    lastBody.current = requestBody
    setRepeatAsk(null)
    // Until a plain answer comes back, this attempt is going through (kept for this tab).
    if (scope) rememberPendingAttempt(scope, attemptId.current, shape)
      let res: Response
      try {
        res = await fetch(door ? '/api/classes/book.json?door=1' : '/api/classes/book.json', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: requestBody,
        })
      } catch {
        // The request left and nothing came back. It may have gone through.
        setStuck(UNKNOWN_OUTCOME_MESSAGE)
        return
      }

      if (!res.ok) {
        const body = await res.json().catch(() => null)
        const failure = { status: res.status, body }
        // Unclear, or the first try still running: the same attempt id, so a
        // retry can't charge twice. Anything definite: that attempt is over.
        // A "slow down" (429) never says how an earlier try ended: keep the attempt too.
        const keep = outcomeUnknown(failure) || body?.code === 'in_progress' || res.status === 429
        if (!keep) endAttempt()
        if (body?.code) tr.trackBookingProblem('workshop', String(body.code))
        // C2: the same person booked this class minutes ago. Nothing was charged; they say whether to book again.
        if (body?.code === 'recent_booking') {
          setRepeatAsk(typeof body.detail === 'string' ? body.detail : CLASS_MESSAGES.already_booked)
          return
        }
        // The total went up (an early-bird or a code ended): show the new one and let them pay it. Nothing was charged.
        if (body?.code === 'price_changed' && body.quote && typeof body.quote.totalCents === 'number') {
          setRepriced({ quote: body.quote as Quote, shape, code: codeQ ? applied!.code : null, note: String(body.detail ?? '') })
          return
        }
        // The code stopped working between Apply and Pay: it comes off, and the total without it shows.
        if (body?.code === 'promo') {
          setApplied(null)
          setRepriced(null)
          setCodeOpen(true)
          setCodeError(typeof body.detail === 'string' ? body.detail : CLASS_MESSAGES.unavailable)
          return
        }
        const message = messageForFailure(failure, CLASS_MESSAGES)
        if (keep && res.status !== 429) {
          setStuck(message)
          return
        }
        if (body?.code === 'sold_out') void refreshAvailability()
        throw new Error(message)
      }

      const data = (await res.json().catch(() => null))?.data
      if (!data) {
        setStuck(UNKNOWN_OUTCOME_MESSAGE)
        return
      }
      endAttempt()
      confirmRepeat.current = false
      const charged = typeof data.totalChargedCents === 'number' ? data.totalChargedCents : null
      setBooked({
        bookingId: data.bookingId ?? null,
        receiptUrl: data.receiptUrl ?? null,
        emailSent: data.emailSent === true,
        chargedCents: charged,
        ticketsLabel: typeof data.ticketsLabel === 'string' ? data.ticketsLabel : null,
        sessionIds: Array.isArray(data.sessionIds) ? data.sessionIds : q.sessionIds,
      })
      setAskToLeave(false)
      if (!door) {
        tr.identifyBooker(contact.email, contact.firstName, contact.lastName)
        rememberContact(contact)
      }
      const paid = (charged ?? q.totalCents) / 100
      tr.trackPaymentCompleted(paid, {
        kind: 'workshop',
        transactionId: data.bookingId ?? null,
        items: [classItem()],
        extra: { seats: total, class: workshop.name, class_id: own.classId },
      })
      tr.trackWorkshopSeatBooked(workshop.name, paid)
      tr.trackBookingCompleted('workshop')
  }

  // ── Booked ────────────────────────────────────────────────────────────────
  function renderConfirmation() {
    const b = booked!
    const origin = window.location.origin
    const waiverUrl = b.bookingId
      ? `${origin}/waiver?workshop=${encodeURIComponent(own.classId)}&booking=${encodeURIComponent(b.bookingId)}`
      : `${origin}/waiver`
    const sessions = own.sessions.filter((s) => b.sessionIds.includes(s.id))
    // Every date goes in the calendar file; Google's link holds one, so it shows only for a single date.
    const calendarEvents = sessions.map((s) => ({
      title: `${workshop.name} at ${STUDIO_ADDRESS.name}`,
      startIso: s.startIso,
      endIso: s.endIso,
      details: `Your class at ${STUDIO_ADDRESS.name}.\n\nSign the participation agreement before you come. ${waiverUrl}`,
      location: `${STUDIO_ADDRESS.name}, ${STUDIO_ADDRESS_LINE}`,
    }))
    const calendarEvent = calendarEvents.length === 1 ? calendarEvents[0] : null
    const paid = b.chargedCents ?? shown?.totalCents ?? 0
    return (
      <BookingConfirmed
        heading="You’re booked"
        what={
          <>
            {b.ticketsLabel ?? ticketsLabel} for <strong>{workshop.name}</strong>, {paid === 0 ? 'free' : `${formatMoney(paid, workshop.currency)} paid`}.
          </>
        }
        email={contact.email.trim()}
        emailSent={b.emailSent}
        onEmailChanged={(nextEmail) => { if (!door) rememberContact({ ...contact, email: nextEmail }) }}
      >
        <div style={{ marginTop: '1.25rem' }}>
          <ConfirmedBlock label="When">
            {sessions.map((s) => (
              <div key={s.id}><strong>{formatDayAndSpan(s.startIso, s.endIso)}</strong></div>
            ))}
            {calendarEvents.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem 1rem', marginTop: '0.25rem' }}>
                {calendarEvent && (
                  <a href={googleCalendarUrl(calendarEvent)} target="_blank" rel="noopener noreferrer" className="btn btn-quiet" style={{ width: 'auto' }} onClick={() => tr.trackAddToCalendar('confirmation', 'google', 'workshop')}>
                    Add to Google Calendar
                  </a>
                )}
                <a href={icsDataUrl(buildIcs(calendarEvents, { uidPrefix: 'class' }))} download="hometown-class.ics" className="btn btn-quiet" style={{ width: 'auto' }} onClick={() => tr.trackAddToCalendar('confirmation', 'ics', 'workshop')}>
                  {calendarEvent ? 'Apple or Outlook' : 'Add every date to your calendar'}
                </a>
              </div>
            )}
          </ConfirmedBlock>
          <ConfirmedBlock label="Where">
            {STUDIO_ADDRESS.name}, {STUDIO_ADDRESS_LINE}
            <div>
              <a href={STUDIO_DIRECTIONS_URL} target="_blank" rel="noopener noreferrer" className="btn btn-quiet" style={{ width: 'auto' }}>
                Get directions
              </a>
            </div>
          </ConfirmedBlock>
          <ConfirmedBlock label="Before you come">
            <p style={{ margin: '0 0 0.625rem' }}>Sign the participation agreement. It takes a minute, and saves doing it at the door.</p>
            <a href={waiverUrl} target="_blank" rel="noopener noreferrer" className="btn btn-primary" onClick={() => tr.trackWaiverLinkClick('workshop_confirmation')}>
              Sign the agreement
            </a>
          </ConfirmedBlock>
          <ConfirmedBlock label="Changing plans">{workshopRefundLine()}</ConfirmedBlock>
          {b.receiptUrl && (
            <ConfirmedBlock label="Receipt">
              <a href={b.receiptUrl} target="_blank" rel="noopener noreferrer" className="btn btn-quiet" style={{ width: 'auto' }}>
                View your receipt
              </a>
            </ConfirmedBlock>
          )}
        </div>
      </BookingConfirmed>
    )
  }

  // ── Joined the waitlist ───────────────────────────────────────────────────
  function renderJoined() {
    const j = joined!
    return (
      <BookingConfirmed
        heading="You’re on the waitlist"
        what={<>{joinedLine(j.position, j.last4 || '…', workshop.name)}</>}
        email={contact.email.trim()}
        emailSent={j.emailSent}
      >
        <div style={{ marginTop: '1.25rem' }}>
          <ConfirmedBlock label="If a spot opens">
            If a spot opens before the waitlist closes, we add you, charge your card, and text and email you. If no spot opens, nothing is charged and your card comes off.
          </ConfirmedBlock>
          <ConfirmedBlock label="Changed your mind?">
            The email we sent has a link to leave the waitlist.
          </ConfirmedBlock>
        </div>
      </BookingConfirmed>
    )
  }

  // ── Step 1: what, which pass and days, how many ───────────────────────────
  function renderDetails() {
    const paragraphs = workshop.description.split(/\n\s*\n|\n/).map((p) => p.trim()).filter(Boolean)
    const meta = [agesLabel(own.rules.ages), own.rules.dropOff ? 'Drop-off' : '', own.instructor ? `With ${own.instructor}` : ''].filter(Boolean).join(' · ')
    const passSessions = !choose && pass?.sessionIds ? own.sessions.filter((s) => pass.sessionIds!.includes(s.id)) : []
    const left = seatsLeftLabel(roomLeft)
    return (
      <div>
        {/* UI review (3 Nov): a full class says "waitlist" first, before anything else on the sheet. */}
        {waitlistMode && (
          <div role="status" data-testid="waitlist-note" style={{ margin: '0 0 1rem', padding: '0.75rem 1rem', borderRadius: '0.75rem', border: '1.5px solid var(--color-primary)', background: 'rgba(var(--color-primary-rgb), 0.08)' }}>
            <p style={{ margin: 0, fontSize: '0.9375rem', lineHeight: 1.5, fontWeight: 600, color: 'var(--color-dark)' }}>{waitlistReason(roomLeft, total)}</p>
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.875rem', lineHeight: 1.5, color: 'var(--color-text)' }}>{WAITLIST_NOTHING_NOW}</p>
          </div>
        )}
        {/* The choices come first (UI review: the seat counter was below the fold on a phone); the picture and words follow. */}
        <div style={{ display: 'grid', gap: '1.25rem' }}>
          {shownPasses.length > 1 && (
            <div role="group" aria-label="Choose an option" style={{ display: 'grid', gap: '0.5rem' }}>
              {shownPasses.map((p) => {
                const prices = soldTypes(p.id).map((t) => currentPriceCents(own, p.id, t.id) ?? own.prices[p.id][t.id])
                const from = Math.min(...prices)
                const open = canBook(p)
                return (
                  <button key={p.id} type="button" aria-pressed={p.id === passId} disabled={!open} onClick={() => choosePass(p.id)} style={choiceButton(p.id === passId, open)}>
                    <span style={{ fontWeight: 600 }}>{p.label}</span>
                    <span style={{ fontSize: '0.875rem', color: 'var(--color-text)' }}>
                      {p.state === 'open' ? `${new Set(prices).size > 1 ? 'From ' : ''}${formatMoney(from, workshop.currency)}` : door && open ? 'Full' : open ? 'Full · waitlist' : 'Sold out'}
                    </span>
                  </button>
                )
              })}
            </div>
          )}

          {choose > 0 && (
            <div>
              <p style={{ margin: '0 0 0.5rem', fontSize: '0.9375rem', fontWeight: 600, color: 'var(--color-dark)' }}>
                {choose === 1 ? 'Pick a day' : `Pick ${choose} days`}
              </p>
              <div role="group" aria-label={choose === 1 ? 'Pick a day' : `Pick ${choose} days`} style={{ display: 'grid', gap: '0.5rem' }}>
                {own.sessions.filter((s) => !s.closed).map((s) => {
                  const on = picked.includes(s.id)
                  const wl = !door && !!s.waitlist?.open
                  const enabled = s.left > 0 || door || wl
                  return (
                    <button key={s.id} type="button" aria-pressed={on} disabled={!enabled} onClick={() => toggleSession(s.id)} style={choiceButton(on, enabled)}>
                      <span>{formatDayAndSpan(s.startIso, s.endIso)}</span>
                      <span style={{ fontSize: '0.8125rem', color: 'var(--color-text)' }}>{s.left > 0 ? seatsLeftLabel(s.left) : door ? 'Full' : wl ? 'Full · waitlist' : 'Sold out'}</span>
                    </button>
                  )
                })}
              </div>
              <p role="status" aria-live="polite" style={{ margin: pickNote ? '0.5rem 0 0' : 0, fontSize: '0.875rem', color: 'var(--color-text)' }}>{pickNote}</p>
            </div>
          )}

          {passSessions.length > 1 && (
            <div>
              <p style={{ margin: '0 0 0.375rem', fontSize: '0.9375rem', fontWeight: 600, color: 'var(--color-dark)' }}>{plural(passSessions.length, 'session')}</p>
              <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.9375rem', color: 'var(--color-text)', lineHeight: 1.6 }}>
                {passSessions.map((s) => <li key={s.id}>{formatDayAndSpan(s.startIso, s.endIso)}</li>)}
              </ul>
            </div>
          )}
          {/* One date: it's in the line at the top already (UI review: it was said twice). */}

          <div style={{ display: 'grid', gap: '0.75rem' }}>
            {types.map((t) => {
              const n = counts[t.id] ?? 0
              const word = own.ticketTypes.length <= 1 ? 'Seats' : pluralWord(t.label)
              return (
                <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                  <div>
                    <p style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 600, color: 'var(--color-dark)' }}>{word}</p>
                    <p style={{ margin: '0.125rem 0 0', fontSize: '0.875rem', color: 'var(--color-text)' }}>
                      {(() => {
                        const regular = own.prices[passId][t.id]
                        const now = currentPriceCents(own, passId, t.id) ?? regular
                        if (now >= regular) return `${formatMoney(regular, workshop.currency)} each`
                        return (
                          <>
                            <span style={visuallyHidden}>{`Was ${formatMoney(regular, workshop.currency)}, now `}</span>
                            <s aria-hidden="true">{formatMoney(regular, workshop.currency)}</s>{' '}
                            {`${formatMoney(now, workshop.currency)} each, early-bird${own.earlyBird?.untilYmd ? ` through ${shortDay(own.earlyBird.untilYmd)}` : ''}`}
                          </>
                        )
                      })()}
                    </p>
                  </div>
                  <Counter
                    label={word.toLowerCase()}
                    value={n}
                    spoken={own.ticketTypes.length <= 1 ? plural(n, 'seat') : `${n} ${n === 1 ? t.label : pluralWord(t.label)}`}
                    canLess={n > 0}
                    canMore={total < maxSeats}
                    onLess={() => { setProblem(null); setCounts((c) => ({ ...c, [t.id]: Math.max(0, (c[t.id] ?? 0) - 1) })) }}
                    onMore={() => { setProblem(null); setCounts((c) => ({ ...c, [t.id]: (c[t.id] ?? 0) + 1 })) }}
                  />
                </div>
              )
            })}
            {left && <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--color-text)' }}>{left}</p>}
            {needsOver && (
              <p role="status" data-testid="door-full" style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 600, color: '#b45309' }}>
                {choose ? 'That day is full.' : 'This option is full.'} Tick Add over capacity to seat them anyway.
              </p>
            )}
            {needsOver && (
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', minHeight: '2.75rem', cursor: 'pointer', fontSize: '0.9375rem', color: 'var(--color-dark)' }}>
                <input type="checkbox" checked={over} onChange={(e) => { setOver(e.target.checked); setProblem(null) }} style={{ width: '1.25rem', height: '1.25rem', accentColor: 'var(--color-primary)' }} />
                Add over capacity
              </label>
            )}
            {total >= maxSeats && maxSeats > 0 && !waitlistMode && (
              <p role="status" style={{ margin: 0, fontSize: '0.875rem', color: 'var(--color-text)' }}>
                {maxSeats >= own.rules.maxPerBooking && roomLeft > maxSeats
                  ? `One booking holds up to ${plural(own.rules.maxPerBooking, 'seat')}.`
                  : 'That’s every seat left.'}
              </p>
            )}
          </div>
        </div>
        {problem && <p role="alert" className="field-error" style={{ marginTop: '0.75rem' }}>{problem}</p>}

        {(workshop.imageUrl || meta || paragraphs.length > 0) && (
          <div data-testid="class-about" style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid var(--color-line)' }}>
            {workshop.imageUrl && (
              <img src={workshop.imageUrl} alt={workshop.name} style={{ display: 'block', width: '100%', maxHeight: '16rem', objectFit: 'cover', borderRadius: '0.75rem', background: 'var(--color-sand)', marginBottom: '1rem' }} />
            )}
            {meta && <p style={{ margin: '0 0 0.75rem', fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-muted)' }}>{meta}</p>}
            {paragraphs.map((p, i) => (
              <p key={i} style={{ margin: '0 0 0.75rem', fontSize: '0.9375rem', lineHeight: 1.6, color: 'var(--color-text)' }}>{p}</p>
            ))}
          </div>
        )}
        {/* "Not ready to book? Email me this class." One quiet line, never at the door (the studio iPad). */}
        {!door && (
          <div style={{ marginTop: '1.5rem' }}>
            <EmailMeThisClass classId={own.classId} className={workshop.name} />
          </div>
        )}
      </div>
    )
  }

  // ── Step 2: each person's picks and extras ────────────────────────────────
  function renderSeats() {
    return (
      <div style={{ display: 'grid', gap: '1.25rem' }}>
        {seats.map((s, i) => (
          <fieldset key={i} style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: '0.625rem' }}>
            <legend style={{ padding: 0, marginBottom: '0.5rem', fontSize: '1rem', fontWeight: 700, color: 'var(--color-dark)' }}>{seatName(i)}</legend>
            {questions.map((qu) => {
              const id = `${formId}-q-${i}-${qu.id}`
              return (
                <div key={qu.id}>
                  <label htmlFor={id} style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-dark)' }}>{qu.label}</label>
                  <select id={id} value={s.answers[qu.id] ?? ''} onChange={(e) => { const v = e.target.value; setSeat(i, (x) => ({ ...x, answers: { ...x.answers, [qu.id]: v } })) }} style={selectStyle}>
                    <option value="" disabled>Choose…</option>
                    {qu.choices.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              )
            })}
            {own.addOns.map((a) => {
              const n = s.addOns[a.id] ?? 0
              return (
                <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                  <div>
                    <p style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 600, color: 'var(--color-dark)' }}>{a.label}</p>
                    <p style={{ margin: '0.125rem 0 0', fontSize: '0.875rem', color: 'var(--color-text)' }}>{formatMoney(a.priceCents, workshop.currency)} each</p>
                  </div>
                  <Counter
                    label={`${a.label.toLowerCase()} for ${seatName(i).toLowerCase()}`}
                    value={n}
                    spoken={`${n} ${a.label}`}
                    canLess={n > 0}
                    canMore={n < a.maxPerSeat}
                    onLess={() => setSeat(i, (x) => ({ ...x, addOns: { ...x.addOns, [a.id]: Math.max(0, n - 1) } }))}
                    onMore={() => setSeat(i, (x) => ({ ...x, addOns: { ...x.addOns, [a.id]: Math.min(a.maxPerSeat, n + 1) } }))}
                  />
                </div>
              )
            })}
          </fieldset>
        ))}
        {problem && <p role="alert" className="field-error">{problem}</p>}
      </div>
    )
  }

  // ── Step 3: contact and payment ───────────────────────────────────────────
  function renderPay() {
    const lines = shown?.lines ?? []
    // "2 Adults × $20" and "1 Glitter × $3": seats by ticket type at their regular price, extras by name;
    // then what came off ("Early-bird −$10.00", "Code FALLFRIENDS −$4.50"), then tax. The Pay button says the total.
    const groups = new Map<string, { label: string; n: number; each: number; seat: boolean }>()
    for (const l of lines) {
      const each = l.listCents ?? l.cents
      const key = `${l.kind}:${l.kind === 'seat' ? l.ticketTypeId : l.label}:${each}`
      const g = groups.get(key) ?? { label: l.label, n: 0, each, seat: l.kind === 'seat' }
      g.n++
      groups.set(key, g)
    }
    const offs = shown ? discountRows(shown) : []
    const row = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', fontSize: '0.875rem', color: 'var(--color-text)', marginTop: '0.125rem' } as const
    return (
      <form id={formId} onSubmit={handlePay} noValidate>
        <ContactFields ref={contactRef} value={contact} onChange={setContact} phoneRequired disabled={processing} />

        <div style={{ margin: '1.25rem 0 0.5rem', padding: '0.875rem 1rem', borderRadius: '0.75rem', background: 'var(--color-sand)' }}>
          <p style={{ margin: 0, fontSize: '0.9375rem', color: 'var(--color-dark)' }}>
            {workshop.name}{own.passes.length > 1 && pass ? `, ${pass.label}` : ''}
          </p>
          {[...groups.values()].map((g, i) => (
            <div key={i} style={row}>
              <span>
                {g.seat && own.ticketTypes.length <= 1 ? plural(g.n, 'seat') : `${g.n} ${g.seat && g.n !== 1 ? pluralWord(g.label) : g.label}`} × {formatMoney(g.each, workshop.currency)}
              </span>
              <span>{formatMoney(g.each * g.n, workshop.currency)}</span>
            </div>
          ))}
          {offs.map((d) => (
            <div key={d.name} style={row} data-testid="discount-row">
              <span>
                {d.name}
                {d.kind === 'promo' && codeQ && (
                  <>
                    {' '}
                    <button type="button" onClick={removeCode} disabled={processing} style={{ ...linkButton, minHeight: '2.75rem', minWidth: '2.75rem', padding: '0 0.25rem', fontSize: '0.875rem' }} aria-label={`Remove ${d.name}`}>
                      Remove
                    </button>
                  </>
                )}
              </span>
              <span>&minus;{formatMoney(d.cents, workshop.currency)}</span>
            </div>
          ))}
          {shown && shown.taxCents > 0 && (
            <div style={{ ...row, marginTop: '0.25rem' }}>
              <span>Tax</span>
              <span>{formatMoney(shown.taxCents, workshop.currency)}</span>
            </div>
          )}
          {/* No total line here: the Pay button says it (Kaden, 18 Oct 2026). */}
        </div>

        {/* Stage 4: "Have a code?" — on the pay step only, the field opens on a tap. */}
        <div style={{ marginBottom: '1rem' }}>
          <p role="status" aria-live="polite" style={visuallyHidden}>{codeStatus}</p>
          {!codeQ && !codeOpen && (
            <button ref={haveCodeRef} type="button" style={linkButton} onClick={() => { setCodeOpen(true); setCodeError(null) }} disabled={processing}>
              Have a code?
            </button>
          )}
          {!codeQ && codeOpen && (
            <div>
              <label htmlFor={codeInputId} style={{ display: 'block', margin: '0.25rem 0', fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-dark)' }}>Code</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  id={codeInputId}
                  type="text"
                  value={codeText}
                  onChange={(e) => { setCodeText(e.target.value); setCodeError(null) }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void applyCode(codeText) } }}
                  autoCapitalize="characters"
                  autoCorrect="off"
                  autoComplete="off"
                  spellCheck={false}
                  enterKeyHint="done"
                  maxLength={40}
                  disabled={applying || processing}
                  aria-invalid={codeError ? true : undefined}
                  aria-describedby={codeError ? codeErrorId : undefined}
                  style={{ flex: 1, minWidth: 0, minHeight: '2.75rem', padding: '0.5rem 0.75rem', borderRadius: '0.75rem', border: '1.5px solid var(--color-field-border)', background: 'var(--color-surface)', fontSize: '1rem', color: 'var(--color-dark)', textTransform: 'uppercase' }}
                />
                <button type="button" className="btn btn-secondary" style={{ width: 'auto', minHeight: '2.75rem' }} onClick={() => void applyCode(codeText)} disabled={applying || processing}>
                  {applying ? 'Checking…' : 'Apply'}
                </button>
              </div>
            </div>
          )}
          {codeError && <p id={codeErrorId} role="alert" className="field-error" style={{ marginTop: '0.375rem' }}>{codeError}</p>}
        </div>

        {free ? (
          <div data-testid="free-booking" style={{ padding: '0.875rem 1rem', borderRadius: '0.75rem', border: '1.5px solid var(--color-primary)', background: 'rgba(var(--color-primary-rgb), 0.08)' }}>
            <p style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 600, color: 'var(--color-dark)' }}>{codeQ ? 'Free with your code' : 'This one is free'}</p>
            <p style={{ margin: '0.125rem 0 0', fontSize: '0.875rem', color: 'var(--color-text)' }}>No card needed.</p>
          </div>
        ) : (
          <PaymentForm
            bookingKind="workshop"
            ref={paymentFormRef}
            wallet={shown ? { amount: (shown.totalCents / 100).toFixed(2), label: `Hometown Studio, ${workshop.name}` } : undefined}
            onWalletToken={(token) => handlePay(undefined, token)}
            canPayWithWallet={() => (readyToPay() ? null : 'Add the details marked above first.')}
            onReadyChange={setPaymentReady}
          />
        )}

        <div style={{ marginTop: '1rem' }}>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.625rem', cursor: 'pointer', minHeight: '2.75rem' }}>
            <input
              ref={policyRef}
              type="checkbox"
              name="agree-to-policy"
              checked={agreedToPolicy}
              onChange={(e) => {
                setAgreedToPolicy(e.target.checked)
                if (e.target.checked) setPolicyProblem(false)
              }}
              aria-invalid={policyProblem ? true : undefined}
              aria-describedby={policyProblem ? policyErrorId : undefined}
              style={{ marginTop: '0.2rem', width: '1.25rem', height: '1.25rem', flexShrink: 0, cursor: 'pointer', accentColor: 'var(--color-primary)' }}
            />
            <span style={{ fontSize: '0.9375rem', color: 'var(--color-dark)', lineHeight: 1.5 }}>
              I agree to the{' '}
              <a href={`${POLICY_PATH}#${POLICY_ANCHORS.workshops}`} target="_blank" rel="noopener" style={{ color: 'var(--color-primary)', fontWeight: 600, textDecoration: 'underline' }}>
                booking and cancellation policy
              </a>
              . <span style={{ color: 'var(--color-text)' }}>{checkoutPolicySummary.workshop}.</span>
            </span>
          </label>
          {policyProblem && (
            <p id={policyErrorId} role="alert" className="field-error" style={{ marginTop: '0.375rem' }}>{POLICY_UNTICKED}</p>
          )}
        </div>

        {ebEndedNote && (
          <p role="status" data-testid="early-bird-ended" style={{ marginTop: '0.875rem', fontSize: '0.9375rem', lineHeight: 1.5, fontWeight: 600, color: 'var(--color-dark)' }}>{ebEndedNote}</p>
        )}
        {earlierPending && (
          <p role="status" data-testid="earlier-pending" style={{ marginTop: '0.875rem', fontSize: '0.9375rem', lineHeight: 1.5, fontWeight: 600, color: 'var(--color-dark)' }}>{EARLIER_PENDING}</p>
        )}
        {repeatAsk && (
          <div role="alert" data-testid="recent-booking" style={{ marginTop: '0.875rem', fontSize: '0.9375rem', lineHeight: 1.5, color: 'var(--color-dark)' }}>
            <p style={{ margin: '0 0 0.5rem', fontWeight: 600 }}>{repeatAsk}</p>
            <button type="button" className="btn btn-secondary" disabled={processing} onClick={() => { confirmRepeat.current = true; setRepeatAsk(null); void handlePay() }}>
              Yes, book these seats too
            </button>
          </div>
        )}
        {serverQ && repriced?.note && (
          <p role="alert" data-testid="price-changed" style={{ marginTop: '0.875rem', fontSize: '0.9375rem', lineHeight: 1.5, fontWeight: 600, color: 'var(--color-dark)' }}>{repriced.note}</p>
        )}
        {error && (
          <p role="alert" className="field-error" style={{ marginTop: '0.875rem', fontSize: '0.9375rem', lineHeight: 1.5 }}>{error}</p>
        )}
      </form>
    )
  }

  // ── Step 3 (waitlist): contact, card to save, consent ──────────────────────
  function renderWaitlist() {
    const shownConsent = consentShown()
    const most = shownConsent?.maxCents ?? q?.totalCents ?? 0
    return (
      <form id={formId} onSubmit={handleJoin} noValidate>
        <p role="status" data-testid="waitlist-step" style={{ margin: '0 0 1rem', fontSize: '0.9375rem', lineHeight: 1.5, fontWeight: 600, color: 'var(--color-dark)' }}>
          {waitlistReason(roomLeft, total)}
        </p>
        <ContactFields ref={contactRef} value={contact} onChange={setContact} phoneRequired disabled={processing} />

        <div style={{ margin: '1.25rem 0 0.75rem', padding: '0.875rem 1rem', borderRadius: '0.75rem', background: 'var(--color-sand)' }}>
          <p style={{ margin: 0, fontSize: '0.9375rem', color: 'var(--color-dark)' }}>
            {workshop.name}{own.passes.length > 1 && pass ? `, ${pass.label}` : ''} · {ticketsLabel}
          </p>
          <p data-testid="waitlist-price" style={{ margin: '0.125rem 0 0', fontSize: '0.875rem', color: 'var(--color-text)' }}>
            {waitlistPriceLine(most)}
          </p>
        </div>

        <PaymentForm bookingKind="workshop" mode="store" ref={paymentFormRef} onReadyChange={setPaymentReady} />

        <div style={{ marginTop: '1rem' }}>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.625rem', cursor: 'pointer', minHeight: '2.75rem' }}>
            <input
              ref={consentRef}
              type="checkbox"
              name="waitlist-consent"
              checked={consented}
              onChange={(e) => { setConsented(e.target.checked); if (e.target.checked) setConsentProblem(false) }}
              aria-invalid={consentProblem ? true : undefined}
              aria-describedby={consentProblem ? consentErrorId : undefined}
              style={{ marginTop: '0.2rem', width: '1.25rem', height: '1.25rem', flexShrink: 0, cursor: 'pointer', accentColor: 'var(--color-primary)' }}
            />
            <span style={{ fontSize: '0.9375rem', color: 'var(--color-dark)', lineHeight: 1.5 }} data-testid="waitlist-consent">
              {shownConsent?.text ?? ''}
            </span>
          </label>
          {consentProblem && <p id={consentErrorId} role="alert" className="field-error" style={{ marginTop: '0.375rem' }}>{WAITLIST_MESSAGES.consent}</p>}
          <p style={{ margin: '0.5rem 0 0', fontSize: '0.8125rem', color: 'var(--color-text)' }}>
            Once you’re added, the{' '}
            <a href={`${POLICY_PATH}#${POLICY_ANCHORS.workshops}`} target="_blank" rel="noopener" style={{ color: 'var(--color-primary)', fontWeight: 600, textDecoration: 'underline' }}>booking and cancellation policy</a>
            {' '}applies.
          </p>
        </div>
        {error && <p role="alert" className="field-error" style={{ marginTop: '0.875rem', fontSize: '0.9375rem', lineHeight: 1.5 }}>{error}</p>}
      </form>
    )
  }

  let footer
  if (joined) {
    footer = <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
  } else if (booked) {
    footer = <button type="button" className="btn btn-primary" onClick={finish}>Done</button>
  } else if (stuck) {
    footer = (
      <div style={{ display: 'grid', gap: '0.5rem' }}>
        {lastBody.current && (
          <button type="button" className="btn btn-primary" onClick={() => void checkAgain()} disabled={checking}>
            {checking ? 'Checking…' : 'Check again'}
          </button>
        )}
        <button type="button" className={lastBody.current ? 'btn btn-secondary' : 'btn btn-primary'} onClick={onClose} disabled={checking}>Close</button>
      </div>
    )
  } else if (step !== 'pay') {
    // The first step shows the seats' price before tax, once, on its button; tax only on the payment step
    // (Kaden, 1 Nov 2026: never "incl. tax" here). Later steps say just Continue; the Pay button carries the total.
    // A full class: nothing is paid on the way to the waitlist, so no price on the button (UI review, 3 Nov).
    const beforeTax = !waitlistMode && step === steps[0] && total > 0 && seatsOnly.ok ? seatsOnly.value.subtotalCents : null
    footer = (
      <button type="button" className="btn btn-primary" onClick={next}>
        {waitlistMode ? 'Continue to the waitlist' : beforeTax !== null ? `Continue · ${formatMoney(beforeTax, workshop.currency)}` : 'Continue'}
      </button>
    )
  } else if (waitlistMode) {
    footer = (
      <button type="submit" form={formId} className="btn btn-primary" disabled={processing || !paymentReady}>
        {processing ? 'Saving…' : !paymentReady ? 'Loading the card form…' : 'Join the waitlist'}
      </button>
    )
  } else {
    footer = (
      // The refund terms are in the tick box just above; the footer stays one button (UI review, 3 Nov).
      <button ref={payButtonRef} type="submit" form={formId} className="btn btn-primary" disabled={processing || applying || (!free && !paymentReady) || !shown}>
        {processing ? 'Processing…' : free ? 'Book it' : !paymentReady ? 'Loading payment form…' : `Pay ${formatMoney(shown?.totalCents ?? 0, workshop.currency)}`}
      </button>
    )
  }

  const firstSession = own.sessions.find((s) => (q?.sessionIds ?? picked)[0] === s.id) ?? own.sessions.find((s) => !s.closed) ?? own.sessions[0]
  const whenShort = choose && !picked.length ? '' : firstSession ? formatDayAndSpan(firstSession.startIso, firstSession.endIso) : ''
  return (
    <BookingPanel
      title={waitlistMode && !booked && !joined ? 'Join the waitlist' : workshop.name}
      onRequestClose={booked ? finish : stuck || joined ? onClose : requestClose}
      busy={processing ? (step === 'pay' && waitlistMode ? SAVING_CARD : PAYMENT_GOING_THROUGH) : null}
      stepKey={booked ? 'confirmed' : joined ? 'joined' : step === 'pay' && waitlistMode ? 'waitlist' : step}
      stepName={booked || joined ? undefined : step === 'pay' && waitlistMode ? WAITLIST_STEP_NAME : STEP_NAMES[step]}
      stepNumber={steps.indexOf(step) + 1}
      stepCount={steps.length}
      summary={
        booked || joined ? undefined : (
          <p style={{ margin: 0, fontSize: '0.9375rem', color: 'var(--color-dark)' }}>
            {[waitlistMode ? workshop.name : '', whenShort, (q?.sessionIds.length ?? 0) > 1 ? plural(q!.sessionIds.length, 'session') : '', ticketsLabel].filter(Boolean).join(' · ')}
          </p>
        )
      }
      onBack={!booked && !joined && !stuck && !processing ? (step !== 'details' ? back : door && onExit ? onExit : undefined) : undefined}
      footer={footer}
      leavePrompt={
        askToLeave && !booked && !joined
          ? {
              title: 'Leave without booking?',
              body: 'Nothing is saved until you pay.',
              keepLabel: 'Keep booking',
              leaveLabel: 'Close',
              onKeep: () => setAskToLeave(false),
              onLeave: closeAndRecord,
            }
          : null
      }
    >
      {joined ? renderJoined() : booked ? renderConfirmation() : stuck || checking ? (
        <p role="alert" style={{ margin: 0, fontSize: '0.9375rem', lineHeight: 1.6, color: 'var(--color-dark)' }}>{checking ? 'Checking…' : stuck}</p>
      ) : step === 'details' ? renderDetails() : step === 'seats' ? renderSeats() : waitlistMode ? renderWaitlist() : renderPay()}
    </BookingPanel>
  )
}
