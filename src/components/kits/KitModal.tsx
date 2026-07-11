import { useState, useEffect, useRef, useMemo } from 'react'
import PaymentForm from '@components/checkout/PaymentForm'
import type { PaymentFormRef } from '@components/checkout/PaymentForm'
import { kitContent, kitThemes } from '@config/kit-content'
import {
  visibleSteps,
  stepLabel,
  stepIndex,
  nextStep,
  prevStep,
  type KitStepId,
} from '@lib/kit-steps'

interface KitModalProps {
  onClose: () => void
  /** Optional craft id (from a landing card / ?craft= deeplink) to preselect and skip the Craft step. */
  initialCraftId?: string
  /** Optional theme id (from a landing card / ?theme= deeplink) to arrive preselected on the build step. */
  initialThemeId?: string
}

interface Craft {
  id: string
  name: string
  perHeadCents: number
  perHeadMaxCents?: number
  description?: string
  imageUrl?: string | null
  popular?: boolean
}

interface Tier {
  serves: number
  packagePriceCents: number
  depositCents: number
}

interface Theme {
  id: string
  displayName: string
  tagline: string
  scheme: string
  photo: string
  stocked: boolean
  tiers: Tier[]
}

interface KitServiceInfo {
  crafts: Craft[]
  themes: Theme[]
  assemblyFeeCents: number
  minGuests: number
  maxGuests: number
  tierSizes?: number[]
  leadTimeDays: number
  returnWindow: string
}

interface WeekDate {
  partyDate: string
  pickupDate: string
  returnBy: string
  themes: Record<string, number[]>
}

/** Order summary echoed back by /api/kits/order.json. */
interface OrderSummary {
  pickupDate: string
  returnBy: string
  returnWindow: string
  totalChargedCents: number
  quoteTotalCents?: number
  balanceDueCents?: number
  depositCents?: number
  receiptUrl?: string | null
  emailSent?: boolean
}

function formatPrice(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
}
function priceCompact(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : formatPrice(cents)
}
function perPersonLabel(minCents: number, maxCents?: number): string {
  return maxCents && maxCents > minCents ? `${priceCompact(minCents)}–${priceCompact(maxCents)}` : formatPrice(minCents)
}

