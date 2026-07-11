import { useState, useEffect, useRef, useMemo } from 'react'
import PaymentForm from '@components/checkout/PaymentForm'
import type { PaymentFormRef } from '@components/checkout/PaymentForm'
import { craftBreakdown, craftTotalCents } from '@lib/party-pricing'
import { partyConfig } from '@config/party.config'
import { partyContent } from '@config/party-content'
import { partyStartsForDate } from '@lib/party-slots'
import {
  visibleSteps,
  stepLabel,
  stepIndex,
  nextStep,
  prevStep,
  type PartyStepId,
} from '@lib/party-steps'
import { googleCalendarUrl, buildIcs, icsDataUrl, partyWaiverUrl, partyInviteUrl } from '@lib/party-share'
import { formatTime, formatSlotLabel } from '@lib/studio-time'
import { waiverContent } from '@config/waiver-content'
import { saveRecentParty } from '@lib/recent-party'
import {
  trackWizardStarted,
  trackWizardStepCompleted,
  trackPaymentStarted,
  trackPaymentCompleted,
  trackPaymentFailed,
  trackBookingCompleted,
} from '@lib/analytics'

interface PartyModalProps {
  onClose: () => void
  /** Optional ISO start time (from `?start=` deeplink / calendar) to preselect and skip the Date step. */
  initialStart?: string
  /** Optional craft id (from the gallery "Book this craft") to preselect and skip the Craft step. */
  initialCraftId?: string
  /** Optional local date YYYY-MM-DD (from `?date=` deeplink / calendar day) to preselect. */
  initialDate?: string
}

interface Craft {
  id: string
  name: string
  perHeadCents: number
  perHeadMaxCents?: number
  description?: string
  imageUrl?: string | null
  personalized?: boolean
  popular?: boolean
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

/** Flat studio rental fee (in cents), independent of guest count — single-sourced from config. */
const BASE_FEE_CENTS = partyConfig.basePriceCents

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

export default function PartyModal({ onClose, initialStart, initialCraftId, initialDate }: PartyModalProps) {
  const [currentStep, setCurrentStep] = useState<PartyStepId>('craft')
  const [visible, setVisible] = useState(true)
  const [displayStep, setDisplayStep] = useState<PartyStepId>('craft')
  const prevStepRef = useRef<PartyStepId>('craft')

  // Small screens get a full-height bottom sheet instead of a floating card.
  const [sheetMode, setSheetMode] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)')
    setSheetMode(mq.matches)
    const handler = (ev: MediaQueryListEvent) => setSheetMode(ev.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

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
  /** A ?start deeplink matched an available slot — the Date step drops out of the flow. */
  const [slotSettled, setSlotSettled] = useState(false)
  /** A ?start deeplink pointed at a slot that's gone — explain, don't just dump them on a picker. */
  const [slotMissed, setSlotMissed] = useState(false)

  // Craft
  const [selectedCraft, setSelectedCraft] = useState<Craft | null>(null)
  const [expandedCraft, setExpandedCraft] = useState<string | null>(null)
  const [ackPersonalized, setAckPersonalized] = useState(false)

  // Selecting a craft resets the personalized acknowledgment (must re-confirm per craft).
  const selectCraft = (craft: Craft) => {
    setSelectedCraft(craft)
    setAckPersonalized(false)
  }

  // Guests — anchored at a realistic party size, never 1.
  const [people, setPeople] = useState<number>(partyConfig.defaultGuests)

  // Contact info
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')

  // Discard guard
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const dirty = !!selectedCraft || !!selectedSlot || !!firstName.trim() || !!email.trim()

  function requestClose() {
    if (completed || !dirty) return onClose()
    setConfirmDiscard(true)
  }

  // Payment / completion
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [completed, setCompleted] = useState(false)
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null)
  const [totalCharged, setTotalCharged] = useState<number | null>(null)
  const [bookingId, setBookingId] = useState<string | null>(null)
  const [hostToken, setHostToken] = useState<string | null>(null)
  const [emailSent, setEmailSent] = useState(false)
  const [partyTitle, setPartyTitle] = useState('')
  const [inviteCopied, setInviteCopied] = useState(false)
  const paymentFormRef = useRef<PaymentFormRef>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  // Email capture when no dates are open (dead-end rescue).
  const [notifyEmail, setNotifyEmail] = useState('')
  const [notifyState, setNotifyState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle')

  // Body scroll lock
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  useEffect(() => {
    trackWizardStarted('party')
  }, [])

  // Focus the dialog card on mount so screen readers announce it and Escape works immediately.
  useEffect(() => {
    dialogRef.current?.focus()
  }, [])

  // Escape key → requestClose (guard is inside requestClose)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') requestClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [dirty, completed])

  // Once booking completes, dismiss any stale discard prompt.
  useEffect(() => {
    if (completed) setConfirmDiscard(false)
  }, [completed])

  // Keep the saved-invitation pointer in sync with the party name the host
  // types on the confirmation screen, so returning to it shows the right title.
  useEffect(() => {
    if (!completed || !bookingId || !selectedSlot || !selectedCraft) return
    saveRecentParty({
      bookingId,
      hostToken: hostToken ?? undefined,
      craftName: selectedCraft.name,
      slotLabel: formatSlotLabel(selectedSlot.startAt),
      startIso: selectedSlot.startAt,
      title: partyTitle.trim() || undefined,
      savedAt: new Date().toISOString(),
    })
  }, [partyTitle, completed, bookingId, hostToken])

  // Craft preselected from the gallery → the craft step drops out of the flow,
  // UNLESS it's personalized (the non-refundable acknowledgment lives there).
  const craftSettled = !!initialCraftId && !!selectedCraft && selectedCraft.id === initialCraftId && !selectedCraft.personalized
  const steps = useMemo(
    () => visibleSteps({ craftSettled, slotSettled }),
    [craftSettled, slotSettled]
  )

  // Keep the current step valid as settled steps drop out of the flow (async
  // prefills). Jumping to steps[0] always lands on the first real decision.
  useEffect(() => {
    if (!steps.includes(currentStep)) {
      setCurrentStep(steps[0])
      setDisplayStep(steps[0])
      prevStepRef.current = steps[0]
    }
  }, [steps, currentStep])

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
  async function loadAvailableDates() {
    if (!info) return
    setLoadingDates(true)
    setDatesError(null)
    try {
      const res = await fetch('/api/party/available-dates.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceVariationId: info.variationId }),
      })
      if (!res.ok) throw new Error()
      const json = await res.json()
      setAvailableDates((json.data ?? json).dates ?? [])
    } catch {
      setDatesError('Could not load available dates.')
    } finally {
      setLoadingDates(false)
    }
  }

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

