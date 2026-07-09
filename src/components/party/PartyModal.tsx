import { useState, useEffect, useRef } from 'react'
import { CLASS_BOOKING_APP_ID } from '@config/site.config'
import PaymentForm from '@components/checkout/PaymentForm'
import type { PaymentFormRef } from '@components/checkout/PaymentForm'
import { craftBreakdown, craftTotalCents } from '@lib/party-pricing'
import { partyConfig } from '@config/party.config'

interface PartyModalProps {
  onClose: () => void
  /** Optional ISO start time (from `?start=` deeplink) to preselect and skip the Date step. */
  initialStart?: string
}

interface Craft {
  id: string
  name: string
  perHeadCents: number
  perHeadMaxCents?: number
  description?: string
  imageUrl?: string | null
  personalized?: boolean
}

interface ServiceInfo {
  service: { id: string; name: string }
  variationId: string
  variationVersion: number
  durationMinutes: number
  basePriceCents: number
  teamMemberId: string
  crafts: Craft[]
}

interface Slot {
  startAt: string
  endAt: string
  durationMinutes: number
}

const STEP_LABELS = ['Date', 'Craft', 'Guests', 'Your Info', 'Payment']

/** Flat studio rental fee (in cents), independent of guest count. */
const BASE_FEE_CENTS = 20000

function formatTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

/** "Sat, Aug 8 · 12:00 PM" for the summary chip. */
function formatSlotLabel(iso: string): string {
  const d = new Date(iso)
  const datePart = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  return `${datePart} · ${formatTime(iso)}`
}