/** "Sat, Aug 15" from a local YYYY-MM-DD string (built locally to avoid a UTC day shift). */
function formatDateLabel(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}
/** "Sat 15" — compact day chip inside a week card. */
function formatDayChip(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' })
}
/** "Saturday, August 15" — the prominent confirmation format. */
function formatDateLong(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export default function KitModal({ onClose, initialCraftId, initialThemeId }: KitModalProps) {
  const [currentStep, setCurrentStep] = useState<KitStepId>('build')
  const [visible, setVisible] = useState(true)
  const [displayStep, setDisplayStep] = useState<KitStepId>('build')
  const prevStepRef = useRef<KitStepId>('build')

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
  const [info, setInfo] = useState<KitServiceInfo | null>(null)
  const [infoError, setInfoError] = useState<string | null>(null)

  // Guest bounds and package sizes come from the server (kit.config via
  // service-info) — the fallbacks only cover the pre-fetch render.
  const minGuests = info?.minGuests ?? 10
  const maxGuests = info?.maxGuests ?? 20
  const tierSizes = useMemo(
    () => (info?.tierSizes?.length ? [...info.tierSizes].sort((a, b) => a - b) : [10, 15, 20]),
    [info],
  )

  // Selections
  const [selectedCraft, setSelectedCraft] = useState<Craft | null>(null)
  const [guests, setGuests] = useState<number>(10)
  // null = undecided; 'none' = crafts-only; otherwise a theme id.
  const [themeChoice, setThemeChoice] = useState<string | 'none' | null>(null)
  const [selectedDate, setSelectedDate] = useState('')

  // Availability weeks
  const [weeks, setWeeks] = useState<WeekDate[]>([])
  const [loadingWeeks, setLoadingWeeks] = useState(false)
  const [weeksError, setWeeksError] = useState<string | null>(null)

  // Contact
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [rentalTermsAccepted, setRentalTermsAccepted] = useState(false)

  // Discard guard
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const dirty = !!selectedCraft || !!firstName.trim() || !!email.trim()

  // Payment / completion
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [completed, setCompleted] = useState(false)
  const [reference, setReference] = useState<string | null>(null)
  const [summary, setSummary] = useState<OrderSummary | null>(null)
  const paymentFormRef = useRef<PaymentFormRef>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  const hasTheme = !!themeChoice && themeChoice !== 'none'
  /** Smallest offered package that seats everyone (server sizes, not arithmetic). */
  const tierGuests = tierSizes.find((s) => s >= guests) ?? tierSizes[tierSizes.length - 1]
  const selectedTheme = hasTheme ? info?.themes.find((t) => t.id === themeChoice) ?? null : null
  const selectedTier = selectedTheme?.tiers.find((t) => t.serves === tierGuests) ?? null

  function requestClose() {
    if (completed || !dirty) return onClose()
    setConfirmDiscard(true)
  }

  // Body scroll lock
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  // Focus the dialog card on mount so screen readers announce it and Escape works immediately.
  useEffect(() => {
    dialogRef.current?.focus()
  }, [])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (confirmDiscard) setConfirmDiscard(false)
      else requestClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [dirty, completed, confirmDiscard])

  // Focus trap: Tab cycles within the dialog instead of escaping to the page.
  function trapFocus(e: React.KeyboardEvent) {
    if (e.key !== 'Tab') return
    const root = dialogRef.current
    if (!root) return
    const focusables = [...root.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )].filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null)
    if (!focusables.length) return
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    const active = document.activeElement
    if (e.shiftKey && (active === first || active === root)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }

  useEffect(() => {
    if (completed) setConfirmDiscard(false)
  }, [completed])

  // Craft preselected from a landing card → drop the craft step.
  const craftSettled = !!initialCraftId && !!selectedCraft && selectedCraft.id === initialCraftId
  const steps = useMemo(() => visibleSteps({ craftSettled }), [craftSettled])

  // Keep the current step valid as settled steps drop out.
  useEffect(() => {
    if (!steps.includes(currentStep)) {
      setCurrentStep(steps[0])
      setDisplayStep(steps[0])
      prevStepRef.current = steps[0]
    }
  }, [steps, currentStep])

  // Fetch service info on open (retryable).
  async function loadServiceInfo() {
    setInfoError(null)
    try {
      const res = await fetch('/api/kits/service-info.json', { cache: 'no-store' })
      if (!res.ok) throw new Error('Failed to load kit details.')
      const json = await res.json()
      setInfo((json.data ?? json) as KitServiceInfo)
    } catch (err) {
      setInfoError(err instanceof Error ? err.message : 'Failed to load kit details.')
    }
  }
  useEffect(() => { loadServiceInfo() }, [])

  // Guest count starts at the server minimum once it's known.
  useEffect(() => {
    if (info) setGuests((g) => Math.min(Math.max(g, info.minGuests), info.maxGuests))
  }, [info])

  // Preselect a craft from the gallery.
  useEffect(() => {
    if (!info || !initialCraftId) return
    const c = info.crafts.find((x) => x.id === initialCraftId)
    if (c) setSelectedCraft(c)
  }, [info, initialCraftId])

  // Preselect a theme from the gallery — the user landed here because they
  // fell for a table; the build step arrives with it already chosen.
  useEffect(() => {
    if (!info || !initialThemeId) return
    const t = info.themes.find((x) => x.id === initialThemeId && x.stocked)
    if (t) setThemeChoice(t.id)
  }, [info, initialThemeId])

  // Load the selectable party dates + per-theme availability. Availability is
  // live, so refetch when the modal opens.
  async function loadWeeks() {
    setLoadingWeeks(true)
    setWeeksError(null)
    try {
      const res = await fetch('/api/kits/weeks.json', { cache: 'no-store' })
      if (!res.ok) throw new Error()
      const json = await res.json()
      setWeeks(((json.data ?? json).dates ?? []) as WeekDate[])
    } catch {
      setWeeksError('Could not load available dates.')
    } finally {
      setLoadingWeeks(false)
    }
  }
  useEffect(() => {
    if (info) loadWeeks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info])

  // A date is bookable for the current selection: crafts-only accepts any
  // orderable date; a themed order needs the guest tier offered that week.
  function dateAvailable(d: WeekDate): boolean {
    if (!hasTheme) return true
    return (d.themes[themeChoice as string] ?? []).includes(tierGuests)
  }

  // The date picker groups party dates by their pickup Thursday — the actual
  // inventory unit. Availability is per-week, so one flag covers all its days.
  const weekGroups = useMemo(() => {
    const map = new Map<string, { pickupDate: string; returnBy: string; days: WeekDate[] }>()
    for (const w of weeks) {
      const entry = map.get(w.pickupDate) ?? { pickupDate: w.pickupDate, returnBy: w.returnBy, days: [] }
      entry.days.push(w)
      map.set(w.pickupDate, entry)
    }
    return [...map.values()]
  }, [weeks])

  // If the guest count or theme changes such that the chosen date is no longer
  // bookable, drop the selection so the user re-picks.
  useEffect(() => {
    if (!selectedDate) return
    const entry = weeks.find((w) => w.partyDate === selectedDate)
    if (entry && !dateAvailable(entry)) setSelectedDate('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeChoice, guests, weeks])

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

  const stepIdx = stepIndex(currentStep, steps)
  const progress = completed ? 100 : steps.length > 1 ? (stepIdx / (steps.length - 1)) * 100 : 100

  function goNext() {
    const next = nextStep(currentStep, steps)
    if (next) setCurrentStep(next)
  }
  function handleBack() {
    const prev = prevStep(currentStep, steps)
    if (prev) setCurrentStep(prev)
    else onClose()
  }

  // Pricing — deposit-only booking: $50 today (themed = the refundable rental
  // deposit, crafts-only = the assembly fee), the rest on the POS at pickup.
  // MUST mirror the server's rule in api/kits/order.json.
  const perHead = selectedCraft?.perHeadCents ?? 0
  const craftTotal = perHead * guests
  const assemblyFee = info?.assemblyFeeCents ?? 0
  const packageCents = selectedTier?.packagePriceCents ?? 0
  const depositCents = selectedTier?.depositCents ?? 0
  const quoteTotal = craftTotal + assemblyFee + (hasTheme ? packageCents + depositCents : 0)
  const dueToday = hasTheme ? depositCents : assemblyFee
  const balanceDue = Math.max(0, quoteTotal - dueToday)

  const selectedWeek = weeks.find((w) => w.partyDate === selectedDate) ?? null

  const infoValid =
    !!firstName.trim() &&
    !!lastName.trim() &&
    isValidEmail(email.trim()) &&
    phone.replace(/\D/g, '').length >= 10 &&
    address.trim().length >= 8
  const payValid = infoValid && (!hasTheme || rentalTermsAccepted)

  async function handlePay(walletToken?: string) {
    if (processing || !info || !selectedCraft || !selectedDate) return
    if (hasTheme && !selectedTier) return
    if (!payValid) {
      setError('Add your name, email, phone, and party address above first — and accept the rental terms if you added a table.')
      return
    }

    setError(null)
    setProcessing(true)

    try {
      let token = walletToken
      if (!token) {
        try {
          token = await paymentFormRef.current!.tokenize()
        } catch {
          throw new Error('Could not process your card. Please check your details and try again.')
        }
      }

      const res = await fetch('/api/kits/order.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          crafts: [{ craftId: selectedCraft.id, name: selectedCraft.name, perHeadCents: selectedCraft.perHeadCents }],
          guests,
          theme: hasTheme ? { themeId: themeChoice, serves: tierGuests } : undefined,
          partyDate: selectedDate,
          contact: {
            name: `${firstName.trim()} ${lastName.trim()}`.trim(),
            email: email.trim(),
            phone: phone.trim(),
            address: address.trim(),
          },
          rentalTermsAccepted: hasTheme ? rentalTermsAccepted : undefined,
          paymentToken: token,
        }),
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => null)
        throw new Error(errData?.detail ?? 'Order failed.')
      }

      const json = await res.json()
      const data = json.data ?? json
      setReference(typeof data.reference === 'string' ? data.reference : null)
      setSummary((data.summary ?? null) as OrderSummary | null)
      setCompleted(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred. Please try again.')
    } finally {
      setProcessing(false)
    }
  }

  // ---- shared styles (mirrors PartyModal) ----
  const primaryButtonStyle = (enabled: boolean): React.CSSProperties => ({
    width: '100%',
    padding: '0.875rem',
    background: enabled ? 'linear-gradient(135deg, var(--color-primary), var(--color-accent))' : 'rgba(150, 112, 91, 0.2)',
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

  function renderSummaryRows() {
    return (
      <>
        {selectedCraft && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem', color: 'var(--color-muted)', marginBottom: '0.375rem' }}>
            <span>{selectedCraft.name} × {guests} @ {formatPrice(perHead)}</span>
            <span>{formatPrice(craftTotal)}</span>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem', color: 'var(--color-muted)', marginBottom: '0.375rem' }}>
          <span>Kit assembly</span>
          <span>{formatPrice(assemblyFee)}</span>
        </div>
        {hasTheme && selectedTier && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem', color: 'var(--color-muted)', marginBottom: '0.375rem' }}>
              <span>{selectedTheme?.displayName} — serves {selectedTier.serves}</span>
              <span>{formatPrice(packageCents)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem', color: 'var(--color-muted)', marginBottom: '0.375rem' }}>
              <span>Rental deposit (refundable)</span>
              <span>{formatPrice(depositCents)}</span>
            </div>
          </>
        )}
        <div style={{ height: '0.25rem' }} />
      </>
    )
  }

  function renderConfirmation() {
    const partyDateLabel = selectedDate ? formatDateLong(selectedDate) : ''
    const pickupLabel = summary?.pickupDate ? formatDateLong(summary.pickupDate) : ''
    const returnLabel = summary?.returnBy ? formatDateLong(summary.returnBy) : ''
    const returnWindow = summary?.returnWindow ?? info?.returnWindow ?? ''
    // Return list comes from the theme config (service-info omits it).
    const returns = hasTheme ? kitThemes.find((t) => t.id === themeChoice)?.returns ?? [] : []

    const DateRow = ({ label, value }: { label: string; value: string }) => (
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '1rem', padding: '0.6rem 0', borderBottom: '1px solid rgba(150, 112, 91, 0.1)' }}>
        <span style={{ fontSize: '0.8125rem', color: 'var(--color-muted)' }}>{label}</span>
        <span style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--color-dark)', textAlign: 'right' }}>{value}</span>
      </div>
    )

    return (
      <div style={{ textAlign: 'center', padding: '1rem 0' }}>
        <div style={{ width: '3.5rem', height: '3.5rem', margin: '0 auto 1.25rem', borderRadius: '50%', background: 'rgba(34, 197, 94, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.75rem' }}>
          🎉
        </div>
        <h3 style={{ fontSize: '1.375rem', fontFamily: 'var(--font-heading)', fontWeight: 600, color: 'var(--color-dark)', marginBottom: '0.5rem' }}>
          Your kit is booked!
        </h3>
        <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', lineHeight: 1.6, maxWidth: '24rem', margin: '0 auto' }}>
          {summary?.emailSent
            ? <>A confirmation is on its way to <strong>{email}</strong>.</>
            : 'Keep your reference handy — it\'s how we find your order.'}
          {reference && <> Your reference is <strong>{reference}</strong>.</>}
        </p>

        {/* The three dates — the whole rhythm of a kit. */}
        <div style={{ maxWidth: '22rem', margin: '1.5rem auto 0', textAlign: 'left', padding: '0.5rem 1rem', borderRadius: '0.875rem', background: 'rgba(255, 255, 255, 0.6)', border: '1px solid rgba(150, 112, 91, 0.1)' }}>
          {partyDateLabel && <DateRow label="Your party" value={partyDateLabel} />}
          {pickupLabel && <DateRow label="Pick up (Thursday)" value={pickupLabel} />}
          {returnLabel && <DateRow label={`Return by (Wed, ${returnWindow})`} value={returnLabel} />}
        </div>

        {summary && (
          <p style={{ fontSize: '0.875rem', color: 'var(--color-dark)', fontWeight: 600, marginTop: '0.85rem' }}>
            Paid today: {formatPrice(summary.totalChargedCents)}
            {summary.depositCents ? <span style={{ fontWeight: 500, color: 'var(--color-muted)' }}> — your refundable deposit</span> : null}
            {summary.balanceDueCents ? (
              <span style={{ display: 'block', fontWeight: 500, color: 'var(--color-muted)', marginTop: '0.2rem' }}>
                {formatPrice(summary.balanceDueCents)} due at pickup Thursday — card or cash at the studio.
              </span>
            ) : null}
          </p>
        )}

        {/* What comes back to us */}
        {returns.length > 0 && (
          <div style={{ maxWidth: '22rem', margin: '1.25rem auto 0', textAlign: 'left' }}>
            <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-dark)', margin: '0 0 0.5rem' }}>
              Comes home to us (by Wednesday, {returnWindow}):
            </p>
            <ul style={{ margin: 0, paddingLeft: '1.1rem', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              {returns.map((item) => (
                <li key={item} style={{ fontSize: '0.8125rem', color: 'var(--color-muted)', lineHeight: 1.5 }}>{item}</li>
              ))}
            </ul>
            <p style={{ fontSize: '0.75rem', color: 'var(--color-muted)', margin: '0.6rem 0 0', fontStyle: 'italic' }}>
              {kitContent.depositLine}
            </p>
          </div>
        )}

        {summary?.receiptUrl && (
          <a href={summary.receiptUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', marginTop: '1rem', fontSize: '0.875rem', color: 'var(--color-primary)' }}>
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
          <button type="button" onClick={loadServiceInfo} style={primaryButtonStyle(true)}>Try again</button>
        </div>
      )
    }
    if (!info) {
      return <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)' }}>Loading kit details...</p>
    }

    switch (displayStep) {
      // CRAFT
      case 'craft':
        return (
          <div>
            <label style={{ ...labelStyle, marginBottom: '0.75rem' }}>Choose a Craft</label>
            <p style={{ fontSize: '0.75rem', color: 'var(--color-muted)', margin: '0 0 0.875rem' }}>
              Every guest makes one — we box exactly enough for your headcount.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem', marginBottom: '1.5rem' }}>
              {info.crafts.map((craft) => {
                const active = selectedCraft?.id === craft.id
                return (
                  <div
                    key={craft.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={active}
                    onClick={() => setSelectedCraft(craft)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedCraft(craft) } }}
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
                        <img src={craft.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                        {active && (
                          <span aria-hidden style={{ position: 'absolute', top: '0.625rem', right: '0.625rem', width: '1.5rem', height: '1.5rem', borderRadius: '999px', background: 'var(--color-primary)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', boxShadow: '0 1px 4px rgba(0,0,0,0.25)' }}>✓</span>
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
                        <p style={{ margin: '0.4rem 0 0', fontSize: '0.8125rem', lineHeight: 1.55, color: 'var(--color-muted)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                          {craft.description}
                        </p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
            <button type="button" onClick={goNext} disabled={!selectedCraft} style={primaryButtonStyle(!!selectedCraft)}>
              Continue
            </button>
          </div>
        )

      // BUILD — guests and the optional themed table, together: the guest
      // count picks the package size, so the table prices update live.
      case 'build':
        return (
          <div>
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ ...labelStyle, marginBottom: '0.5rem' }}>How many guests?</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.875rem' }}>
                {tierSizes.map((n) => (
                  <button key={n} type="button" onClick={() => setGuests(n)} style={{ ...pillButtonStyle(guests === n), minWidth: '3.25rem', padding: '0.625rem 0.75rem' }}>
                    {n}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <button
                  type="button"
                  aria-label="Fewer guests"
                  onClick={() => setGuests(Math.max(minGuests, guests - 1))}
                  disabled={guests <= minGuests}
                  style={{ width: '2.5rem', height: '2.5rem', borderRadius: '0.5rem', border: '1px solid rgba(150, 112, 91, 0.15)', background: 'rgba(255, 255, 255, 0.8)', fontSize: '1.25rem', cursor: guests <= minGuests ? 'default' : 'pointer', opacity: guests <= minGuests ? 0.3 : 1, color: 'var(--color-dark)' }}
                >
                  &minus;
                </button>
                <span style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--color-dark)', minWidth: '2rem', textAlign: 'center' }}>{guests}</span>
                <button
                  type="button"
                  aria-label="More guests"
                  onClick={() => setGuests(Math.min(maxGuests, guests + 1))}
                  disabled={guests >= maxGuests}
                  style={{ width: '2.5rem', height: '2.5rem', borderRadius: '0.5rem', border: '1px solid rgba(150, 112, 91, 0.15)', background: 'rgba(255, 255, 255, 0.8)', fontSize: '1.25rem', cursor: guests >= maxGuests ? 'default' : 'pointer', opacity: guests >= maxGuests ? 0.3 : 1, color: 'var(--color-dark)' }}
                >
                  +
                </button>
              </div>
              <p style={{ fontSize: '0.75rem', color: 'var(--color-muted)', marginTop: '0.5rem' }}>
                Kits are for {minGuests}–{maxGuests} guests. We box a craft for each — you can nudge the exact count with us before pickup.
                A one-time {formatPrice(assemblyFee)} assembly fee covers packing everything.
              </p>
            </div>

            <label style={{ ...labelStyle, marginBottom: '0.25rem' }}>Add a Themed Table?</label>
            <p style={{ fontSize: '0.75rem', color: 'var(--color-muted)', margin: '0 0 1rem' }}>
              A styled, photograph-worthy table that comes packed and labeled — or skip it and just take the crafts.
              {guests !== tierGuests && <> Packages come in sizes of {tierSizes.join(' / ')}, so {guests} guests get the serves-{tierGuests} set.</>}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.25rem' }}>
              {info.themes.filter((t) => t.stocked).map((theme) => {
                const tier = theme.tiers.find((t) => t.serves === tierGuests)
                const active = themeChoice === theme.id
                return (
                  <div
                    key={theme.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={active}
                    onClick={() => setThemeChoice(theme.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setThemeChoice(theme.id) } }}
                    style={{
                      display: 'flex',
                      gap: '0.875rem',
                      alignItems: 'center',
                      padding: '0.75rem',
                      borderRadius: '0.875rem',
                      border: active ? '2px solid var(--color-primary)' : '1px solid rgba(150, 112, 91, 0.18)',
                      background: active ? 'rgba(150, 112, 91, 0.08)' : 'rgba(255, 255, 255, 0.85)',
                      cursor: 'pointer',
                      transition: 'background 0.2s ease, border-color 0.2s ease',
                    }}
                  >
                    <div style={{ width: '4rem', height: '4rem', borderRadius: '0.6rem', overflow: 'hidden', flexShrink: 0, background: 'linear-gradient(135deg, rgba(150,112,91,0.10), rgba(198,167,142,0.20))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {theme.photo
                        ? <img src={theme.photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                        : <span aria-hidden style={{ fontSize: '1.25rem' }}>🎀</span>}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--color-dark)' }}>{theme.displayName}</span>
                      <p style={{ margin: '0.15rem 0 0', fontSize: '0.78rem', color: 'var(--color-muted)', lineHeight: 1.4 }}>{theme.tagline}</p>
                    </div>
                    {tier && (
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <span style={{ display: 'block', fontSize: '0.9375rem', fontWeight: 700, color: 'var(--color-dark)' }}>{priceCompact(tier.packagePriceCents)}</span>
                        <span style={{ fontSize: '0.7rem', color: 'var(--color-muted)' }}>+ {priceCompact(tier.depositCents)} deposit</span>
                      </div>
                    )}
                  </div>
                )
              })}

              {/* First-class crafts-only option */}
              <div
                role="button"
                tabIndex={0}
                aria-pressed={themeChoice === 'none'}
                onClick={() => setThemeChoice('none')}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setThemeChoice('none') } }}
                style={{
                  padding: '0.875rem 1rem',
                  borderRadius: '0.875rem',
                  border: themeChoice === 'none' ? '2px solid var(--color-primary)' : '1px solid rgba(150, 112, 91, 0.18)',
                  background: themeChoice === 'none' ? 'rgba(150, 112, 91, 0.08)' : 'rgba(255, 255, 255, 0.85)',
                  cursor: 'pointer',
                  transition: 'background 0.2s ease, border-color 0.2s ease',
                }}
              >
                <span style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--color-dark)' }}>No themed table — just crafts</span>
                <p style={{ margin: '0.15rem 0 0', fontSize: '0.78rem', color: 'var(--color-muted)', lineHeight: 1.4 }}>
                  Just the crafts, boxed for your group. Nothing to return.
                </p>
              </div>
            </div>

            {hasTheme && (
              <p style={{ fontSize: '0.75rem', color: 'var(--color-muted)', margin: '0 0 1rem', fontStyle: 'italic' }}>
                {kitContent.depositLine}
              </p>
            )}

            <button type="button" onClick={goNext} disabled={themeChoice === null} style={primaryButtonStyle(themeChoice !== null)}>
              Continue
            </button>
          </div>
        )

      // WHEN — weeks, not a wall of days: kits live on a Thu→Wed cycle, so the
      // picker groups party dates under their pickup Thursday.
      case 'when':
        return (
          <div>
            <label style={{ ...labelStyle, marginBottom: '0.25rem' }}>When&rsquo;s the party?</label>
            <p style={{ fontSize: '0.75rem', color: 'var(--color-muted)', margin: '0 0 0.875rem' }}>
              Kits need {info.leadTimeDays} days of lead time. Pick your party day — pickup is the Thursday of that week, return the Wednesday after.
            </p>

            {loadingWeeks && <p style={{ fontSize: '0.8125rem', color: 'var(--color-muted)' }}>Loading available dates…</p>}
            {weeksError && (
              <div style={{ marginBottom: '0.75rem' }}>
                <p style={{ fontSize: '0.8125rem', color: '#dc2626', marginBottom: '0.5rem' }}>{weeksError}</p>
                <button type="button" onClick={loadWeeks} style={{ ...primaryButtonStyle(true), width: 'auto', padding: '0.5rem 1rem', fontSize: '0.8125rem' }}>Try again</button>
              </div>
            )}
            {!loadingWeeks && !weeksError && weekGroups.length === 0 && (
              <p style={{ fontSize: '0.8125rem', color: 'var(--color-muted)' }}>No dates are open right now — check back soon.</p>
            )}

            {weekGroups.length > 0 && (
              <div style={{ maxHeight: '22rem', overflowY: 'auto', marginBottom: '1.25rem', paddingRight: '0.25rem', display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                {weekGroups.map((wk) => {
                  const open = dateAvailable(wk.days[0])
                  const containsSelection = wk.days.some((d) => d.partyDate === selectedDate)
                  return (
                    <div
                      key={wk.pickupDate}
                      style={{
                        borderRadius: '0.875rem',
                        border: containsSelection ? '2px solid var(--color-primary)' : '1px solid rgba(150, 112, 91, 0.15)',
                        background: 'rgba(255, 255, 255, 0.75)',
                        padding: '0.75rem 0.875rem',
                        opacity: open ? 1 : 0.55,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap', marginBottom: open ? '0.6rem' : 0 }}>
                        <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--color-dark)' }}>
                          Week of {formatDateLabel(wk.pickupDate)}
                        </span>
                        <span style={{ fontSize: '0.72rem', color: 'var(--color-muted)' }}>
                          {open
                            ? <>pick up {formatDayChip(wk.pickupDate)} · return {formatDayChip(wk.returnBy)}</>
                            : <>{selectedTheme?.displayName ?? 'That table'} is fully booked this week — <a href="/book" style={{ color: 'var(--color-primary)', fontWeight: 600 }}>party at the studio?</a></>}
                        </span>
                      </div>
                      {open && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                          {wk.days.map((d) => (
                            <button
                              key={d.partyDate}
                              type="button"
                              onClick={() => setSelectedDate(d.partyDate)}
                              style={{ ...pillButtonStyle(selectedDate === d.partyDate), padding: '0.5rem 0.7rem', fontSize: '0.78rem' }}
                            >
                              {formatDayChip(d.partyDate)}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {selectedWeek && (
              <div style={{ padding: '0.875rem 1rem', borderRadius: '0.75rem', background: 'rgba(34, 197, 94, 0.06)', border: '1px solid rgba(34, 197, 94, 0.15)', marginBottom: '1.25rem' }}>
                <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--color-dark)', lineHeight: 1.5 }}>
                  Party <strong>{formatDateLabel(selectedWeek.partyDate)}</strong> · Pick up <strong>{formatDateLabel(selectedWeek.pickupDate)}</strong> · Return by <strong>{formatDateLabel(selectedWeek.returnBy)}</strong>, {info.returnWindow}
                </p>
              </div>
            )}

            <button type="button" onClick={goNext} disabled={!selectedDate} style={primaryButtonStyle(!!selectedDate)}>
              Continue
            </button>
          </div>
        )

      // PAY
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
            <div style={{ marginBottom: '1rem' }}>
              <label style={labelStyle}>Phone *</label>
              <input type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} style={inputStyle} />
            </div>
            <div style={{ marginBottom: '1.25rem' }}>
              <label style={labelStyle}>Party address *</label>
              <input
                type="text"
                autoComplete="street-address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Where the party's happening — in case we need to rescue our plates 😄"
                style={inputStyle}
              />
            </div>

            {/* Order summary — full quote, then the deposit split. */}
            <div style={{ padding: '1rem 1.25rem', borderRadius: '0.75rem', background: 'rgba(255, 255, 255, 0.6)', border: '1px solid rgba(150, 112, 91, 0.08)', marginBottom: '1rem' }}>
              {renderSummaryRows()}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderTop: '1px solid rgba(150, 112, 91, 0.08)', paddingTop: '0.625rem' }}>
                <span style={{ fontSize: '0.875rem', color: 'var(--color-muted)' }}>Total</span>
                <span style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--color-dark)' }}>{formatPrice(quoteTotal)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: '0.375rem' }}>
                <span style={{ fontSize: '0.875rem', color: 'var(--color-muted)' }}>
                  Due today {hasTheme ? '(your refundable deposit)' : '(kit assembly)'}
                </span>
                <span style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--color-dark)' }}>{formatPrice(dueToday)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: '0.25rem' }}>
                <span style={{ fontSize: '0.8125rem', color: 'var(--color-muted)' }}>Due at pickup (Thursday, card or cash)</span>
                <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-muted)' }}>{formatPrice(balanceDue)}</span>
              </div>
            </div>

            {/* Rental terms — inline and in full view, only when a table (with
                returnable pieces) is added. The customer must be able to READ
                what the checkbox binds them to, right here. */}
            {hasTheme && (
              <div style={{ padding: '0.875rem 1rem', borderRadius: '0.75rem', background: 'rgba(150, 112, 91, 0.05)', border: '1px solid rgba(150, 112, 91, 0.12)', marginBottom: '1.25rem' }}>
                <p style={{ margin: '0 0 0.5rem', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-dark)' }}>Rental terms, in brief</p>
                <ul style={{ margin: '0 0 0.75rem', paddingLeft: '1.1rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  {kitContent.rentalTermsBrief.map((t) => (
                    <li key={t} style={{ fontSize: '0.78rem', color: 'var(--color-muted)', lineHeight: 1.5 }}>{t}</li>
                  ))}
                </ul>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={rentalTermsAccepted}
                    onChange={(e) => setRentalTermsAccepted(e.target.checked)}
                    style={{ marginTop: '0.15rem', width: '1rem', height: '1rem', flexShrink: 0, cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--color-dark)', lineHeight: 1.5 }}>
                    I agree to the rental terms above. The full rental agreement comes with your pickup paperwork.
                  </span>
                </label>
              </div>
            )}

            {/* Kit charges run through the standard Payments API under OUR app
                (required for Apple Pay). No applicationIdOverride — party convention. */}
            <PaymentForm
              ref={paymentFormRef}
              environmentOverride="production"
              wallet={{ amount: (dueToday / 100).toFixed(2), label: 'Homegrown Kit Deposit' }}
              onWalletToken={(token) => handlePay(token)}
              canPayWithWallet={() => (payValid ? null : 'Add your name, email, phone, and party address above first — and accept the rental terms if you added a table.')}
            />

            {error && <p style={{ fontSize: '0.875rem', color: '#dc2626', marginTop: '0.75rem' }}>{error}</p>}

            <button
              type="button"
              onClick={() => handlePay()}
              disabled={processing || !payValid}
              style={{
                width: '100%',
                marginTop: '1.25rem',
                padding: '0.875rem',
                background: processing || !payValid ? 'rgba(150, 112, 91, 0.4)' : 'linear-gradient(135deg, var(--color-primary), var(--color-accent))',
                color: '#fff',
                border: 'none',
                borderRadius: '0.75rem',
                fontSize: '0.875rem',
                fontWeight: 600,
                cursor: processing || !payValid ? 'default' : 'pointer',
                opacity: processing ? 0.7 : 1,
                transition: 'box-shadow 0.3s ease, transform 0.3s ease',
              }}
            >
              {processing ? 'Processing...' : `Pay ${formatPrice(dueToday)} deposit & book your week`}
            </button>
            <p style={{ margin: '0.6rem 0 0', fontSize: '0.72rem', color: 'var(--color-muted)', textAlign: 'center' }}>
              🔒 Payments processed securely by Square. {formatPrice(balanceDue)} due at pickup.
              {hasTheme && <> Your {formatPrice(depositCents)} deposit comes back when the pieces do.</>}
              {' '}Cancel {info.leadTimeDays}+ days before pickup for a full refund.
            </p>
          </div>
        )

      default:
        return null
    }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: sheetMode ? 'flex-end' : 'center', justifyContent: 'center', background: 'rgba(0, 0, 0, 0.4)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) requestClose() }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Build a Kit"
        tabIndex={-1}
        onKeyDown={trapFocus}
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
          <h2 style={{ fontSize: '1.25rem', fontFamily: 'var(--font-heading)', fontWeight: 600, color: 'var(--color-dark)' }}>
            Build a Kit
          </h2>
          <button type="button" onClick={requestClose} aria-label="Close" style={{ background: 'none', border: 'none', fontSize: '1.5rem', color: 'var(--color-muted)', cursor: 'pointer', padding: '0.25rem', lineHeight: 1 }}>
            &times;
          </button>
        </div>

        {/* Progress bar */}
        {!completed && (
          <nav aria-label="Kit progress" style={{ marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '0.8125rem', fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-dark)' }}>
                {stepLabel(currentStep)}
              </span>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>Step {stepIdx + 1} of {steps.length}</span>
            </div>
            <div style={{ height: '2px', background: 'rgba(150, 112, 91, 0.1)', borderRadius: '1px', overflow: 'hidden' }}>
              <div
                role="progressbar"
                aria-valuenow={stepIdx + 1}
                aria-valuemin={1}
                aria-valuemax={steps.length}
                style={{ height: '100%', width: `${progress}%`, background: 'linear-gradient(90deg, var(--color-primary), var(--color-accent))', borderRadius: '1px', transition: 'width 0.5s cubic-bezier(0.25, 0.1, 0, 1)' }}
              />
            </div>
          </nav>
        )}

        {/* Selection summary chips + live total. No price surprises at the end:
            the running "Due today" figure travels with the customer from the
            first choice on (it already includes the assembly fee). */}
        {!completed && (selectedCraft || themeChoice !== null) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem' }}>
            {selectedCraft && (
              <span style={{ ...chipStyle, paddingLeft: selectedCraft.imageUrl ? '0.3rem' : '0.75rem' }}>
                {selectedCraft.imageUrl && <img src={selectedCraft.imageUrl} alt="" style={{ width: '1.5rem', height: '1.5rem', borderRadius: '50%', objectFit: 'cover', display: 'block' }} />}
                {selectedCraft.name}
              </span>
            )}
            <span style={chipStyle}>{guests} guests</span>
            {selectedTheme && <span style={chipStyle}>{selectedTheme.displayName}</span>}
            {selectedDate && <span style={chipStyle}>{formatDateLabel(selectedDate)}</span>}
            {displayStep !== 'pay' && (
              <span style={{ ...chipStyle, marginLeft: 'auto', background: 'rgba(150, 112, 91, 0.12)', fontWeight: 600 }}>
                {formatPrice(dueToday)} today{selectedCraft ? <> · {formatPrice(quoteTotal)} total</> : null}
              </span>
            )}
          </div>
        )}

        {/* Back button */}
        {!completed && (
          <button
            type="button"
            onClick={handleBack}
            style={{ marginBottom: '1.25rem', fontSize: '0.8125rem', color: 'var(--color-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: '0.375rem', transition: 'color 0.3s ease' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-dark)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-muted)')}
          >
            <span style={{ fontSize: '0.875rem' }}>&larr;</span>
            Back
          </button>
        )}

        {/* Discard guard */}
        {confirmDiscard && (
          <div
            role="alertdialog"
            aria-modal="true"
            aria-label="Close and lose your progress?"
            onClick={(e) => { if (e.target === e.currentTarget) setConfirmDiscard(false) }}
            style={{ position: 'fixed', inset: 0, zIndex: 110, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0, 0, 0, 0.35)', backdropFilter: 'blur(2px)' }}
          >
            <div style={{ width: 'calc(100% - 3rem)', maxWidth: '22rem', padding: '1.5rem 1.5rem 1.25rem', borderRadius: '1rem', background: 'linear-gradient(135deg, rgba(255,255,255,0.97) 0%, rgba(255,255,255,0.92) 100%)', border: '1px solid rgba(255, 255, 255, 0.6)', boxShadow: '0 24px 60px rgba(0, 0, 0, 0.25)', textAlign: 'center' }}>
              <p style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: 'var(--color-dark)' }}>Close and lose your progress?</p>
              <p style={{ margin: '0.4rem 0 1.1rem', fontSize: '0.8125rem', color: 'var(--color-muted)' }}>Your selections aren&rsquo;t saved yet.</p>
              <div style={{ display: 'flex', gap: '0.6rem' }}>
                <button type="button" onClick={() => setConfirmDiscard(false)} autoFocus style={{ flex: 1.4, padding: '0.7rem 1rem', borderRadius: '0.75rem', border: 'none', background: 'linear-gradient(135deg, var(--color-primary), var(--color-accent))', color: '#fff', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer' }}>
                  Keep building
                </button>
                <button type="button" onClick={onClose} style={{ flex: 1, padding: '0.7rem 1rem', borderRadius: '0.75rem', border: '1px solid rgba(150, 112, 91, 0.3)', background: 'transparent', color: 'var(--color-muted)', fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer' }}>
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step content with transition */}
        <div style={{ opacity: visible ? 1 : 0, transform: visible ? 'translateY(0)' : 'translateY(12px)', transition: 'opacity 0.3s cubic-bezier(0.16, 1, 0.3, 1), transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)' }}>
          {renderStep()}
        </div>

        {/* Done button on completion */}
        {completed && (
          <button
            type="button"
            onClick={onClose}
            style={{ marginTop: '1.5rem', width: '100%', padding: '0.875rem', background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: '0.75rem', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', transition: 'filter 0.3s ease' }}
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