  // Deeplink prefill: ?start=<ISO> preselects that date + slot and removes the
  // Date step. If the slot is gone, we keep the Date step, prefill its date,
  // and explain — never a silent dead end. Runs once `info` is loaded.
  const prefillAttempted = useRef(false)
  useEffect(() => {
    if (!info || !initialStart || prefillAttempted.current) return
    prefillAttempted.current = true

    const startDate = new Date(initialStart)
    if (isNaN(startDate.getTime())) return

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
          setSlotSettled(true)
        } else {
          setSlotMissed(true)
        }
      } catch {
        if (!cancelled) setSlotsError('Could not load available times.')
      } finally {
        if (!cancelled) setLoadingSlots(false)
      }
    })()
    return () => { cancelled = true }
  }, [info, initialStart])

  // Deeplink prefill: ?date=<YYYY-MM-DD> (calendar day chip) preselects the
  // date and loads its times — the user still picks the start time.
  const datePrefillAttempted = useRef(false)
  useEffect(() => {
    if (!info || !initialDate || initialStart || datePrefillAttempted.current) return
    datePrefillAttempted.current = true
    if (!/^\d{4}-\d{2}-\d{2}$/.test(initialDate)) return
    handleDateChange(initialDate)
  }, [info, initialDate, initialStart])

  // Preselect a craft from the gallery ("Book this craft" / ?craft=<id>).
  useEffect(() => {
    if (!info || !initialCraftId) return
    const c = info.crafts.find((x) => x.id === initialCraftId)
    if (c) setSelectedCraft(c)
  }, [info, initialCraftId])

  // Step transition
  useEffect(() => {
    if (currentStep !== prevStepRef.current) {
      setVisible(false)
      const timer = setTimeout(() => {
        setDisplayStep(currentStep)
        prevStepRef.current = currentStep
        setVisible(true)
      }, 200)
      return () => clearTimeout(timer)
    }
  }, [currentStep])

  const perHead = selectedCraft?.perHeadCents ?? 0
  const perHeadMax = selectedCraft?.perHeadMaxCents ?? perHead
  const hasPriceRange = perHeadMax > perHead // craft has multiple variants → show a range
  const craftLines = craftBreakdown(selectedCraft?.name ?? 'Craft', perHead, people)
  const deposit = BASE_FEE_CENTS // charged today to book
  const craftEstimate = craftTotalCents(perHead, people) // paid at the studio, based on attendance

  const stepIdx = stepIndex(currentStep, steps)
  const progress = completed ? 100 : steps.length > 1 ? (stepIdx / (steps.length - 1)) * 100 : 100

  function goNext() {
    const next = nextStep(currentStep, steps)
    if (next) {
      trackWizardStepCompleted(currentStep)
      setCurrentStep(next)
    }
  }

  function handleBack() {
    const prev = prevStep(currentStep, steps)
    if (prev) setCurrentStep(prev)
    else onClose()
  }

  async function handleDateChange(date: string) {
    setSelectedDate(date)
    setSelectedSlot(null)
    setAvailableSlots([])
    setSlotsError(null)
    setSlotMissed(false)
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

  // Full name + both contact channels: the confirmation email carries the
  // host's party-page link, and phone is how the studio reaches a host day-of.
  const infoValid =
    !!firstName.trim() &&
    !!lastName.trim() &&
    isValidEmail(email.trim()) &&
    phone.replace(/\D/g, '').length >= 10

  async function handlePay(walletToken?: string) {
    if (processing || !info || !selectedSlot || !selectedCraft) return
    if (!infoValid) {
      setError('Add your full name, email, and phone above first — we need them for your confirmation and to reach you on party day.')
      return
    }

    setError(null)
    setProcessing(true)
    trackPaymentStarted(deposit / 100)

    try {
      let token = walletToken
      if (!token) {
        try {
          token = await paymentFormRef.current!.tokenize()
        } catch {
          throw new Error('Could not process your card. Please check your details and try again.')
        }
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
            description: selectedCraft.description ?? '',
          },
          people,
          customer: {
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            email: email.trim(),
            phone: phone.trim(),
          },
          paymentToken: token,
        }),
      })

      if (!bookRes.ok) {
        const errData = await bookRes.json().catch(() => null)
        throw new Error(errData?.detail ?? 'Booking failed.')
      }

      const json = await bookRes.json()
      const data = json.data ?? json
      setReceiptUrl(data.receiptUrl ?? null)
      setTotalCharged(typeof data.totalCharged === 'number' ? data.totalCharged : deposit)
      const newBookingId = typeof data.bookingId === 'string' ? data.bookingId : null
      const newHostToken = typeof data.hostToken === 'string' ? data.hostToken : null
      setBookingId(newBookingId)
      setHostToken(newHostToken)
      setEmailSent(data.emailSent === true)
      setCompleted(true)

      // Remember this booking so the host can return to their party page later
      // (the links otherwise live only on this confirmation screen).
      if (newBookingId && selectedSlot && selectedCraft) {
        saveRecentParty({
          bookingId: newBookingId,
          hostToken: newHostToken ?? undefined,
          craftName: selectedCraft.name,
          slotLabel: formatSlotLabel(selectedSlot.startAt),
          startIso: selectedSlot.startAt,
          savedAt: new Date().toISOString(),
        })
      }
      trackPaymentCompleted(deposit / 100)
      trackBookingCompleted('party')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred. Please try again.'
      setError(message)
      trackPaymentFailed(message)
    } finally {
      setProcessing(false)
    }
  }

  async function handleNotifyMe() {
    if (!isValidEmail(notifyEmail.trim()) || notifyState === 'sending') return
    setNotifyState('sending')
    try {
      const res = await fetch('/api/party/notify-me.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: notifyEmail.trim() }),
      })
      if (!res.ok) throw new Error()
      setNotifyState('done')
    } catch {
      setNotifyState('error')
    }
  }

  async function handleShareInvite() {
    if (!selectedSlot || !selectedCraft) return
    // Share ONLY the link — the invitation page is the invitation, and unfurls
    // into a rich preview when pasted. No blurb to duplicate the page content.
    const url = bookingId
      ? partyInviteUrl(
          {
            bookingId,
            craftName: selectedCraft.name,
            slotLabel: formatSlotLabel(selectedSlot.startAt),
            startIso: selectedSlot.startAt,
            title: partyTitle.trim() || undefined,
          },
          window.location.origin
        )
      : `${window.location.origin}/book`
    if (navigator.share) {
      try {
        // title gives the native sheet context; the URL is the payload.
        await navigator.share({ title: partyTitle.trim() || 'You’re invited!', url })
        return
      } catch {
        /* user closed the sheet — fall through to copy */
      }
    }
    try {
      await navigator.clipboard.writeText(url)
      setInviteCopied(true)
      setTimeout(() => setInviteCopied(false), 2500)
    } catch {
      /* clipboard unavailable — nothing sensible to do */
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

  const pillButtonStyle = (active: boolean): React.CSSProperties => ({
    padding: '0.625rem 0.5rem',
    borderRadius: '0.625rem',
    border: active ? '1px solid var(--color-primary)' : '1px solid rgba(150, 112, 91, 0.15)',
    background: active ? 'rgba(150, 112, 91, 0.12)' : 'rgba(255, 255, 255, 0.8)',
    fontSize: '0.8125rem',
    fontWeight: active ? 600 : 500,
    color: 'var(--color-dark)',
    cursor: 'pointer',
    transition: 'background 0.2s ease, border-color 0.2s ease',
  })

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
                : `Craft cost (~${formatPrice(craftEstimate)}) is an estimate — you pay it at the studio on the day, based on who attends (${partyConfig.minGuests}-craft minimum).`}
            </p>
          </>
        )}
        <div style={{ height: '0.25rem' }} />
      </>
    )
  }

  function renderTrustBlock() {
    return (
      <div style={{ marginTop: '0.875rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
        <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--color-muted)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <span aria-hidden>🔒</span> {partyContent.trust.securedBy}
        </p>
        <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--color-muted)' }}>
          {partyContent.trust.nothingElseDue}
        </p>
        {partyContent.trust.reschedulePolicy && (
          <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--color-muted)' }}>
            {partyContent.trust.reschedulePolicy}
          </p>
        )}
      </div>
    )
  }

  function renderConfirmation() {
    const slotStart = selectedSlot?.startAt
    const slotEnd = selectedSlot?.endAt
    // Host's party page — used for the "View your party page" button only.
    const hostPageUrl =
      bookingId && typeof window !== 'undefined'
        ? `${window.location.origin}/party/${encodeURIComponent(bookingId)}${hostToken ? `?key=${encodeURIComponent(hostToken)}` : ''}`
        : ''
    // Invite URL is token-free — safe to embed in a shared calendar event.
    const confirmInviteUrl =
      bookingId && slotStart && selectedCraft && typeof window !== 'undefined'
        ? partyInviteUrl(
            {
              bookingId,
              craftName: selectedCraft.name,
              slotLabel: formatSlotLabel(slotStart),
              startIso: slotStart,
              title: partyTitle.trim() || undefined,
            },
            window.location.origin,
          )
        : ''
    const calendarEvent = slotStart && slotEnd
      ? {
          title: `${selectedCraft ? `${selectedCraft.name} — ` : ''}Party at Homegrown Studio`,
          startIso: slotStart,
          endIso: slotEnd,
          details: confirmInviteUrl
            ? `Your private party at Homegrown Studio.\n\nInvitation link for guests: ${confirmInviteUrl}`
            : 'Private party at Homegrown Studio. homegrowncraftstudio.com',
          location: 'Homegrown Studio',
        }
      : null

    return (
      <div style={{ textAlign: 'center', padding: '1rem 0' }}>
        <div style={{
          width: '3.5rem',
          height: '3.5rem',
          margin: '0 auto 1.25rem',
          borderRadius: '50%',
          background: 'rgba(34, 197, 94, 0.1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '1.75rem',
        }}>
          🎉
        </div>
        <h3 style={{
          fontSize: '1.375rem',
          fontFamily: 'var(--font-heading)',
          fontWeight: 600,
          color: 'var(--color-dark)',
          marginBottom: '0.5rem',
        }}>
          You&rsquo;re booked!
        </h3>
        {selectedSlot && (
          <p style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--color-dark)', margin: '0 0 0.25rem' }}>
            {selectedCraft ? `${selectedCraft.name} · ` : ''}{formatSlotLabel(selectedSlot.startAt)}
          </p>
        )}
        <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', lineHeight: 1.6, maxWidth: '24rem', margin: '0 auto' }}>
          {emailSent
            ? <>Your private studio party is confirmed — a confirmation is on its way to <strong>{email}</strong>.</>
            : 'Save your party page link below — it\'s how you get back to your party.'}
        </p>
        {totalCharged !== null && (
          <p style={{ fontSize: '0.875rem', color: 'var(--color-dark)', fontWeight: 600, marginTop: '0.5rem' }}>
            Studio fee paid: {formatPrice(totalCharged)}
          </p>
        )}

        {/* Optional party name — personalizes the shared invitation. The booker
            usually isn't who the party's for (e.g. "Ari's 7th Birthday"). */}
        {bookingId && (
          <div style={{ maxWidth: '20rem', margin: '1.25rem auto 0', textAlign: 'left' }}>
            <label
              htmlFor="party-title"
              style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-muted)', marginBottom: '0.3rem' }}
            >
              Party name for your invitation (optional)
            </label>
            <input
              id="party-title"
              value={partyTitle}
              onChange={(e) => setPartyTitle(e.target.value)}
              placeholder="e.g. Maya’s Birthday · Team Night"
              style={{
                width: '100%',
                padding: '0.55rem 0.75rem',
                borderRadius: '0.625rem',
                border: '1px solid rgba(150, 112, 91, 0.25)',
                background: 'rgba(255, 255, 255, 0.85)',
                fontSize: '0.9375rem',
                color: 'var(--color-dark)',
                outline: 'none',
              }}
            />
          </div>
        )}

        {/* Add to calendar + invite the guests — the two things a host does next. */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', justifyContent: 'center', marginTop: '1.25rem' }}>
          {calendarEvent && (
            <>
              <a
                href={googleCalendarUrl(calendarEvent)}
                target="_blank"
                rel="noopener noreferrer"
                style={{ ...chipStyle, textDecoration: 'none', cursor: 'pointer', padding: '0.5rem 0.9rem' }}
              >
                📅 Google Calendar
              </a>
              <a
                href={icsDataUrl(buildIcs(calendarEvent))}
                download="homegrown-party.ics"
                style={{ ...chipStyle, textDecoration: 'none', cursor: 'pointer', padding: '0.5rem 0.9rem' }}
              >
                📅 Apple / Outlook
              </a>
            </>
          )}
          <button
            type="button"
            onClick={handleShareInvite}
            style={{ ...chipStyle, cursor: 'pointer', padding: '0.5rem 0.9rem' }}
          >
            {inviteCopied ? '✓ Copied!' : '💌 Invite your guests'}
          </button>
          {bookingId && (
            <a
              href={partyWaiverUrl(bookingId, typeof window !== 'undefined' ? window.location.origin : '')}
              target="_blank"
              rel="noopener noreferrer"
              style={{ ...chipStyle, textDecoration: 'none', cursor: 'pointer', padding: '0.5rem 0.9rem' }}
            >
              {waiverContent.handoff.hostCta}
            </a>
          )}
        </div>

        {/* Your party page — details + who's RSVP'd, for the host. */}
        {bookingId && hostToken && (
          <a
            href={`${typeof window !== 'undefined' ? window.location.origin : ''}/party/${encodeURIComponent(bookingId)}?key=${encodeURIComponent(hostToken)}`}
            style={{
              display: 'inline-block',
              marginTop: '1rem',
              padding: '0.7rem 1.4rem',
              borderRadius: '0.875rem',
              background: 'linear-gradient(135deg, var(--color-primary), var(--color-accent))',
              color: '#fff',
              fontSize: '0.9375rem',
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            View your party page →
          </a>
        )}
        {bookingId && !hostToken && (
          <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', lineHeight: 1.6, maxWidth: '24rem', margin: '1rem auto 0' }}>
            We couldn&rsquo;t set up your party page — text us at {partyContent.textNumber} and we&rsquo;ll send you the link.
          </p>
        )}

        {/* What happens next */}
        <div style={{ maxWidth: '22rem', margin: '1.5rem auto 0', textAlign: 'left' }}>
          {(emailSent ? partyContent.confirmation.nextStepsEmail : partyContent.confirmation.nextStepsNoEmail).map((step, i) => (
            <div key={i} style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
              <span style={{
                flexShrink: 0,
                width: '1.375rem',
                height: '1.375rem',
                borderRadius: '50%',
                background: 'rgba(150, 112, 91, 0.12)',
                color: 'var(--color-primary)',
                fontSize: '0.6875rem',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                {i + 1}
              </span>
              <span style={{ fontSize: '0.8125rem', color: 'var(--color-muted)', lineHeight: 1.5 }}>{step}</span>
            </div>
          ))}
        </div>

        {selectedCraft?.personalized && (
          <p style={{ fontSize: '0.8125rem', color: 'var(--color-muted)', lineHeight: 1.55, maxWidth: '24rem', margin: '1rem auto 0' }}>
            Since your craft is personalized, we&rsquo;ll email you to collect your final headcount and
            personalization details.
          </p>
        )}
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

  function renderStep() {
    if (completed) return renderConfirmation()

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
      // CRAFT
      case 'craft':
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
                        <span style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-dark)' }}>
                          {craft.name}
                          {craft.popular && (
                            <span style={{ marginLeft: '0.5rem', verticalAlign: 'middle', display: 'inline-block', background: 'linear-gradient(135deg, var(--color-primary), var(--color-accent))', color: '#fff', borderRadius: '2rem', padding: '0.15rem 0.55rem', fontSize: '0.65rem', fontWeight: 700 }}>
                              ♥ Most popular
                            </span>
                          )}
                        </span>
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
              onClick={goNext}
              disabled={!selectedCraft || (!!selectedCraft.personalized && !ackPersonalized)}
              style={primaryButtonStyle(!!selectedCraft && (!selectedCraft.personalized || ackPersonalized))}
            >
              Continue
            </button>
          </div>
        )

      // WHEN (date + time)
      case 'when': {
        // Real scarcity: how many starts this weekday offers vs how many remain.
        const expectedStarts = selectedDate ? partyStartsForDate(selectedDate).length : 0
        const showScarcity =
          !loadingSlots && !slotsError && selectedDate &&
          availableSlots.length > 0 && expectedStarts > availableSlots.length

        return (
          <div>
            {slotMissed && (
              <p style={{
                fontSize: '0.8125rem',
                color: '#92400e',
                background: 'rgba(251, 191, 36, 0.12)',
                border: '1px solid rgba(180, 83, 9, 0.25)',
                borderRadius: '0.625rem',
                padding: '0.625rem 0.875rem',
                marginBottom: '1rem',
              }}>
                {availableSlots.length === 0
                  ? 'That time was just booked and this date is now full — pick another date.'
                  : 'That time was just booked — these are still open.'}
              </p>
            )}
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ ...labelStyle, marginBottom: '0.25rem' }}>Choose a Date</label>
              <p style={{ fontSize: '0.75rem', color: 'var(--color-muted)', margin: '0 0 0.75rem' }}>
                Every party is {partyConfig.durationMinutes} minutes — the whole studio, just your group.
              </p>
              {loadingDates && (
                <p style={{ fontSize: '0.8125rem', color: 'var(--color-muted)' }}>Loading available dates…</p>
              )}
              {datesError && (
                <div style={{ marginBottom: '0.75rem' }}>
                  <p style={{ fontSize: '0.8125rem', color: '#dc2626', marginBottom: '0.5rem' }}>{datesError}</p>
                  <button type="button" onClick={loadAvailableDates} style={{ ...primaryButtonStyle(true), width: 'auto', padding: '0.5rem 1rem', fontSize: '0.8125rem' }}>
                    Try again
                  </button>
                </div>
              )}
              {!loadingDates && !datesError && availableDates.length === 0 && (
                <div>
                  <p style={{ fontSize: '0.8125rem', color: 'var(--color-muted)', marginBottom: '0.75rem' }}>
                    Every party date is currently booked. Leave your email and we&rsquo;ll let you know
                    the moment new dates open up.
                  </p>
                  {notifyState === 'done' ? (
                    <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'rgb(34, 197, 94)' }}>
                      ✓ You&rsquo;re on the list — we&rsquo;ll email you when dates open.
                    </p>
                  ) : (
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <input
                        type="email"
                        value={notifyEmail}
                        onChange={(e) => setNotifyEmail(e.target.value)}
                        placeholder="you@example.com"
                        style={{ ...inputStyle, flex: 1 }}
                      />
                      <button
                        type="button"
                        onClick={handleNotifyMe}
                        disabled={!isValidEmail(notifyEmail.trim()) || notifyState === 'sending'}
                        style={{ ...primaryButtonStyle(isValidEmail(notifyEmail.trim()) && notifyState !== 'sending'), width: 'auto', padding: '0.75rem 1.25rem' }}
                      >
                        {notifyState === 'sending' ? '…' : 'Notify me'}
                      </button>
                    </div>
                  )}
                  {notifyState === 'error' && (
                    <p style={{ fontSize: '0.75rem', color: '#dc2626', marginTop: '0.5rem' }}>
                      That didn&rsquo;t go through — please try again.
                    </p>
                  )}
                </div>
              )}
              {availableDates.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(8rem, 1fr))', gap: '0.5rem' }}>
                  {availableDates.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => handleDateChange(d)}
                      style={pillButtonStyle(selectedDate === d)}
                    >
                      {formatDateLabel(d)}
                    </button>
                  ))}
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

            {!loadingSlots && selectedDate && !slotsError && availableSlots.length === 0 && availableDates.length > 0 && (
              <p style={{ fontSize: '0.8125rem', color: 'var(--color-muted)', marginBottom: '1rem' }}>
                No available start times for this date. Please choose another.
              </p>
            )}

            {availableSlots.length > 0 && (
              <div style={{ marginBottom: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <label style={labelStyle}>Start Time</label>
                  {showScarcity && (
                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#b45309' }}>
                      Only {availableSlots.length} of {expectedStarts} times left
                    </span>
                  )}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(7rem, 1fr))', gap: '0.5rem' }}>
                  {availableSlots.map((slot) => (
                    <button
                      key={slot.startAt}
                      type="button"
                      onClick={() => setSelectedSlot(slot)}
                      style={pillButtonStyle(selectedSlot?.startAt === slot.startAt)}
                    >
                      {formatTime(slot.startAt)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={goNext}
              disabled={!selectedSlot}
              style={primaryButtonStyle(!!selectedSlot)}
            >
              Continue
            </button>
          </div>
        )
      }

      // WHO (guests)
      case 'who':
        return (
          <div>
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ ...labelStyle, marginBottom: '0.5rem' }}>About how many guests?</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.875rem' }}>
                {partyConfig.guestQuickPicks.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setPeople(n)}
                    style={{ ...pillButtonStyle(people === n), minWidth: '3.25rem', padding: '0.625rem 0.75rem' }}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <button
                  type="button"
                  aria-label="Fewer guests"
                  onClick={() => setPeople(Math.max(partyConfig.minGuests, people - 1))}
                  disabled={people <= partyConfig.minGuests}
                  style={{
                    width: '2.5rem',
                    height: '2.5rem',
                    borderRadius: '0.5rem',
                    border: '1px solid rgba(150, 112, 91, 0.15)',
                    background: 'rgba(255, 255, 255, 0.8)',
                    fontSize: '1.25rem',
                    cursor: people <= partyConfig.minGuests ? 'default' : 'pointer',
                    opacity: people <= partyConfig.minGuests ? 0.3 : 1,
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
                  aria-label="More guests"
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
                  : `Parties are for ${partyConfig.minGuests}–${partyConfig.maxGuests} guests with a ${partyConfig.minGuests}-craft minimum. This is just an estimate — you'll pay for crafts at the studio based on who actually comes.`}
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
              onClick={goNext}
              style={primaryButtonStyle(true)}
            >
              Continue
            </button>
          </div>
        )

      // PAY (details + payment on one screen)
      case 'pay':
        return (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
              <div>
                <label style={labelStyle}>First Name *</label>
                <input type="text" autoComplete="given-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Last Name *</label>
                <input type="text" autoComplete="family-name" value={lastName} onChange={(e) => setLastName(e.target.value)} style={inputStyle} />
              </div>
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <label style={labelStyle}>Email *</label>
              <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} />
            </div>
            <div style={{ marginBottom: '1.25rem' }}>
              <label style={labelStyle}>Phone *</label>
              <input type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} style={inputStyle} />
            </div>

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

            {/* Party charges go through the standard Payments API, so the SDK runs
                under OUR application (from client-config) — required for Apple Pay,
                whose domain registration is tied to our app. The CLASS_BOOKING_APP_ID
                override is only for the workshops flow (buyer-facing classes API). */}
            <PaymentForm
              ref={paymentFormRef}
              environmentOverride="production"
              wallet={{ amount: (deposit / 100).toFixed(2), label: 'Homegrown Studio — party studio fee', bnpl: true }}
              onWalletToken={(token) => handlePay(token)}
              canPayWithWallet={() =>
                infoValid ? null : 'Add your full name, email, and phone above first — we need them for your confirmation and to reach you on party day.'
              }
            />

            {error && (
              <p style={{ fontSize: '0.875rem', color: '#dc2626', marginTop: '0.75rem' }}>{error}</p>
            )}

            <button
              type="button"
              onClick={() => handlePay()}
              disabled={processing || !infoValid}
              style={{
                width: '100%',
                marginTop: '1.25rem',
                padding: '0.875rem',
                background: processing || !infoValid
                  ? 'rgba(150, 112, 91, 0.4)'
                  : 'linear-gradient(135deg, var(--color-primary), var(--color-accent))',
                color: '#fff',
                border: 'none',
                borderRadius: '0.75rem',
                fontSize: '0.875rem',
                fontWeight: 600,
                cursor: processing || !infoValid ? 'default' : 'pointer',
                opacity: processing ? 0.7 : 1,
                transition: 'box-shadow 0.3s ease, transform 0.3s ease',
              }}
            >
              {processing ? 'Processing...' : `Pay ${formatPrice(deposit)} & reserve your date`}
            </button>

            {renderTrustBlock()}
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
        alignItems: sheetMode ? 'flex-end' : 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.4)',
        backdropFilter: 'blur(4px)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) requestClose()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Book a Party"
        tabIndex={-1}
        style={{
          width: '100%',
          maxWidth: sheetMode ? 'none' : '40rem',
          maxHeight: sheetMode ? '94dvh' : '90vh',
          overflow: 'auto',
          margin: sheetMode ? 0 : '1rem',
          padding: sheetMode ? '1.5rem 1.25rem 2rem' : '2.5rem',
          background: 'linear-gradient(135deg, rgba(255,255,255,0.92) 0%, rgba(255,255,255,0.85) 50%, rgba(255,255,255,0.9) 100%)',
          backdropFilter: 'blur(32px) saturate(1.4)',
          WebkitBackdropFilter: 'blur(32px) saturate(1.4)',
          border: '1px solid rgba(255, 255, 255, 0.6)',
          borderRadius: sheetMode ? '1.25rem 1.25rem 0 0' : '1.25rem',
          boxShadow: '0 24px 80px rgba(0, 0, 0, 0.15), 0 8px 24px rgba(150, 112, 91, 0.08)',
          outline: 'none',
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
            onClick={requestClose}
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

        {/* Progress bar — counts only the steps this visitor will actually see */}
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
                {stepLabel(currentStep)}
              </span>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>
                Step {stepIdx + 1} of {steps.length}
              </span>
            </div>
            <div style={{ height: '2px', background: 'rgba(150, 112, 91, 0.1)', borderRadius: '1px', overflow: 'hidden' }}>
              <div
                role="progressbar"
                aria-valuenow={stepIdx + 1}
                aria-valuemin={1}
                aria-valuemax={steps.length}
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

        {/* Selection summary — keeps the craft (and its photo) present through checkout */}
        {!completed && (selectedSlot || selectedCraft) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1.25rem' }}>
            {selectedCraft && (
              <span style={{ ...chipStyle, paddingLeft: selectedCraft.imageUrl ? '0.3rem' : '0.75rem' }}>
                {selectedCraft.imageUrl && (
                  <img
                    src={selectedCraft.imageUrl}
                    alt=""
                    style={{ width: '1.5rem', height: '1.5rem', borderRadius: '50%', objectFit: 'cover', display: 'block' }}
                  />
                )}
                {selectedCraft.name}
              </span>
            )}
            {selectedSlot && <span style={chipStyle}>{formatSlotLabel(selectedSlot.startAt)}</span>}
            {(currentStep === 'pay' || completed) && (
              <span style={chipStyle}>~{people} guest{people > 1 ? 's' : ''}</span>
            )}
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

        {/* Discard guard bar — shown above step content when user tries to close mid-flow */}
        {confirmDiscard && (
          <div style={{
            marginBottom: '1.25rem',
            padding: '0.875rem 1rem',
            borderRadius: '0.75rem',
            background: 'rgba(254, 243, 199, 0.9)',
            border: '1px solid rgba(180, 83, 9, 0.25)',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '0.75rem',
          }}>
            <span style={{ flex: 1, fontSize: '0.875rem', fontWeight: 500, color: '#92400e' }}>
              Close and lose your progress?
            </span>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                type="button"
                onClick={() => setConfirmDiscard(false)}
                style={{
                  padding: '0.5rem 1rem',
                  borderRadius: '0.625rem',
                  border: '1px solid var(--color-primary)',
                  background: 'var(--color-primary)',
                  color: '#fff',
                  fontSize: '0.8125rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Keep booking
              </button>
              <button
                type="button"
                onClick={onClose}
                style={{
                  padding: '0.5rem 1rem',
                  borderRadius: '0.625rem',
                  border: '1px solid rgba(150, 112, 91, 0.3)',
                  background: 'transparent',
                  color: 'var(--color-dark)',
                  fontSize: '0.8125rem',
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                Close
              </button>
            </div>
          </div>
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

        {/* Human escape hatch — only when a real number is configured */}
        {!completed && partyContent.textNumber && (
          <p style={{ marginTop: '1.5rem', textAlign: 'center', fontSize: '0.8125rem', color: 'var(--color-muted)' }}>
            Questions?{' '}
            <a href={`sms:${partyContent.textNumber.replace(/[^+\d]/g, '')}`} style={{ color: 'var(--color-primary)', fontWeight: 600 }}>
              Text us at {partyContent.textNumber}
            </a>{' '}
            — we reply fast.
          </p>
        )}

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
