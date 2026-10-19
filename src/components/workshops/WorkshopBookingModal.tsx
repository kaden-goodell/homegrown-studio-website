import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { CLASS_BOOKING_APP_ID, MAX_SEATS_PER_BOOKING } from '@config/class-booking.config'
import { checkoutPolicySummary, POLICY_PATH, POLICY_ANCHORS } from '@config/policy-content'
import { STUDIO_ADDRESS, STUDIO_ADDRESS_LINE, STUDIO_DIRECTIONS_URL } from '@config/studio-address'
import { newAttemptId } from '@lib/checkout-attempt'
import { messageForFailure, outcomeUnknown, workshopMessages, UNKNOWN_OUTCOME_MESSAGE } from '@lib/checkout-messages'
import { contactStarted, EMPTY_CONTACT, type Contact } from '@lib/contact-rules'
import { rememberContact, rememberedContact } from '@lib/remembered-contact'
import { seatsTaxCents } from '@lib/tax'
import { formatMoney } from '@lib/money'
import { googleCalendarUrl, buildIcs, icsDataUrl } from '@lib/party-share'
import { workshopRefundLine } from '@lib/refund-lines'
import { formatDayAndSpan } from '@lib/studio-time'
import { seatsLeftLabel } from '@lib/workshop-rules'
import { firstMissingPick, picksFromSelections, picksNote, selectionKey, PICKS_FINAL_LINE } from '@lib/seat-options'
import type { WorkshopData } from './WorkshopExplorer'
import BookingPanel from '@components/shared/BookingPanel'
import BookingConfirmed, { ConfirmedBlock } from '@components/shared/BookingConfirmed'
import ContactFields, { type ContactFieldsHandle } from '@components/shared/ContactFields'
import type { EmailCheckData } from '@components/shared/EmailCheck'
import ShareLink from '@components/shared/ShareLink'
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
import NewClassesSignup from './NewClassesSignup'

interface WorkshopBookingModalProps {
  workshop: WorkshopData
  onClose: () => void
  /** Called once a booking has gone through, with the seats bought, so the list can show what is left. */
  onBooked?: (seats: number) => void
}

type Step = 'details' | 'pay'
const STEP_NAMES: Record<Step, string> = { details: 'Details', pay: 'Your details and payment' }

const POLICY_UNTICKED = 'Tick the box to agree to the booking and cancellation policy.'

/**
 * Booking a workshop seat, in two steps:
 *   1. Details: what it is, when, how many seats.
 *   2. Your details and payment.
 * The workshop's name, date, seats and total stay in view throughout.
 */