/** "Sat, Aug 15" from a local YYYY-MM-DD string (built locally to avoid a UTC day shift). */
function formatDateLabel(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function formatPrice(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
}

/** Like formatPrice but drops the ".00" on whole dollars (e.g. "$30", "$37.50"). */
function formatPriceCompact(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : formatPrice(cents)
}

/** "$25.00" for a single price, or a compact "$30–$40" when a craft has a price range. */
function perPersonLabel(minCents: number, maxCents?: number): string {
  return maxCents && maxCents > minCents
    ? `${formatPriceCompact(minCents)}–${formatPriceCompact(maxCents)}`
    : formatPrice(minCents)
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export default function PartyModal({ onClose, initialStart }: PartyModalProps) {
  const [step, setStep] = useState(0)
  const [visible, setVisible] = useState(true)
  const [displayStep, setDisplayStep] = useState(0)
  const prevStep = useRef(0)

  // Service info
  const [info, setInfo] = useState<ServiceInfo | null>(null)
  const [infoError, setInfoError] = useState<string | null>(null)

  // Date / availability
  const [selectedDate, setSelectedDate] = useState('')
  const [availableSlots, setAvailableSlots] = useState<Slot[]>([])
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [slotsError, setSlotsError] = useState<string | null>(null)
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null)
  const [availableDates, setAvailableDates] = useState<string[]>([])
  const [loadingDates, setLoadingDates] = useState(false)
  const [datesError, setDatesError] = useState<string | null>(null)

  // Craft
  const [selectedCraft, setSelectedCraft] = useState<Craft | null>(null)
  const [expandedCraft, setExpandedCraft] = useState<string | null>(null)
  const [ackPersonalized, setAckPersonalized] = useState(false)

  // Selecting a craft resets the personalized acknowledgment (must re-confirm per craft).
  const selectCraft = (craft: Craft) => {
    setSelectedCraft(craft)
    setAckPersonalized(false)
  }

  // Guests
  const [people, setPeople] = useState(1)

  // Contact info
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')

  // Payment / completion
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [completed, setCompleted] = useState(false)
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null)
  const [totalCharged, setTotalCharged] = useState<number | null>(null)
  const paymentFormRef = useRef<PaymentFormRef>(null)

  // Body scroll lock
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  // Fetch service info on open (retryable — a transient network blip must not
  // permanently brick the modal, since without `info` no step renders).
  async function loadServiceInfo() {
    setInfoError(null)
    try {
      const res = await fetch('/api/party/service-info.json', { cache: 'no-store' })
      if (!res.ok) throw new Error('Failed to load party details.')
      const json = await res.json()
      setInfo((json.data ?? json) as ServiceInfo)
    } catch (err) {
      setInfoError(err instanceof Error ? err.message : 'Failed to load party details.')
    }
  }

  useEffect(() => {
    loadServiceInfo()
  }, [])

  // Load only the dates that actually have bookable party times, so the picker
  // offers real options instead of letting the user land on a closed/booked day.
  useEffect(() => {
    if (!info) return
    let cancelled = false
    setLoadingDates(true)
    setDatesError(null)
    ;(async () => {
      try {
        const res = await fetch('/api/party/available-dates.json', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serviceVariationId: info.variationId }),
        })
        if (!res.ok) throw new Error()
        const json = await res.json()
        if (!cancelled) setAvailableDates((json.data ?? json).dates ?? [])
      } catch {
        if (!cancelled) setDatesError('Could not load available dates.')
      } finally {
        if (!cancelled) setLoadingDates(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [info])

  // Deeplink prefill: if opened with an ISO `initialStart` (?start=<ISO>), preselect
  // that date + slot and jump straight to the Craft step. Falls back to the Date
  // step if the slot isn't actually available. Runs once `info` is loaded.
  const prefillAttempted = useRef(false)
  useEffect(() => {
    if (!info || !initialStart || prefillAttempted.current) return
    prefillAttempted.current = true

    const startDate = new Date(initialStart)
    if (isNaN(startDate.getTime())) return

    // Derive the YYYY-MM-DD for the date input (local date of the start time).
    const yyyy = startDate.getFullYear()
    const mm = String(startDate.getMonth() + 1).padStart(2, '0')
    const dd = String(startDate.getDate()).padStart(2, '0')
    const date = `${yyyy}-${mm}-${dd}`

    let cancelled = false
    setSelectedDate(date)
    setLoadingSlots(true)
    setSlotsError(null)
    ;(async () => {
      try {
        const slots = await fetchAvailability(date, info.variationId)
        if (cancelled) return
        setAvailableSlots(slots)
        const target = startDate.getTime()
        const match = slots.find((s) => new Date(s.startAt).getTime() === target)
        if (match) {
          setSelectedSlot(match)
          setStep(1) // Craft step
          setDisplayStep(1)
          prevStep.current = 1
        }
        // If no match, leave the user on the Date step (step stays 0).
      } catch {
        if (!cancelled) setSlotsError('Could not load available times.')
      } finally {
        if (!cancelled) setLoadingSlots(false)
      }
    })()
    return () => { cancelled = true }
  }, [info, initialStart])

  // Step transition
  useEffect(() => {
    if (step !== prevStep.current) {
      setVisible(false)
      const timer = setTimeout(() => {
        setDisplayStep(step)
        prevStep.current = step
        setVisible(true)
      }, 200)
      return () => clearTimeout(timer)
    }
  }, [step])

  const perHead = selectedCraft?.perHeadCents ?? 0
  const perHeadMax = selectedCraft?.perHeadMaxCents ?? perHead
  const hasPriceRange = perHeadMax > perHead // craft has multiple variants → show a range
  const craftLines = craftBreakdown(selectedCraft?.name ?? 'Craft', perHead, people)
  const deposit = BASE_FEE_CENTS // charged today to book
  const craftEstimate = craftTotalCents(perHead, people) // paid at the studio, based on attendance

  const progress = completed ? 100 : (step / (STEP_LABELS.length - 1)) * 100

  function handleBack() {
    if (step === 0) {
      onClose()
    } else {
      setStep(step - 1)
    }
  }

  /**
   * Fetch the available start times for a date. The server already enforces the
   * cleanup gap and the 6pm-exclusive rule, so the returned slots need no
   * client-side filtering.
   */
  async function fetchAvailability(date: string, variationId: string): Promise<Slot[]> {
    const res = await fetch('/api/party/availability.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, serviceVariationId: variationId }),
    })
    if (!res.ok) throw new Error('Could not load available times.')
    const json = await res.json()
    const data = json.data ?? json
    return data.slots ?? []
  }

  async function handleDateChange(date: string) {
    setSelectedDate(date)
    setSelectedSlot(null)
    setAvailableSlots([])
    setSlotsError(null)
    if (!date || !info) return

    setLoadingSlots(true)
    try {
      const slots = await fetchAvailability(date, info.variationId)
      setAvailableSlots(slots)
    } catch (err) {
      setSlotsError(err instanceof Error ? err.message : 'Could not load available times.')
    } finally {
      setLoadingSlots(false)
    }
  }

  async function handlePay() {
    if (processing || !info || !selectedSlot || !selectedCraft) return

    setError(null)
    setProcessing(true)

    try {
      let token: string
      try {
        token = await paymentFormRef.current!.tokenize()
      } catch {
        throw new Error('Could not process your card. Please check your details and try again.')
      }

      const bookRes = await fetch('/api/party/book.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startTime: selectedSlot.startAt,
          serviceVariationId: info.variationId,
          serviceVariationVersion: info.variationVersion,
          durationMinutes: info.durationMinutes,
          craft: {
            id: selectedCraft.id,
            name: selectedCraft.name,
            perHeadCents: selectedCraft.perHeadCents,
          },
          people,
          customer: {
            firstName: firstName.trim(),
            lastName: lastName.trim() || firstName.trim(),
            email: email.trim(),
            phone: phone.trim(),
          },
          paymentToken: token,
        }),
      })

      if (!bookRes.ok) {
        const errData = await bookRes.json().catch(() => null)
        throw new Error(errData?.detail ?? 'Booking failed. Your card was not charged.')
      }

      const json = await bookRes.json()
      const data = json.data ?? json
      setReceiptUrl(data.receiptUrl ?? null)
      setTotalCharged(typeof data.totalCharged === 'number' ? data.totalCharged : deposit)
      setCompleted(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred. Please try again.')
    } finally {
      setProcessing(false)
    }
  }

  const primaryButtonStyle = (enabled: boolean): React.CSSProperties => ({
    width: '100%',
    padding: '0.875rem',
    background: enabled
      ? 'linear-gradient(135deg, var(--color-primary), var(--color-accent))'
      : 'rgba(150, 112, 91, 0.2)',
    color: '#fff',
    border: 'none',
    borderRadius: '0.75rem',
    fontSize: '0.875rem',
    fontWeight: 600,
    cursor: enabled ? 'pointer' : 'default',
    opacity: enabled ? 1 : 0.5,
    boxShadow: enabled ? '0 4px 15px rgba(150, 112, 91, 0.2)' : 'none',
    transition: 'box-shadow 0.3s ease, transform 0.3s ease',
  })

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '0.75rem 1rem',
    borderRadius: '0.75rem',
    border: '1px solid rgba(150, 112, 91, 0.15)',
    background: 'rgba(255, 255, 255, 0.8)',
    fontSize: '0.875rem',
    color: 'var(--color-text)',
    outline: 'none',
    boxSizing: 'border-box',
  }

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '0.8125rem',
    fontWeight: 500,
    color: 'var(--color-dark)',
    marginBottom: '0.375rem',
  }

  const chipStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.4rem',
    padding: '0.35rem 0.75rem',
    borderRadius: '2rem',
    background: 'rgba(150, 112, 91, 0.08)',
    border: '1px solid rgba(150, 112, 91, 0.14)',
    fontSize: '0.75rem',
    fontWeight: 500,
    color: 'var(--color-dark)',
    whiteSpace: 'nowrap',
  }

  /** Itemized summary rows (base + one row per craft price tier), shared by the
   *  Guests and Payment steps. Driven entirely by the pricing helpers so the
   *  displayed total always matches what we post to /api/party/book.json. */
  function renderSummaryRows() {
    return (
      <>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem', color: 'var(--color-muted)', marginBottom: '0.375rem' }}>
          <span>Studio fee — due today</span>
          <span>{formatPrice(deposit)}</span>
        </div>
        {selectedCraft && (
          <>
            {hasPriceRange ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem', color: 'var(--color-muted)', marginBottom: '0.375rem' }}>
                <span>{selectedCraft.name}</span>
                <span>{perPersonLabel(perHead, perHeadMax)} / person</span>
              </div>
            ) : (
              craftLines.map((line, i) => (
                <div
                  key={`${line.unitCents}-${i}`}
                  style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem', color: 'var(--color-muted)', marginBottom: '0.375rem' }}
                >
                  <span>{line.label} @ {formatPrice(line.unitCents)}</span>
                  <span>{formatPrice(line.unitCents * line.qty)}</span>
                </div>
              ))
            )}
            <p style={{ fontSize: '0.72rem', fontStyle: 'italic', color: 'var(--color-muted)', margin: '0.35rem 0 0' }}>
              {hasPriceRange
                ? 'Your exact piece and price are chosen and paid at the studio, based on who attends.'
                : `Craft cost (~${formatPrice(craftEstimate)}) is an estimate — you pay it at the studio on the day, based on who attends.`}
            </p>
          </>
        )}
        <div style={{ height: '0.25rem' }} />
      </>
    )
  }

  function renderStep() {
    if (completed) {
      return (
        <div style={{ textAlign: 'center', padding: '1rem 0' }}>
          <div style={{
            width: '3rem',
            height: '3rem',
            margin: '0 auto 1.25rem',
            borderRadius: '50%',
            background: 'rgba(34, 197, 94, 0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.5rem',
            color: 'rgb(34, 197, 94)',
          }}>
            &#10003;
          </div>
          <h3 style={{
            fontSize: '1.25rem',
            fontFamily: 'var(--font-heading)',
            fontWeight: 600,
            color: 'var(--color-dark)',
            marginBottom: '0.75rem',
          }}>
            Party Booked
          </h3>
          <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', lineHeight: 1.6, maxWidth: '24rem', margin: '0 auto' }}>
            Your private studio party{selectedCraft ? <> ({selectedCraft.name})</> : null} is confirmed,
            and a confirmation has been sent to <strong>{email}</strong>.
          </p>
          {totalCharged !== null && (
            <p style={{ fontSize: '0.875rem', color: 'var(--color-dark)', fontWeight: 600, marginTop: '0.75rem' }}>
              Studio fee paid: {formatPrice(totalCharged)}
            </p>
          )}
          <p style={{ fontSize: '0.8125rem', color: 'var(--color-muted)', lineHeight: 1.55, maxWidth: '24rem', margin: '0.75rem auto 0' }}>
            You'll pay for your crafts at the studio on the day, based on who attends
            {selectedCraft?.personalized ? ', and we’ll email you to collect your final headcount and personalization details' : ''}.
          </p>
          {receiptUrl && (
            <a
              href={receiptUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-block',
                marginTop: '1rem',
                fontSize: '0.875rem',
                color: 'var(--color-primary)',
              }}
            >
              View Receipt
            </a>
          )}
        </div>
      )
    }

    if (infoError) {
      return (
        <div>
          <p style={{ fontSize: '0.875rem', color: '#dc2626', marginBottom: '1rem' }}>
            {infoError} This is usually a brief connection hiccup.
          </p>
          <button type="button" onClick={loadServiceInfo} style={primaryButtonStyle(true)}>
            Try again
          </button>
        </div>
      )
    }

    if (!info) {
      return (
        <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)' }}>Loading party details...</p>
      )
    }

    switch (displayStep) {
      // DATE
      case 0:
        return (
          <div>
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ ...labelStyle, marginBottom: '0.75rem' }}>Choose a Date</label>
              {loadingDates && (
                <p style={{ fontSize: '0.8125rem', color: 'var(--color-muted)' }}>Loading available dates…</p>
              )}
              {datesError && <p style={{ fontSize: '0.8125rem', color: '#dc2626' }}>{datesError}</p>}
              {!loadingDates && !datesError && availableDates.length === 0 && (
                <p style={{ fontSize: '0.8125rem', color: 'var(--color-muted)' }}>
                  No party dates are open right now — please check back soon.
                </p>
              )}
              {availableDates.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(8rem, 1fr))', gap: '0.5rem' }}>
                  {availableDates.map((d) => {
                    const active = selectedDate === d
                    return (
                      <button
                        key={d}
                        type="button"
                        onClick={() => handleDateChange(d)}
                        style={{
                          padding: '0.625rem 0.5rem',
                          borderRadius: '0.625rem',
                          border: active ? '1px solid var(--color-primary)' : '1px solid rgba(150, 112, 91, 0.15)',
                          background: active ? 'rgba(150, 112, 91, 0.12)' : 'rgba(255, 255, 255, 0.8)',
                          fontSize: '0.8125rem',
                          fontWeight: active ? 600 : 500,
                          color: 'var(--color-dark)',
                          cursor: 'pointer',
                          transition: 'background 0.2s ease, border-color 0.2s ease',
                        }}
                      >
                        {formatDateLabel(d)}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {loadingSlots && (
              <p style={{ fontSize: '0.8125rem', color: 'var(--color-muted)', marginBottom: '1rem' }}>
                Loading available times...
              </p>
            )}
            {slotsError && (
              <p style={{ fontSize: '0.8125rem', color: '#dc2626', marginBottom: '1rem' }}>{slotsError}</p>
            )}

            {!loadingSlots && selectedDate && !slotsError && availableSlots.length === 0 && (
              <p style={{ fontSize: '0.8125rem', color: 'var(--color-muted)', marginBottom: '1rem' }}>
                No available start times for this date. Please choose another.
              </p>
            )}

            {availableSlots.length > 0 && (
              <div style={{ marginBottom: '1.5rem' }}>
                <label style={labelStyle}>Start Time</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(7rem, 1fr))', gap: '0.5rem' }}>
                  {availableSlots.map((slot) => {
                    const active = selectedSlot?.startAt === slot.startAt
                    return (
                      <button
                        key={slot.startAt}
                        type="button"
                        onClick={() => setSelectedSlot(slot)}
                        style={{
                          padding: '0.625rem 0.5rem',
                          borderRadius: '0.625rem',
                          border: active ? '1px solid var(--color-primary)' : '1px solid rgba(150, 112, 91, 0.15)',
                          background: active ? 'rgba(150, 112, 91, 0.12)' : 'rgba(255, 255, 255, 0.8)',
                          fontSize: '0.8125rem',
                          fontWeight: active ? 600 : 500,
                          color: 'var(--color-dark)',
                          cursor: 'pointer',
                          transition: 'background 0.2s ease, border-color 0.2s ease',
                        }}
                      >
                        {formatTime(slot.startAt)}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={() => setStep(1)}
              disabled={!selectedSlot}
              style={primaryButtonStyle(!!selectedSlot)}
            >
              Continue
            </button>
          </div>
        )

      // CRAFT
      case 1:
        return (
          <div>
            <label style={{ ...labelStyle, marginBottom: '0.75rem' }}>Choose a Craft</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem', marginBottom: '1.5rem' }}>
              {info.crafts.map((craft) => {
                const active = selectedCraft?.id === craft.id
                const expanded = expandedCraft === craft.id
                return (
                  <div
                    key={craft.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={active}
                    onClick={() => selectCraft(craft)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        selectCraft(craft)
                      }
                    }}
                    style={{
                      borderRadius: '0.875rem',
                      border: active ? '2px solid var(--color-primary)' : '1px solid rgba(150, 112, 91, 0.18)',
                      background: active ? 'rgba(150, 112, 91, 0.08)' : 'rgba(255, 255, 255, 0.85)',
                      overflow: 'hidden',
                      cursor: 'pointer',
                      transition: 'background 0.2s ease, border-color 0.2s ease',
                    }}
                  >
                    {craft.imageUrl && (
                      <div style={{ position: 'relative', width: '100%', aspectRatio: '4 / 3', background: 'rgba(150, 112, 91, 0.06)' }}>
                        <img
                          src={craft.imageUrl}
                          alt=""
                          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                        />
                        {active && (
                          <span
                            aria-hidden
                            style={{
                              position: 'absolute',
                              top: '0.625rem',
                              right: '0.625rem',
                              width: '1.5rem',
                              height: '1.5rem',
                              borderRadius: '999px',
                              background: 'var(--color-primary)',
                              color: '#fff',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '0.8rem',
                              boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
                            }}
                          >
                            ✓
                          </span>
                        )}
                      </div>
                    )}

                    <div style={{ padding: '0.875rem 1.125rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.75rem' }}>
                        <span style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-dark)' }}>{craft.name}</span>
                        <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-muted)', flexShrink: 0 }}>
                          {perPersonLabel(craft.perHeadCents, craft.perHeadMaxCents)}/person
                        </span>
                      </div>

                      {craft.description && (
                        <>
                          <p
                            style={{
                              margin: '0.4rem 0 0',
                              fontSize: '0.8125rem',
                              lineHeight: 1.55,
                              color: 'var(--color-muted)',
                              ...(expanded
                                ? { whiteSpace: 'pre-line' }
                                : {
                                    display: '-webkit-box',
                                    WebkitLineClamp: 2,
                                    WebkitBoxOrient: 'vertical',
                                    overflow: 'hidden',
                                  }),
                            }}
                          >
                            {craft.description}
                          </p>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setExpandedCraft(expanded ? null : craft.id)
                            }}
                            aria-expanded={expanded}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.25rem',
                              marginTop: '0.35rem',
                              padding: 0,
                              background: 'transparent',
                              border: 'none',
                              cursor: 'pointer',
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              color: 'var(--color-primary)',
                            }}
                          >
                            {expanded ? 'Read less' : 'Read more'}
                            <span
                              aria-hidden
                              style={{ display: 'inline-block', transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease' }}
                            >
                              ▾
                            </span>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {selectedCraft?.personalized && (
              <div
                style={{
                  marginBottom: '1.5rem',
                  padding: '1rem 1.125rem',
                  borderRadius: '0.75rem',
                  border: '1px solid rgba(180, 83, 9, 0.35)',
                  background: 'rgba(251, 191, 36, 0.12)',
                }}
              >
                <p style={{ margin: 0, fontSize: '0.875rem', fontWeight: 600, color: '#92400e' }}>
                  Heads up — this craft is made to order
                </p>
                <p style={{ margin: '0.35rem 0 0.75rem', fontSize: '0.8125rem', lineHeight: 1.5, color: '#92400e' }}>
                  This craft is personalized and made to order for your group. Once your items are made, they can't be
                  changed or refunded. We'll email you after booking to collect your final count and personalization
                  details.
                </p>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={ackPersonalized}
                    onChange={(e) => setAckPersonalized(e.target.checked)}
                    style={{ marginTop: '0.15rem', width: '1rem', height: '1rem', flexShrink: 0, cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--color-dark)' }}>
                    I understand these items are made to order and are non-refundable once made.
                  </span>
                </label>
              </div>
            )}

            <button
              type="button"
              onClick={() => setStep(2)}
              disabled={!selectedCraft || (!!selectedCraft.personalized && !ackPersonalized)}
              style={primaryButtonStyle(!!selectedCraft && (!selectedCraft.personalized || ackPersonalized))}
            >
              Continue
            </button>
          </div>
        )

      // GUESTS
      case 2:
        return (
          <div>
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ ...labelStyle, marginBottom: '0.5rem' }}>Number of Guests</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <button
                  type="button"
                  onClick={() => setPeople(Math.max(1, people - 1))}
                  disabled={people <= 1}
                  style={{
                    width: '2.5rem',
                    height: '2.5rem',
                    borderRadius: '0.5rem',
                    border: '1px solid rgba(150, 112, 91, 0.15)',
                    background: 'rgba(255, 255, 255, 0.8)',
                    fontSize: '1.25rem',
                    cursor: people <= 1 ? 'default' : 'pointer',
                    opacity: people <= 1 ? 0.3 : 1,
                    color: 'var(--color-dark)',
                  }}
                >
                  &minus;
                </button>
                <span style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--color-dark)', minWidth: '2rem', textAlign: 'center' }}>
                  {people}
                </span>
                <button
                  type="button"
                  onClick={() => setPeople(Math.min(partyConfig.maxGuests, people + 1))}
                  disabled={people >= partyConfig.maxGuests}
                  style={{
                    width: '2.5rem',
                    height: '2.5rem',
                    borderRadius: '0.5rem',
                    border: '1px solid rgba(150, 112, 91, 0.15)',
                    background: 'rgba(255, 255, 255, 0.8)',
                    fontSize: '1.25rem',
                    cursor: people >= partyConfig.maxGuests ? 'default' : 'pointer',
                    opacity: people >= partyConfig.maxGuests ? 0.3 : 1,
                    color: 'var(--color-dark)',
                  }}
                >
                  +
                </button>
                {selectedCraft && (
                  <span style={{ fontSize: '0.8125rem', color: 'var(--color-muted)' }}>
                    {perPersonLabel(perHead, perHeadMax)} / person
                  </span>
                )}
              </div>
              <p style={{ fontSize: '0.75rem', color: 'var(--color-muted)', marginTop: '0.5rem' }}>
                {people >= partyConfig.maxGuests
                  ? `Maximum ${partyConfig.maxGuests} guests per booking.`
                  : `Up to ${partyConfig.maxGuests} guests. This is just an estimate for planning — you'll pay for crafts at the studio based on who actually attends.`}
              </p>
            </div>

            {/* Live total breakdown */}
            <div style={{
              padding: '1rem 0',
              borderTop: '1px solid rgba(150, 112, 91, 0.08)',
              marginBottom: '1.5rem',
            }}>
              {renderSummaryRows()}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderTop: '1px solid rgba(150, 112, 91, 0.08)', paddingTop: '0.625rem' }}>
                <span style={{ fontSize: '0.875rem', color: 'var(--color-muted)' }}>Due today</span>
                <span style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--color-dark)' }}>
                  {formatPrice(deposit)}
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setStep(3)}
              style={primaryButtonStyle(true)}
            >
              Continue
            </button>
          </div>
        )

      // YOUR INFO
      case 3: {
        const infoValid = !!firstName.trim() && isValidEmail(email.trim())
        return (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
              <div>
                <label style={labelStyle}>First Name *</label>
                <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Last Name</label>
                <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} style={inputStyle} />
              </div>
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <label style={labelStyle}>Email *</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} />
            </div>
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={labelStyle}>Phone</label>
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} style={inputStyle} />
            </div>

            <button
              type="button"
              onClick={() => setStep(4)}
              disabled={!infoValid}
              style={primaryButtonStyle(infoValid)}
            >
              Continue to Payment
            </button>
          </div>
        )
      }

      // PAYMENT
      case 4:
        return (
          <div>
            {/* Order summary */}
            <div style={{
              padding: '1rem 1.25rem',
              borderRadius: '0.75rem',
              background: 'rgba(255, 255, 255, 0.6)',
              border: '1px solid rgba(150, 112, 91, 0.08)',
              marginBottom: '1rem',
            }}>
              {renderSummaryRows()}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderTop: '1px solid rgba(150, 112, 91, 0.08)', paddingTop: '0.625rem' }}>
                <span style={{ fontSize: '0.875rem', color: 'var(--color-muted)' }}>Due today</span>
                <span style={{ fontSize: '1.125rem', fontWeight: 600, color: 'var(--color-dark)' }}>
                  {formatPrice(deposit)}
                </span>
              </div>
            </div>

            <div style={{ marginTop: '1rem' }}>
              <PaymentForm ref={paymentFormRef} applicationIdOverride={CLASS_BOOKING_APP_ID} environmentOverride="production" />
            </div>

            {error && (
              <p style={{ fontSize: '0.875rem', color: '#dc2626', marginTop: '0.75rem' }}>{error}</p>
            )}

            <button
              type="button"
              onClick={handlePay}
              disabled={processing}
              style={{
                width: '100%',
                marginTop: '1.25rem',
                padding: '0.875rem',
                background: processing
                  ? 'rgba(150, 112, 91, 0.4)'
                  : 'linear-gradient(135deg, var(--color-primary), var(--color-accent))',
                color: '#fff',
                border: 'none',
                borderRadius: '0.75rem',
                fontSize: '0.875rem',
                fontWeight: 600,
                cursor: processing ? 'default' : 'pointer',
                opacity: processing ? 0.7 : 1,
                transition: 'box-shadow 0.3s ease, transform 0.3s ease',
              }}
            >
              {processing ? 'Processing...' : `Pay ${formatPrice(deposit)} studio fee`}
            </button>
          </div>
        )

      default:
        return null
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.4)',
        backdropFilter: 'blur(4px)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !completed) onClose()
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '40rem',
          maxHeight: '90vh',
          overflow: 'auto',
          margin: '1rem',
          padding: '2.5rem',
          background: 'linear-gradient(135deg, rgba(255,255,255,0.92) 0%, rgba(255,255,255,0.85) 50%, rgba(255,255,255,0.9) 100%)',
          backdropFilter: 'blur(32px) saturate(1.4)',
          WebkitBackdropFilter: 'blur(32px) saturate(1.4)',
          border: '1px solid rgba(255, 255, 255, 0.6)',
          borderRadius: '1.25rem',
          boxShadow: '0 24px 80px rgba(0, 0, 0, 0.15), 0 8px 24px rgba(150, 112, 91, 0.08)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h2 style={{
            fontSize: '1.25rem',
            fontFamily: 'var(--font-heading)',
            fontWeight: 600,
            color: 'var(--color-dark)',
          }}>
            Book a Party
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'none',
              border: 'none',
              fontSize: '1.5rem',
              color: 'var(--color-muted)',
              cursor: 'pointer',
              padding: '0.25rem',
              lineHeight: 1,
            }}
          >
            &times;
          </button>
        </div>

        {/* Progress bar */}
        {!completed && (
          <nav aria-label="Booking progress" style={{ marginBottom: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.5rem' }}>
              <span style={{
                fontSize: '0.8125rem',
                fontWeight: 500,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'var(--color-dark)',
              }}>
                {STEP_LABELS[step]}
              </span>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>
                {step + 1} / {STEP_LABELS.length}
              </span>
            </div>
            <div style={{ height: '2px', background: 'rgba(150, 112, 91, 0.1)', borderRadius: '1px', overflow: 'hidden' }}>
              <div
                role="progressbar"
                aria-valuenow={step + 1}
                aria-valuemin={1}
                aria-valuemax={STEP_LABELS.length}
                style={{
                  height: '100%',
                  width: `${progress}%`,
                  background: 'linear-gradient(90deg, var(--color-primary), var(--color-accent))',
                  borderRadius: '1px',
                  transition: 'width 0.5s cubic-bezier(0.25, 0.1, 0, 1)',
                }}
              />
            </div>
          </nav>
        )}

        {/* Selection summary — aggregates choices as you move through the steps */}
        {!completed && (selectedSlot || selectedCraft) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1.25rem' }}>
            {selectedSlot && <span style={chipStyle}>{formatSlotLabel(selectedSlot.startAt)}</span>}
            {selectedCraft && <span style={chipStyle}>{selectedCraft.name}</span>}
            {step >= 3 && <span style={chipStyle}>{people} guest{people > 1 ? 's' : ''}</span>}
          </div>
        )}

        {/* Back button */}
        {!completed && (
          <button
            type="button"
            onClick={handleBack}
            style={{
              marginBottom: '1.25rem',
              fontSize: '0.8125rem',
              color: 'var(--color-muted)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
              display: 'flex',
              alignItems: 'center',
              gap: '0.375rem',
              transition: 'color 0.3s ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-dark)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-muted)')}
          >
            <span style={{ fontSize: '0.875rem' }}>&larr;</span>
            Back
          </button>
        )}

        {/* Step content with transition */}
        <div
          style={{
            opacity: visible ? 1 : 0,
            transform: visible ? 'translateY(0)' : 'translateY(12px)',
            transition: 'opacity 0.3s cubic-bezier(0.16, 1, 0.3, 1), transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          {renderStep()}
        </div>

        {/* Done button on completion */}
        {completed && (
          <button
            type="button"
            onClick={onClose}
            style={{
              marginTop: '1.5rem',
              width: '100%',
              padding: '0.875rem',
              background: 'var(--color-primary)',
              color: '#fff',
              border: 'none',
              borderRadius: '0.75rem',
              fontSize: '0.875rem',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'filter 0.3s ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.filter = 'brightness(0.9)' }}
            onMouseLeave={(e) => { e.currentTarget.style.filter = 'none' }}
          >
            Done
          </button>
        )}
      </div>
    </div>
  )
}
