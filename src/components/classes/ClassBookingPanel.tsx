import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { checkoutPolicySummary, POLICY_PATH, POLICY_ANCHORS } from '@config/policy-content'
import { STUDIO_ADDRESS, STUDIO_ADDRESS_LINE, STUDIO_DIRECTIONS_URL } from '@config/studio-address'
import { newAttemptId } from '@lib/checkout-attempt'
import { messageForFailure, outcomeUnknown, workshopMessages, UNKNOWN_OUTCOME_MESSAGE } from '@lib/checkout-messages'
import { contactStarted, EMPTY_CONTACT, type Contact } from '@lib/contact-rules'
import { rememberContact, rememberedContact } from '@lib/remembered-contact'
import { formatMoney } from '@lib/money'
import { googleCalendarUrl, buildIcs, icsDataUrl } from '@lib/party-share'
import { workshopRefundLine } from '@lib/refund-lines'
import { formatDayAndSpan } from '@lib/studio-time'
import { seatsLeftLabel } from '@lib/workshop-rules'
import { quote, type BookingRequest, type Quote } from '@lib/classes/pricing'
import { asScheduledClass, type OwnClassData, type PublicPass } from '@lib/classes/public-class'
import type { WorkshopData } from '@components/workshops/WorkshopExplorer'
import BookingPanel from '@components/shared/BookingPanel'
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
}

type Step = 'details' | 'seats' | 'pay'
const STEP_NAMES: Record<Step, string> = { details: 'Details', seats: 'For each person', pay: 'Your details and payment' }
const POLICY_UNTICKED = 'Tick the box to agree to the booking and cancellation policy.'