export default function WorkshopBookingModal({ workshop, onClose, onBooked }: WorkshopBookingModalProps) {
  const [step, setStep] = useState<Step>('details')
  const [plainSeats, setSeats] = useState(1)
  // Ticket types (Adult / Kid): a count per type, starting at each type's minimum.
  const tickets = workshop.tickets && workshop.tickets.length > 0 ? workshop.tickets : null
  const [ticketCounts, setTicketCounts] = useState<Record<string, number>>(() =>
    Object.fromEntries((tickets ?? []).map((t) => [t.id, t.min])),
  )
  const seats = tickets ? tickets.reduce((n, t) => n + (ticketCounts[t.id] ?? 0), 0) : plainSeats
  // "Adult", "Kid", "Kid" — who each seat is, for the pick labels.
  const seatTypeLabels = tickets ? tickets.flatMap((t) => Array.from({ length: ticketCounts[t.id] ?? 0 }, () => t.label)) : null
  const ticketsLabel = tickets
    ? tickets.filter((t) => (ticketCounts[t.id] ?? 0) > 0).map((t) => `${ticketCounts[t.id]} ${ticketCounts[t.id] === 1 ? t.label : `${t.label}s`}`).join(', ')
    : null
  const [bookedLabel, setBookedLabel] = useState<string | null>(null)
  // One answer per seat per question, keyed by selectionKey(seat, optionId).
  // Kept when the seat count drops, so a seat added back shows its pick.
  const [selections, setSelections] = useState<Record<string, string>>({})
  const [pickProblem, setPickProblem] = useState<string | null>(null)
  // A second class this visit starts with the first booking's details.
  const [initialContact] = useState<Contact>(() => rememberedContact() ?? EMPTY_CONTACT)
  const [contact, setContact] = useState<Contact>(initialContact)
  const [agreedToPolicy, setAgreedToPolicy] = useState(false)
  const [policyProblem, setPolicyProblem] = useState(false)

  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [paymentReady, setPaymentReady] = useState(false)
  const [completed, setCompleted] = useState(false)
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null)
  const [bookingId, setBookingId] = useState<string | null>(null)
  const [emailSent, setEmailSent] = useState(false)
  const [emailCheck, setEmailCheck] = useState<EmailCheckData | null>(null)
  const [askToLeave, setAskToLeave] = useState(false)

  const paymentFormRef = useRef<PaymentFormRef>(null)
  const contactRef = useRef<ContactFieldsHandle>(null)
  const policyRef = useRef<HTMLInputElement>(null)
  const formId = useId()
  const policyErrorId = useId()

  const options = workshop.options ?? []
  const picks = picksFromSelections(options, seats, selections)
  const picksSignature = JSON.stringify(picks)
  const pickFieldId = (seat: number, optionId: string) => `${formId}-pick-${seat}-${optionId}`

  // One attempt ID per checkout. While we don't know how a try ended (dropped
  // connection, "we're not sure"), a retry sends the same ID, so the server
  // can never charge twice for it. Changing the seats or a pick, or a plain
  // "nothing was charged", starts a new one.
  const attemptId = useRef(newAttemptId())
  useEffect(() => {
    attemptId.current = newAttemptId()
  }, [seats, picksSignature, JSON.stringify(ticketCounts)])

  useEffect(() => {
    trackWizardStarted('workshop')
    trackViewItem(classItem(1))
  }, [])

  // The address always names the open workshop, so it can be copied and sent.
  useEffect(() => {
    const url = new URL(window.location.href)
    const before = url.searchParams.get('w')
    if (before !== workshop.id) {
      url.searchParams.set('w', workshop.id)
      window.history.replaceState(window.history.state, '', url)
    }
    return () => {
      const after = new URL(window.location.href)
      after.searchParams.delete('w')
      window.history.replaceState(window.history.state, '', after)
    }
  }, [workshop.id])

  // The most seats on offer: what's left in the class, and never more than one booking can hold.
  const maxSeats = Math.max(1, Math.min(workshop.remainingSeats ?? MAX_SEATS_PER_BOOKING, MAX_SEATS_PER_BOOKING))
  const cappedByBooking = (workshop.remainingSeats ?? Infinity) > MAX_SEATS_PER_BOOKING
  // Square adds its sales tax on top of the price; show it before they pay.
  const subtotal = tickets ? tickets.reduce((sum, t) => sum + t.priceCents * (ticketCounts[t.id] ?? 0), 0) : workshop.price * seats
  // Every seat is its own Square charge, taxed and rounded on its own.
  const seatPrices = tickets
    ? tickets.flatMap((t) => Array.from({ length: ticketCounts[t.id] ?? 0 }, () => t.priceCents))
    : Array.from({ length: seats }, () => workshop.price)
  const tax = seatsTaxCents(seatPrices, workshop.taxPercent)
  const total = subtotal + tax
  const taxKnown = typeof workshop.taxPercent === 'number'
  const totalLabel = tax > 0 ? `${formatMoney(total, workshop.currency)} incl. tax` : formatMoney(total, workshop.currency)
  const [chargedCents, setChargedCents] = useState<number | null>(null)
  const [partly, setPartly] = useState<{ booked: number; asked: number } | null>(null)
  const when = formatDayAndSpan(workshop.startTime, workshop.endTime)
  const seatWord = bookedLabel ?? ticketsLabel ?? `${seats} seat${seats === 1 ? '' : 's'}`

  const classItem = (quantity = seats): AnalyticsItem => ({
    item_id: workshop.classScheduleId ?? workshop.id, item_name: workshop.name, item_category: 'workshop', price: workshop.price / 100, quantity,
  })
  /** Close without booking: say where they stopped (the funnel's drop-off). */
  function closeAndRecord() {
    if (!completed) trackBookingAbandoned('workshop', step, { class: workshop.name, seats })
    onClose()
  }

  // Closing asks first only once there is something to lose.
  // (Details filled in from an earlier booking aren't anything to lose.)
  const started = seats !== 1 || (contact !== initialContact && contactStarted(contact)) || Object.keys(selections).length > 0
  function requestClose() {
    if (completed || !started) return closeAndRecord()
    setAskToLeave(true)
  }

  function finish() {
    onBooked?.(seats)
    onClose()
  }

  /** Every seat answers every question before payment. Says which is missing and goes to it. */
  function picksComplete(afterStepChange = false): boolean {
    const missing = firstMissingPick(options, seats, selections)
    if (!missing) return true
    setPickProblem(`Pick a ${missing.option.label.toLowerCase()} for seat ${missing.seat}.`)
    const focusIt = () => document.getElementById(pickFieldId(missing.seat, missing.option.id))?.focus()
    // From the pay step the select is not on screen until the details step has rendered.
    if (afterStepChange) setTimeout(focusIt, 0)
    else focusIt()
    return false
  }

  /** Everything but the payment itself is in order. Says what's missing, field by field, and goes to the first one. */
  function readyToPay(): boolean {
    if (!picksComplete(true)) {
      setStep('details')
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

  /** `walletToken`: Google Pay (or Apple Pay, if Square ever allows it here) already approved the payment. */
  async function handlePay(e?: FormEvent, walletToken?: string) {
    e?.preventDefault()
    if (processing || (!walletToken && !paymentReady)) return
    if (!readyToPay()) return

    setError(null)
    setProcessing(true)
    trackPaymentStarted(total / 100)

    try {
      // Square books and charges each seat on its own, and a card token pays
      // once, so the card form makes one token per seat (same card, typed once).
      const tokens: string[] = []
      let sourceKind: 'card' | 'gift_card' | 'wallet'
      if (walletToken) {
        tokens.push(walletToken)
        sourceKind = 'wallet'
      } else {
        try {
          sourceKind = 'card'
          for (let seat = 1; seat <= seats; seat++) {
            const tokenized = await paymentFormRef.current!.tokenize()
            tokens.push(tokenized.token)
            sourceKind = tokenized.kind
          }
        } catch {
          trackBookingProblem('workshop', 'card_unreadable')
          throw new Error('We couldn’t read that card. Check the number, date and code, then try again. Nothing was charged.')
        }
        if (new Set(tokens).size !== tokens.length) {
          trackBookingProblem('workshop', 'card_unreadable')
          throw new Error('We couldn’t set up a payment for every seat. Nothing was charged. Please try again.')
        }
      }

      trackAddPaymentInfo('workshop', total / 100, sourceKind)
      let bookRes: Response
      try {
        bookRes = await fetch('/api/workshops/book.json', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            attemptId: attemptId.current,
            workshopId: workshop.id,
            classScheduleId: workshop.classScheduleId,
            startAt: workshop.startTime,
            customer: {
              givenName: contact.firstName.trim(),
              familyName: contact.lastName.trim(),
              email: contact.email.trim(),
              ...(contact.phone.trim() ? { phone: contact.phone.trim() } : {}),
            },
            seats,
            ...(tickets ? { tickets: ticketCounts } : {}),
            ...(options.length > 0 ? { picks } : {}),
            attribution: readAttribution(),
            posthogId: posthogId(),
            paymentTokens: tokens,
            sourceKind,
          }),
        })
      } catch {
        // The request left and nothing came back. It may have gone through.
        throw new Error(UNKNOWN_OUTCOME_MESSAGE)
      }

      if (!bookRes.ok) {
        const errData = await bookRes.json().catch(() => null)
        const failure = { status: bookRes.status, body: errData }
        // We were told plainly what happened (declined, class full…): that
        // attempt is over, and the next try is a new one.
        if (!outcomeUnknown(failure)) attemptId.current = newAttemptId()
        throw new Error(messageForFailure(failure, workshopMessages))
      }

      const bookData = await bookRes.json().catch(() => null)
      // A success we can't read is still not a failure we can vouch for.
      if (!bookData?.data) throw new Error(UNKNOWN_OUTCOME_MESSAGE)
      setReceiptUrl(bookData.data.receiptUrl ?? null)
      setBookingId(bookData.data.bookingId ?? null)
      setEmailSent(bookData.data.emailSent === true)
      setEmailCheck(bookData.data.emailCheck ?? null)
      if (typeof bookData.data.totalChargedCents === 'number') setChargedCents(bookData.data.totalChargedCents)
      // A later seat can be declined after the first is paid: show what was booked.
      const booked = bookData.data.seatsBooked
      if (typeof bookData.data.ticketsLabel === 'string') setBookedLabel(bookData.data.ticketsLabel)
      if (typeof booked === 'number' && booked >= 1 && booked < seats) {
        setPartly({ booked, asked: seats })
        setSeats(booked)
      }
      setAskToLeave(false)
      setCompleted(true)
      identifyBooker(contact.email, contact.firstName, contact.lastName)
      rememberContact(contact)
      trackPaymentCompleted(total / 100, {
        kind: 'workshop',
        transactionId: bookData.data.bookingId ?? null,
        items: [classItem()],
        extra: { seats, class: workshop.name },
      })
      trackWorkshopSeatBooked(workshop.name, total / 100)
      trackBookingCompleted('workshop')
    } catch (err) {
      trackPaymentFailed(err instanceof Error ? err.message : 'unknown')
      setError(err instanceof Error ? err.message : workshopMessages.unavailable)
    } finally {
      setProcessing(false)
    }
  }

  // ── Confirmation ──────────────────────────────────────────────────────────
  function renderConfirmation() {
    const origin = window.location.origin
    // The waiver resolves the class by its SCHEDULE id; the per-seat booking
    // id rides along as `booking` so staff can trace a signature to its seat.
    const waiverUrl =
      bookingId && workshop.classScheduleId
        ? `${origin}/waiver?workshop=${encodeURIComponent(workshop.classScheduleId)}&booking=${encodeURIComponent(bookingId)}`
        : `${origin}/waiver`
    const workshopUrl = `${origin}/workshops?w=${encodeURIComponent(workshop.id)}`
    const calendarEvent = {
      title: `${workshop.name} at ${STUDIO_ADDRESS.name}`,
      startIso: workshop.startTime,
      endIso: workshop.endTime,
      details: `Your workshop at ${STUDIO_ADDRESS.name}.\n\nSign the participation agreement before you come: ${waiverUrl}`,
      location: `${STUDIO_ADDRESS.name}, ${STUDIO_ADDRESS_LINE}`,
    }
    return (
      <BookingConfirmed
        heading="You’re booked"
        what={
          <>
            {seatWord} for <strong>{workshop.name}</strong>, {formatMoney(chargedCents ?? total, workshop.currency)} paid{tax > 0 || (chargedCents ?? 0) > subtotal ? ', tax included' : ''}.
            {partly && (
              <>
                {' '}
                <strong>
                  You asked for {partly.asked} seats. {partly.asked - partly.booked === 1 ? '1 didn’t' : `${partly.asked - partly.booked} didn’t`} go through, so {partly.asked - partly.booked === 1 ? 'it wasn’t' : 'they weren’t'} booked or charged.
                </strong>
              </>
            )}
          </>
        }
        email={contact.email.trim()}
        emailSent={emailSent}
        emailCheck={emailCheck}
        onEmailChanged={(next) => rememberContact({ ...contact, email: next })}
      >
        <div style={{ marginTop: '1.25rem' }}>
          <ConfirmedBlock label="When">
            <strong>{when}</strong>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem 1rem', marginTop: '0.25rem' }}>
              <a href={googleCalendarUrl(calendarEvent)} target="_blank" rel="noopener noreferrer" className="btn btn-quiet" style={{ width: 'auto' }} onClick={() => trackAddToCalendar('confirmation', 'google', 'workshop')}>
                Add to Google Calendar
              </a>
              <a href={icsDataUrl(buildIcs(calendarEvent))} download="hometown-workshop.ics" className="btn btn-quiet" style={{ width: 'auto' }} onClick={() => trackAddToCalendar('confirmation', 'ics', 'workshop')}>
                Apple or Outlook
              </a>
            </div>
          </ConfirmedBlock>

          <ConfirmedBlock label="Where">
            {STUDIO_ADDRESS.name}, {STUDIO_ADDRESS_LINE}
            <div>
              <a href={STUDIO_DIRECTIONS_URL} target="_blank" rel="noopener noreferrer" className="btn btn-quiet" style={{ width: 'auto' }}>
                Get directions
              </a>
            </div>
          </ConfirmedBlock>

          {picks.length > 0 && (
            <ConfirmedBlock label="Your picks">
              {picksNote(options, picks)}
              <p style={{ margin: '0.25rem 0 0' }}>{PICKS_FINAL_LINE}</p>
            </ConfirmedBlock>
          )}
          <ConfirmedBlock label="Before you come">
            <p style={{ margin: '0 0 0.625rem' }}>Sign the participation agreement. It takes a minute, and saves doing it at the door.</p>
            <a href={waiverUrl} target="_blank" rel="noopener noreferrer" className="btn btn-primary" onClick={() => trackWaiverLinkClick('workshop_confirmation')}>
              Sign the agreement
            </a>
            {seats > 1 && (
              <div style={{ marginTop: '0.875rem' }}>
                <p style={{ margin: '0 0 0.5rem' }}>Coming with friends? Send them this link so they can sign before they arrive.</p>
                <ShareLink
                  url={waiverUrl}
                  label="Send the link"
                  shareTitle={`${workshop.name} at ${STUDIO_ADDRESS.name}`}
                  shareText={`I booked us into ${workshop.name}, ${when}. Sign this before we go:`}
                  contentType="workshop_waiver"
                  itemId={workshop.id}
                />
              </div>
            )}
          </ConfirmedBlock>

          <ConfirmedBlock label="Changing plans">{workshopRefundLine()}</ConfirmedBlock>

          <ConfirmedBlock label="Bring a friend">
            <p style={{ margin: '0 0 0.5rem' }}>Know someone who’d love this? Send them the workshop.</p>
            <ShareLink
              url={workshopUrl}
              label="Share this workshop"
              shareTitle={`${workshop.name} at ${STUDIO_ADDRESS.name}`}
              shareText={`I’m going to ${workshop.name}, ${when}. Come with me:`}
              contentType="workshop"
              itemId={workshop.id}
            />
          </ConfirmedBlock>

          {receiptUrl && (
            <ConfirmedBlock label="Receipt">
              <a href={receiptUrl} target="_blank" rel="noopener noreferrer" className="btn btn-quiet" style={{ width: 'auto' }}>
                View your receipt
              </a>
            </ConfirmedBlock>
          )}
        </div>
      </BookingConfirmed>
    )
  }

  // ── Step 1: details and seats ─────────────────────────────────────────────
  function renderDetails() {
    const paragraphs = workshop.description.split(/\n\s*\n|\n/).map((p) => p.trim()).filter(Boolean)
    const photo = workshop.flyerUrl ?? workshop.imageUrl
    const seatsLeft = seatsLeftLabel(workshop.remainingSeats)
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
    return (
      <div>
        {photo && (
          <img
            src={photo}
            alt={workshop.name}
            style={{
              display: 'block',
              width: '100%',
              // A tall flyer must not push everything else off the screen.
              maxHeight: '16rem',
              objectFit: workshop.flyerUrl ? 'contain' : 'cover',
              borderRadius: '0.75rem',
              background: 'var(--color-sand)',
              marginBottom: '1rem',
            }}
          />
        )}
        {paragraphs.map((p, i) => (
          <p key={i} style={{ margin: '0 0 0.75rem', fontSize: '0.9375rem', lineHeight: 1.6, color: 'var(--color-text)' }}>
            {p}
          </p>
        ))}

        <div style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid var(--color-line)' }}>
          {tickets ? (
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              {tickets.map((t) => {
                const n = ticketCounts[t.id] ?? 0
                const canLess = n > t.min
                const canMore = seats < maxSeats
                const labelId = `${formId}-ticket-${t.id}`
                return (
                  <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                    <div>
                      <p id={labelId} style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 600, color: 'var(--color-dark)' }}>{t.label}s</p>
                      <p style={{ margin: '0.125rem 0 0', fontSize: '0.875rem', color: 'var(--color-text)' }}>{formatMoney(t.priceCents, workshop.currency)} each</p>
                    </div>
                    <div role="group" aria-labelledby={labelId} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <button
                        type="button"
                        aria-label={`Fewer ${t.label.toLowerCase()}s`}
                        onClick={() => setTicketCounts((c) => ({ ...c, [t.id]: Math.max(t.min, (c[t.id] ?? 0) - 1) }))}
                        disabled={!canLess}
                        style={{ ...counterButton, opacity: canLess ? 1 : 0.35, cursor: canLess ? 'pointer' : 'default' }}
                      >
                        <span aria-hidden="true">&minus;</span>
                      </button>
                      <span aria-live="polite" aria-atomic="true" style={{ minWidth: '2rem', textAlign: 'center', fontSize: '1.25rem', fontWeight: 600, color: 'var(--color-dark)' }}>
                        <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{n} {n === 1 ? t.label : `${t.label}s`}</span>
                        <span aria-hidden="true">{n}</span>
                      </span>
                      <button
                        type="button"
                        aria-label={`More ${t.label.toLowerCase()}s`}
                        onClick={() => setTicketCounts((c) => ({ ...c, [t.id]: (c[t.id] ?? 0) + 1 }))}
                        disabled={!canMore}
                        style={{ ...counterButton, opacity: canMore ? 1 : 0.35, cursor: canMore ? 'pointer' : 'default' }}
                      >
                        <span aria-hidden="true">+</span>
                      </button>
                    </div>
                  </div>
                )
              })}
              {seatsLeft && <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--color-text)' }}>{seatsLeft}</p>}
            </div>
          ) : (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <div>
              <p id={`${formId}-seats`} style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 600, color: 'var(--color-dark)' }}>
                Seats
              </p>
              <p style={{ margin: '0.125rem 0 0', fontSize: '0.875rem', color: 'var(--color-text)' }}>
                {formatMoney(workshop.price, workshop.currency)} per seat
                {seatsLeft && ` · ${seatsLeft}`}
              </p>
            </div>
            <div role="group" aria-labelledby={`${formId}-seats`} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <button
                type="button"
                aria-label="Fewer seats"
                onClick={() => setSeats((n) => Math.max(1, n - 1))}
                disabled={seats <= 1}
                style={{ ...counterButton, opacity: seats <= 1 ? 0.35 : 1, cursor: seats <= 1 ? 'default' : 'pointer' }}
              >
                <span aria-hidden="true">&minus;</span>
              </button>
              <span aria-live="polite" aria-atomic="true" style={{ minWidth: '2rem', textAlign: 'center', fontSize: '1.25rem', fontWeight: 600, color: 'var(--color-dark)' }}>
                <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{seatWord}</span>
                <span aria-hidden="true">{seats}</span>
              </span>
              <button
                type="button"
                aria-label="More seats"
                onClick={() => setSeats((n) => Math.min(maxSeats, n + 1))}
                disabled={seats >= maxSeats}
                style={{ ...counterButton, opacity: seats >= maxSeats ? 0.35 : 1, cursor: seats >= maxSeats ? 'default' : 'pointer' }}
              >
                <span aria-hidden="true">+</span>
              </button>
            </div>
          </div>
          )}
          {seats >= maxSeats && (
            <p role="status" style={{ margin: '0.625rem 0 0', fontSize: '0.875rem', color: 'var(--color-text)' }}>
              {cappedByBooking ? (
                <>
                  One booking holds up to {MAX_SEATS_PER_BOOKING} seats. For a bigger group,{' '}
                  <a href="/book" style={{ color: 'var(--color-primary)', fontWeight: 600 }}>
                    book a private party
                  </a>
                  .
                </>
              ) : (
                `That’s every seat left in this workshop.`
              )}
            </p>
          )}
          {options.length > 0 && (
            <div style={{ marginTop: '1rem' }}>
              {Array.from({ length: seats }, (_, i) => i + 1).map((seat) =>
                options.map((o) => {
                  const k = selectionKey(seat, o.id)
                  const fieldId = pickFieldId(seat, o.id)
                  return (
                    <div key={k} style={{ marginBottom: '0.625rem' }}>
                      <label
                        htmlFor={fieldId}
                        style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-dark)' }}
                      >
                        {seatTypeLabels ? `${seatTypeLabels[seat - 1]} ${seatTypeLabels.slice(0, seat).filter((l) => l === seatTypeLabels[seat - 1]).length}` : `Seat ${seat}`} · {o.label}
                      </label>
                      <select
                        id={fieldId}
                        required
                        value={selections[k] ?? ''}
                        onChange={(e) => {
                          const value = e.target.value
                          setSelections((s) => ({ ...s, [k]: value }))
                          setPickProblem(null)
                        }}
                        style={{
                          width: '100%',
                          minHeight: '2.75rem',
                          padding: '0.5rem 0.75rem',
                          borderRadius: '0.75rem',
                          border: '1.5px solid var(--color-field-border)',
                          background: 'var(--color-surface)',
                          fontSize: '1rem',
                          color: 'var(--color-dark)',
                        }}
                      >
                        <option value="" disabled>Choose…</option>
                        {o.choices.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>
                  )
                }),
              )}
              <p style={{ margin: '0.25rem 0 0', fontSize: '0.875rem', lineHeight: 1.5, color: 'var(--color-text)' }}>{PICKS_FINAL_LINE}</p>
              {pickProblem && (
                <p role="alert" className="field-error" style={{ marginTop: '0.375rem' }}>
                  {pickProblem}
                </p>
              )}
            </div>
          )}
        </div>
        <div style={{ marginTop: '1.5rem' }}>
          <NewClassesSignup />
        </div>
      </div>
    )
  }

  // ── Step 2: contact details and payment ───────────────────────────────────
  function renderPay() {
    return (
      <form id={formId} onSubmit={handlePay} noValidate>
        <ContactFields ref={contactRef} value={contact} onChange={setContact} phoneRequired disabled={processing} />

        <div style={{ margin: '1.25rem 0', padding: '0.875rem 1rem', borderRadius: '0.75rem', background: 'var(--color-sand)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', fontSize: '0.9375rem', color: 'var(--color-dark)' }}>
            {tickets ? <span>{workshop.name}</span> : (
              <span>
                {workshop.name}, {seatWord} × {formatMoney(workshop.price, workshop.currency)}
              </span>
            )}
            <span>{formatMoney(subtotal, workshop.currency)}</span>
          </div>
          {tickets && tickets.filter((t) => (ticketCounts[t.id] ?? 0) > 0).map((t) => (
            <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', fontSize: '0.875rem', color: 'var(--color-text)', marginTop: '0.125rem' }}>
              <span>{ticketCounts[t.id]} {ticketCounts[t.id] === 1 ? t.label : `${t.label}s`} × {formatMoney(t.priceCents, workshop.currency)}</span>
              <span>{formatMoney(t.priceCents * (ticketCounts[t.id] ?? 0), workshop.currency)}</span>
            </div>
          ))}
          {tax > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', fontSize: '0.9375rem', color: 'var(--color-dark)', marginTop: '0.25rem' }}>
              <span>Tax</span>
              <span>{formatMoney(tax, workshop.currency)}</span>
            </div>
          )}
          {/* No bold total here: the Pay button already says it (Kaden, 18 Oct 2026: "transparent, not scary"). */}
          {!taxKnown && (
            <p style={{ margin: '0.375rem 0 0', fontSize: '0.8125rem', color: 'var(--color-text)' }}>Any tax is added when you pay.</p>
          )}
          {picks.length > 0 && (
            <p style={{ margin: '0.375rem 0 0', fontSize: '0.875rem', color: 'var(--color-text)' }}>{picksNote(options, picks)}</p>
          )}
        </div>

        <PaymentForm
          bookingKind="workshop"
          ref={paymentFormRef}
          applicationIdOverride={CLASS_BOOKING_APP_ID}
          environmentOverride="production"
          giftCards="cards-only"
          // Google Pay. Apple Pay is asked for too but Square refuses it on the
          // class-booking route ("domain not registered", 11 Oct 2026), so it
          // stays hidden — and appears by itself if Square ever allows it.
          // Google Pay pays for one seat: each seat is its own charge, and its
          // sheet can't be opened again without another tap.
          wallet={seats === 1 ? { amount: (total / 100).toFixed(2), label: `Hometown Studio, ${workshop.name}` } : undefined}
          onWalletToken={(token) => handlePay(undefined, token)}
          // Runs before the wallet sheet opens, so nobody approves in their
          // wallet and then meets a form error. Marks what's missing as it goes.
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
              <a
                href={`${POLICY_PATH}#${POLICY_ANCHORS.workshops}`}
                target="_blank"
                rel="noopener"
                style={{ color: 'var(--color-primary)', fontWeight: 600, textDecoration: 'underline' }}
              >
                booking and cancellation policy
              </a>
              . <span style={{ color: 'var(--color-text)' }}>{checkoutPolicySummary.workshop}.</span>
            </span>
          </label>
          {policyProblem && (
            <p id={policyErrorId} role="alert" className="field-error" style={{ marginTop: '0.375rem' }}>
              {POLICY_UNTICKED}
            </p>
          )}
        </div>

        {error && (
          <p role="alert" className="field-error" style={{ marginTop: '0.875rem', fontSize: '0.9375rem', lineHeight: 1.5 }}>
            {error}
          </p>
        )}
      </form>
    )
  }

  // ── What's pinned to the bottom ───────────────────────────────────────────
  let footer
  if (completed) {
    footer = (
      <button type="button" className="btn btn-primary" onClick={finish}>
        Done
      </button>
    )
  } else if (step === 'details') {
    footer = (
      <button
        type="button"
        className="btn btn-primary"
        onClick={() => {
          if (!picksComplete()) return
          trackWizardStepCompleted('details')
          trackBeginCheckout('workshop', total / 100, [classItem()], { seats })
          setStep('pay')
        }}
      >
        Continue · {totalLabel}
      </button>
    )
  } else {
    footer = (
      <>
        {/* Only ever off while working or while the card field loads, and it says which. */}
        <button type="submit" form={formId} className="btn btn-primary" disabled={processing || !paymentReady}>
          {processing ? 'Processing…' : !paymentReady ? 'Loading payment form…' : `Pay ${formatMoney(total, workshop.currency)}`}
        </button>
        <p style={{ margin: '0.5rem 0 0', textAlign: 'center', fontSize: '0.8125rem', lineHeight: 1.4, color: 'var(--color-text)' }}>
          {workshopRefundLine()}
        </p>
      </>
    )
  }

  const seatsLeft = workshop.remainingSeats
  return (
    <BookingPanel
      title={workshop.name}
      onRequestClose={completed ? finish : requestClose}
      stepKey={completed ? 'confirmed' : step}
      stepName={completed ? undefined : STEP_NAMES[step]}
      stepNumber={step === 'details' ? 1 : 2}
      stepCount={2}
      summary={
        completed ? undefined : (
          <p style={{ margin: 0, fontSize: '0.9375rem', color: 'var(--color-dark)' }}>
            {when} · {seatWord} · <strong>{totalLabel}</strong>
          </p>
        )
      }
      onBack={!completed && step === 'pay' && !processing ? () => setStep('details') : undefined}
      footer={footer}
      leavePrompt={
        askToLeave && !completed
          ? {
              title: 'Leave without booking?',
              body:
                seatsLeft !== null && seatsLeftLabel(seatsLeft)
                  ? `${seatsLeftLabel(seatsLeft)} in ${workshop.name}. Nothing is saved until you pay.`
                  : 'Nothing is saved until you pay.',
              keepLabel: 'Keep booking',
              leaveLabel: 'Close',
              onKeep: () => setAskToLeave(false),
              onLeave: closeAndRecord,
            }
          : null
      }
    >
      {completed ? renderConfirmation() : step === 'details' ? renderDetails() : renderPay()}
    </BookingPanel>
  )
}
