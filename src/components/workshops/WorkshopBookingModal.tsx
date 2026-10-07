import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { CLASS_BOOKING_APP_ID, MAX_SEATS_PER_BOOKING } from '@config/class-booking.config'
import { checkoutPolicySummary, POLICY_PATH, POLICY_ANCHORS } from '@config/policy-content'
import { STUDIO_ADDRESS, STUDIO_ADDRESS_LINE, STUDIO_DIRECTIONS_URL } from '@config/studio-address'
import { newAttemptId } from '@lib/checkout-attempt'
import { messageForFailure, outcomeUnknown, workshopMessages, UNKNOWN_OUTCOME_MESSAGE } from '@lib/checkout-messages'
import { contactStarted, EMPTY_CONTACT, type Contact } from '@lib/contact-rules'
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
} from '@lib/analytics'

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
  const [seats, setSeats] = useState(1)
  // One answer per seat per question, keyed by selectionKey(seat, optionId).
  // Kept when the seat count drops, so a seat added back shows its pick.
  const [selections, setSelections] = useState<Record<string, string>>({})
  const [pickProblem, setPickProblem] = useState<string | null>(null)
  const [contact, setContact] = useState<Contact>(EMPTY_CONTACT)
  const [agreedToPolicy, setAgreedToPolicy] = useState(false)
  const [policyProblem, setPolicyProblem] = useState(false)

  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [paymentReady, setPaymentReady] = useState(false)
  const [completed, setCompleted] = useState(false)
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null)
  const [bookingId, setBookingId] = useState<string | null>(null)
  const [emailSent, setEmailSent] = useState(false)
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
  }, [seats, picksSignature])

  useEffect(() => {
    trackWizardStarted('workshop')
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
  const total = workshop.price * seats
  const when = formatDayAndSpan(workshop.startTime, workshop.endTime)
  const seatWord = `${seats} seat${seats === 1 ? '' : 's'}`

  // Closing asks first only once there is something to lose.
  const started = seats !== 1 || contactStarted(contact) || Object.keys(selections).length > 0
  function requestClose() {
    if (completed || !started) return onClose()
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

  async function handlePay(e?: FormEvent) {
    e?.preventDefault()
    if (processing || !paymentReady) return
    if (!picksComplete(true)) {
      setStep('details')
      return
    }

    // Say what's missing, field by field, and go to the first one.
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
      return
    }

    setError(null)
    setProcessing(true)
    trackPaymentStarted(total / 100)

    try {
      let token: string
      try {
        token = await paymentFormRef.current!.tokenize()
      } catch {
        throw new Error('We couldn’t read that card. Check the number, date and code, then try again. Nothing was charged.')
      }

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
            ...(options.length > 0 ? { picks } : {}),
            paymentToken: token,
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
      setAskToLeave(false)
      setCompleted(true)
      trackPaymentCompleted(total / 100)
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
            {seatWord} for <strong>{workshop.name}</strong>, {formatMoney(total, workshop.currency)} paid.
          </>
        }
        email={contact.email.trim()}
        emailSent={emailSent}
      >
        <div style={{ marginTop: '1.25rem' }}>
          <ConfirmedBlock label="When">
            <strong>{when}</strong>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem 1rem', marginTop: '0.25rem' }}>
              <a href={googleCalendarUrl(calendarEvent)} target="_blank" rel="noopener noreferrer" className="btn btn-quiet" style={{ width: 'auto' }}>
                Add to Google Calendar
              </a>
              <a href={icsDataUrl(buildIcs(calendarEvent))} download="hometown-workshop.ics" className="btn btn-quiet" style={{ width: 'auto' }}>
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
            <a href={waiverUrl} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
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
                        Seat {seat} · {o.label}
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
      </div>
    )
  }

  // ── Step 2: contact details and payment ───────────────────────────────────
  function renderPay() {
    return (
      <form id={formId} onSubmit={handlePay} noValidate>
        <ContactFields ref={contactRef} value={contact} onChange={setContact} phoneRequired={false} disabled={processing} />

        <div style={{ margin: '1.25rem 0', padding: '0.875rem 1rem', borderRadius: '0.75rem', background: 'var(--color-sand)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', fontSize: '0.9375rem', color: 'var(--color-dark)' }}>
            <span>
              {workshop.name}, {seatWord} × {formatMoney(workshop.price, workshop.currency)}
            </span>
            <strong>{formatMoney(total, workshop.currency)}</strong>
          </div>
          {picks.length > 0 && (
            <p style={{ margin: '0.375rem 0 0', fontSize: '0.875rem', color: 'var(--color-text)' }}>{picksNote(options, picks)}</p>
          )}
        </div>

        <PaymentForm
          ref={paymentFormRef}
          applicationIdOverride={CLASS_BOOKING_APP_ID}
          environmentOverride="production"
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
          setStep('pay')
        }}
      >
        Continue · {formatMoney(total, workshop.currency)}
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
            {when} · {seatWord} · <strong>{formatMoney(total, workshop.currency)}</strong>
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
              onLeave: onClose,
            }
          : null
      }
    >
      {completed ? renderConfirmation() : step === 'details' ? renderDetails() : renderPay()}
    </BookingPanel>
  )
}