/** What the server says about a class booking it couldn't finish; its own sentence wins. */
const CLASS_MESSAGES = {
  ...workshopMessages,
  already_booked: 'You already have a seat in this class. Check your email for the confirmation.',
  not_open: 'This class isn’t open for booking. Nothing was charged.',
}

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
export default function ClassBookingPanel({ workshop, onClose, onBooked, onAvailability, syncUrl = true }: ClassBookingPanelProps) {
  const own = workshop.own!
  const cls = useMemo(() => asScheduledClass(own, workshop.name), [own, workshop.name])
  const shownPasses = own.passes.filter((p) => p.state !== 'closed')
  const firstOpen = shownPasses.find((p) => p.state === 'open') ?? shownPasses[0] ?? own.passes[0]

  const [step, setStep] = useState<Step>('details')
  const [passId, setPassId] = useState<string>(firstOpen?.id ?? '')
  const pass = own.passes.find((p) => p.id === passId) as PublicPass
  const choose = pass?.covers.kind === 'choose' ? pass.covers.count : 0
  const [picked, setPicked] = useState<string[]>([])
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

  const [initialContact] = useState<Contact>(() => rememberedContact() ?? EMPTY_CONTACT)
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

  const paymentFormRef = useRef<PaymentFormRef>(null)
  const contactRef = useRef<ContactFieldsHandle>(null)
  const policyRef = useRef<HTMLInputElement>(null)
  const formId = useId()
  const policyErrorId = useId()

  const types = soldTypes(passId)
  // Seats in ticket type order, each type repeated by its count (the order `quote` uses).
  const seatTypes = own.ticketTypes.flatMap((t) => Array.from({ length: counts[t.id] ?? 0 }, () => t))
  const total = seatTypes.length
  const needsSeats = own.questions.length > 0 || own.addOns.length > 0
  const steps: Step[] = needsSeats ? ['details', 'seats', 'pay'] : ['details', 'pay']
  /** Seat i (in ticket type order) → its ticket type and its place among that type. */
  const seatSlot = (i: number) => {
    const t = seatTypes[i]
    return { typeId: t.id, k: seatTypes.slice(0, i).filter((x) => x.id === t.id).length }
  }
  const seats = seatTypes.map((_, i) => {
    const { typeId, k } = seatSlot(i)
    return seatInfo[typeId]?.[k] ?? EMPTY_SEAT
  })

  // Seats left on every session this booking needs.
  const pickedSessions = own.sessions.filter((s) => picked.includes(s.id))
  const roomLeft = choose
    ? (pickedSessions.length ? Math.min(...pickedSessions.map((s) => s.left)) : pass.left)
    : pass?.left ?? 0
  const maxSeats = Math.max(0, Math.min(own.rules.maxPerBooking, roomLeft))

  const request: BookingRequest = {
    passId,
    ...(choose ? { sessionIds: picked } : {}),
    tickets: counts,
    ...(needsSeats ? { seats } : {}),
  }
  const now = new Date()
  const full = quote(cls, request, now, own.taxPercent)
  // Before each person's picks are in: the seats alone.
  const seatsOnly = quote({ ...cls, content: { ...cls.content, questions: [], addOns: [] } }, { ...request, seats: undefined }, now, own.taxPercent)
  const q: Quote | null = full.ok ? full.value : null

  // One attempt id per checkout. While we don't know how a try ended, a retry
  // sends the same id, so the server can never charge twice. Changing what is
  // being booked starts a new one.
  const attemptId = useRef(newAttemptId())
  const shape = JSON.stringify([passId, picked, counts, seats])
  useEffect(() => {
    attemptId.current = newAttemptId()
  }, [shape])

  const classItem = (quantity = Math.max(1, total)): AnalyticsItem => ({
    item_id: own.classId, item_name: workshop.name, item_category: 'class', price: workshop.price / 100, quantity,
  })

  useEffect(() => {
    trackWizardStarted('workshop')
    trackViewItem(classItem(1))
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
      const still = p.filter((id) => own.sessions.some((s) => s.id === id && !s.closed && s.left > 0))
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
      const res = await fetch(`/api/classes/${encodeURIComponent(own.classId)}.json`, { cache: 'no-store' })
      if (!res.ok) return
      const fresh = (await res.json().catch(() => null))?.workshop?.own as OwnClassData | undefined
      if (fresh) onAvailability?.(fresh)
    } catch {
      // The sold-out message stands on its own.
    }
  }

  function choosePass(id: string) {
    if (id === passId) return
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
    : own.ticketTypes.filter((t) => (counts[t.id] ?? 0) > 0).map((t) => plural(counts[t.id], t.label)).join(', ')

  /** The details step is in order: says what isn't. */
  function detailsReady(): boolean {
    if (!pass || pass.state !== 'open') {
      setProblem('Pick an option that still has seats.')
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
      trackWizardStepCompleted('details')
      if (!needsSeats) trackBeginCheckout('workshop', (q?.totalCents ?? 0) / 100, [classItem()], { seats: total })
      setStep(needsSeats ? 'seats' : 'pay')
    } else if (step === 'seats') {
      if (!full.ok) {
        setProblem(full.error)
        return
      }
      trackWizardStepCompleted('seats')
      trackBeginCheckout('workshop', full.value.totalCents / 100, [classItem()], { seats: total })
      setStep('pay')
    }
    setProblem(null)
  }

  function back() {
    setError(null)
    setStep(steps[Math.max(0, steps.indexOf(step) - 1)])
  }

  function closeAndRecord() {
    if (!booked) trackBookingAbandoned('workshop', step, { class: workshop.name, seats: total, class_id: own.classId })
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

  /** `walletToken`: Apple Pay or Google Pay already approved the payment. */
  async function handlePay(e?: FormEvent, walletToken?: string) {
    e?.preventDefault()
    if (processing || (!walletToken && !paymentReady)) return
    if (!readyToPay() || !q) return
    setError(null)
    setProcessing(true)
    trackPaymentStarted(q.totalCents / 100)
    try {
      // One order, one charge: one token pays for every seat.
      let token: string
      let sourceKind: 'card' | 'gift_card' | 'wallet'
      if (walletToken) {
        token = walletToken
        sourceKind = 'wallet'
      } else {
        try {
          const t = await paymentFormRef.current!.tokenize()
          token = t.token
          sourceKind = t.kind
        } catch {
          trackBookingProblem('workshop', 'card_unreadable')
          throw new Error('We couldn’t read that card. Check the number, date and code, then try again. Nothing was charged.')
        }
      }
      trackAddPaymentInfo('workshop', q.totalCents / 100, sourceKind)

      let res: Response
      try {
        res = await fetch('/api/classes/book.json', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            classId: own.classId,
            passId,
            sessionIds: choose ? picked : [],
            tickets: counts,
            seats,
            attemptId: attemptId.current,
            paymentToken: token,
            customer: {
              givenName: contact.firstName.trim(),
              familyName: contact.lastName.trim(),
              email: contact.email.trim(),
              phone: contact.phone.trim(),
            },
            attribution: readAttribution(),
            posthogId: posthogId(),
            sourceKind,
          }),
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
        const keep = outcomeUnknown(failure) || body?.code === 'in_progress'
        if (!keep) attemptId.current = newAttemptId()
        if (body?.code) trackBookingProblem('workshop', String(body.code))
        const message = messageForFailure(failure, CLASS_MESSAGES)
        if (keep) {
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
      identifyBooker(contact.email, contact.firstName, contact.lastName)
      rememberContact(contact)
      const paid = (charged ?? q.totalCents) / 100
      trackPaymentCompleted(paid, {
        kind: 'workshop',
        transactionId: data.bookingId ?? null,
        items: [classItem()],
        extra: { seats: total, class: workshop.name, class_id: own.classId },
      })
      trackWorkshopSeatBooked(workshop.name, paid)
      trackBookingCompleted('workshop')
    } catch (err) {
      trackPaymentFailed(err instanceof Error ? err.message : 'unknown')
      setError(err instanceof Error ? err.message : workshopMessages.unavailable)
    } finally {
      setProcessing(false)
    }
  }

  // ── Booked ────────────────────────────────────────────────────────────────
  function renderConfirmation() {
    const b = booked!
    const origin = window.location.origin
    const waiverUrl = b.bookingId
      ? `${origin}/waiver?workshop=${encodeURIComponent(own.classId)}&booking=${encodeURIComponent(b.bookingId)}`
      : `${origin}/waiver`
    const sessions = own.sessions.filter((s) => b.sessionIds.includes(s.id))
    const one = sessions.length === 1 ? sessions[0] : null
    const calendarEvent = one && {
      title: `${workshop.name} at ${STUDIO_ADDRESS.name}`,
      startIso: one.startIso,
      endIso: one.endIso,
      details: `Your class at ${STUDIO_ADDRESS.name}.\n\nSign the participation agreement before you come. ${waiverUrl}`,
      location: `${STUDIO_ADDRESS.name}, ${STUDIO_ADDRESS_LINE}`,
    }
    const paid = b.chargedCents ?? q?.totalCents ?? 0
    return (
      <BookingConfirmed
        heading="You’re booked"
        what={
          <>
            {b.ticketsLabel ?? ticketsLabel} for <strong>{workshop.name}</strong>, {formatMoney(paid, workshop.currency)} paid{own.taxPercent > 0 ? ', tax included' : ''}.
          </>
        }
        email={contact.email.trim()}
        emailSent={b.emailSent}
        onEmailChanged={(nextEmail) => rememberContact({ ...contact, email: nextEmail })}
      >
        <div style={{ marginTop: '1.25rem' }}>
          <ConfirmedBlock label="When">
            {sessions.map((s) => (
              <div key={s.id}><strong>{formatDayAndSpan(s.startIso, s.endIso)}</strong></div>
            ))}
            {calendarEvent && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem 1rem', marginTop: '0.25rem' }}>
                <a href={googleCalendarUrl(calendarEvent)} target="_blank" rel="noopener noreferrer" className="btn btn-quiet" style={{ width: 'auto' }} onClick={() => trackAddToCalendar('confirmation', 'google', 'workshop')}>
                  Add to Google Calendar
                </a>
                <a href={icsDataUrl(buildIcs(calendarEvent))} download="hometown-class.ics" className="btn btn-quiet" style={{ width: 'auto' }} onClick={() => trackAddToCalendar('confirmation', 'ics', 'workshop')}>
                  Apple or Outlook
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
            <a href={waiverUrl} target="_blank" rel="noopener noreferrer" className="btn btn-primary" onClick={() => trackWaiverLinkClick('workshop_confirmation')}>
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

  // ── Step 1: what, which pass and days, how many ───────────────────────────
  function renderDetails() {
    const paragraphs = workshop.description.split(/\n\s*\n|\n/).map((p) => p.trim()).filter(Boolean)
    const meta = [own.rules.ages, own.rules.dropOff ? 'Drop-off' : '', own.instructor ? `With ${own.instructor}` : ''].filter(Boolean).join(' · ')
    const passSessions = !choose && pass?.sessionIds ? own.sessions.filter((s) => pass.sessionIds!.includes(s.id)) : []
    const left = seatsLeftLabel(roomLeft)
    return (
      <div>
        {workshop.imageUrl && (
          <img src={workshop.imageUrl} alt={workshop.name} style={{ display: 'block', width: '100%', maxHeight: '16rem', objectFit: 'cover', borderRadius: '0.75rem', background: 'var(--color-sand)', marginBottom: '1rem' }} />
        )}
        {meta && <p style={{ margin: '0 0 0.75rem', fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-muted)' }}>{meta}</p>}
        {paragraphs.map((p, i) => (
          <p key={i} style={{ margin: '0 0 0.75rem', fontSize: '0.9375rem', lineHeight: 1.6, color: 'var(--color-text)' }}>{p}</p>
        ))}

        <div style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid var(--color-line)', display: 'grid', gap: '1.25rem' }}>
          {shownPasses.length > 1 && (
            <div role="group" aria-label="Choose an option" style={{ display: 'grid', gap: '0.5rem' }}>
              {shownPasses.map((p) => {
                const prices = soldTypes(p.id).map((t) => own.prices[p.id][t.id])
                const from = Math.min(...prices)
                const open = p.state === 'open'
                return (
                  <button key={p.id} type="button" aria-pressed={p.id === passId} disabled={!open} onClick={() => choosePass(p.id)} style={choiceButton(p.id === passId, open)}>
                    <span style={{ fontWeight: 600 }}>{p.label}</span>
                    <span style={{ fontSize: '0.875rem', color: 'var(--color-text)' }}>
                      {open ? `${new Set(prices).size > 1 ? 'From ' : ''}${formatMoney(from, workshop.currency)}` : 'Sold out'}
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
                  const enabled = s.left > 0
                  return (
                    <button key={s.id} type="button" aria-pressed={on} disabled={!enabled} onClick={() => toggleSession(s.id)} style={choiceButton(on, enabled)}>
                      <span>{formatDayAndSpan(s.startIso, s.endIso)}</span>
                      <span style={{ fontSize: '0.8125rem', color: 'var(--color-text)' }}>{enabled ? seatsLeftLabel(s.left) : 'Sold out'}</span>
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
          {passSessions.length === 1 && (
            <p style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 600, color: 'var(--color-dark)' }}>{formatDayAndSpan(passSessions[0].startIso, passSessions[0].endIso)}</p>
          )}

          <div style={{ display: 'grid', gap: '0.75rem' }}>
            {types.map((t) => {
              const n = counts[t.id] ?? 0
              const word = own.ticketTypes.length <= 1 ? 'Seats' : `${t.label}s`
              return (
                <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                  <div>
                    <p style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 600, color: 'var(--color-dark)' }}>{word}</p>
                    <p style={{ margin: '0.125rem 0 0', fontSize: '0.875rem', color: 'var(--color-text)' }}>{formatMoney(own.prices[passId][t.id], workshop.currency)} each</p>
                  </div>
                  <Counter
                    label={word.toLowerCase()}
                    value={n}
                    spoken={plural(n, own.ticketTypes.length <= 1 ? 'seat' : t.label)}
                    canLess={n > 0}
                    canMore={total < maxSeats}
                    onLess={() => { setProblem(null); setCounts((c) => ({ ...c, [t.id]: Math.max(0, (c[t.id] ?? 0) - 1) })) }}
                    onMore={() => { setProblem(null); setCounts((c) => ({ ...c, [t.id]: (c[t.id] ?? 0) + 1 })) }}
                  />
                </div>
              )
            })}
            {left && <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--color-text)' }}>{left}</p>}
            {total >= maxSeats && maxSeats > 0 && (
              <p role="status" style={{ margin: 0, fontSize: '0.875rem', color: 'var(--color-text)' }}>
                {maxSeats >= own.rules.maxPerBooking && roomLeft > maxSeats
                  ? `One booking holds up to ${plural(own.rules.maxPerBooking, 'seat')}.`
                  : 'That’s every seat left.'}
              </p>
            )}
          </div>
        </div>
        {problem && <p role="alert" className="field-error" style={{ marginTop: '0.75rem' }}>{problem}</p>}
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
            {own.questions.map((qu) => {
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
    const lines = q?.lines ?? []
    // "2 Adults × $20" and "1 Glitter × $3": seats by ticket type, extras by name.
    const groups = new Map<string, { label: string; n: number; each: number; seat: boolean }>()
    for (const l of lines) {
      const key = `${l.kind}:${l.kind === 'seat' ? l.ticketTypeId : l.label}:${l.cents}`
      const g = groups.get(key) ?? { label: l.label, n: 0, each: l.cents, seat: l.kind === 'seat' }
      g.n++
      groups.set(key, g)
    }
    return (
      <form id={formId} onSubmit={handlePay} noValidate>
        <ContactFields ref={contactRef} value={contact} onChange={setContact} phoneRequired disabled={processing} />

        <div style={{ margin: '1.25rem 0', padding: '0.875rem 1rem', borderRadius: '0.75rem', background: 'var(--color-sand)' }}>
          <p style={{ margin: 0, fontSize: '0.9375rem', color: 'var(--color-dark)' }}>
            {workshop.name}{own.passes.length > 1 && pass ? `, ${pass.label}` : ''}
          </p>
          {[...groups.values()].map((g, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', fontSize: '0.875rem', color: 'var(--color-text)', marginTop: '0.125rem' }}>
              <span>
                {g.seat && own.ticketTypes.length <= 1 ? plural(g.n, 'seat') : `${g.n} ${g.seat && g.n !== 1 ? `${g.label}s` : g.label}`} × {formatMoney(g.each, workshop.currency)}
              </span>
              <span>{formatMoney(g.each * g.n, workshop.currency)}</span>
            </div>
          ))}
          {q && q.taxCents > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', fontSize: '0.875rem', color: 'var(--color-text)', marginTop: '0.25rem' }}>
              <span>Tax</span>
              <span>{formatMoney(q.taxCents, workshop.currency)}</span>
            </div>
          )}
          {/* No total line here: the Pay button says it (Kaden, 18 Oct 2026). */}
        </div>

        <PaymentForm
          bookingKind="workshop"
          ref={paymentFormRef}
          wallet={q ? { amount: (q.totalCents / 100).toFixed(2), label: `Hometown Studio, ${workshop.name}` } : undefined}
          onWalletToken={(token) => handlePay(undefined, token)}
          canPayWithWallet={() => (readyToPay() ? null : 'Add the details marked above first.')}
          onReadyChange={setPaymentReady}
        />

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

        {error && (
          <p role="alert" className="field-error" style={{ marginTop: '0.875rem', fontSize: '0.9375rem', lineHeight: 1.5 }}>{error}</p>
        )}
      </form>
    )
  }

  let footer
  if (booked) {
    footer = <button type="button" className="btn btn-primary" onClick={finish}>Done</button>
  } else if (stuck) {
    footer = <button type="button" className="btn btn-primary" onClick={onClose}>Close</button>
  } else if (step !== 'pay') {
    // No total here: only the Pay button carries it.
    footer = <button type="button" className="btn btn-primary" onClick={next}>Continue</button>
  } else {
    footer = (
      <>
        <button type="submit" form={formId} className="btn btn-primary" disabled={processing || !paymentReady || !q}>
          {processing ? 'Processing…' : !paymentReady ? 'Loading payment form…' : `Pay ${formatMoney(q?.totalCents ?? 0, workshop.currency)}`}
        </button>
        <p style={{ margin: '0.5rem 0 0', textAlign: 'center', fontSize: '0.8125rem', lineHeight: 1.4, color: 'var(--color-text)' }}>{workshopRefundLine()}</p>
      </>
    )
  }

  const firstSession = own.sessions.find((s) => (q?.sessionIds ?? picked)[0] === s.id) ?? own.sessions.find((s) => !s.closed) ?? own.sessions[0]
  const whenShort = choose && !picked.length ? '' : firstSession ? formatDayAndSpan(firstSession.startIso, firstSession.endIso) : ''
  return (
    <BookingPanel
      title={workshop.name}
      onRequestClose={booked ? finish : stuck ? onClose : requestClose}
      stepKey={booked ? 'confirmed' : step}
      stepName={booked ? undefined : STEP_NAMES[step]}
      stepNumber={steps.indexOf(step) + 1}
      stepCount={steps.length}
      summary={
        booked ? undefined : (
          <p style={{ margin: 0, fontSize: '0.9375rem', color: 'var(--color-dark)' }}>
            {[whenShort, (q?.sessionIds.length ?? 0) > 1 ? plural(q!.sessionIds.length, 'session') : '', ticketsLabel].filter(Boolean).join(' · ')}
          </p>
        )
      }
      onBack={!booked && !stuck && step !== 'details' && !processing ? back : undefined}
      footer={footer}
      leavePrompt={
        askToLeave && !booked
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
      {booked ? renderConfirmation() : stuck ? (
        <p role="alert" style={{ margin: 0, fontSize: '0.9375rem', lineHeight: 1.6, color: 'var(--color-dark)' }}>{stuck}</p>
      ) : step === 'details' ? renderDetails() : step === 'seats' ? renderSeats() : renderPay()}
    </BookingPanel>
  )
}
