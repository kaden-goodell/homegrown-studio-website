import { useState, useEffect, useRef, useMemo, useId, type FormEvent } from 'react'
import PaymentForm from '@components/checkout/PaymentForm'
import type { PaymentFormRef } from '@components/checkout/PaymentForm'
import BookingPanel from '@components/shared/BookingPanel'
import BookingConfirmed, { ConfirmedBlock } from '@components/shared/BookingConfirmed'
import ContactFields, { type ContactFieldsHandle } from '@components/shared/ContactFields'
import NotifyMe from '@components/shared/NotifyMe'
import type { EmailCheckData } from '@components/shared/EmailCheck'
import ShareLink from '@components/shared/ShareLink'
import PartyPriceSummary from './PartyPriceSummary'
import { partyConfig } from '@config/party.config'
import { partyContent, defaultPackageOf } from '@config/party-content'
import { partyCheckoutPolicySummary, POLICY_PATH, POLICY_ANCHORS } from '@config/policy-content'
import { STUDIO_ADDRESS, STUDIO_ADDRESS_LINE, STUDIO_DIRECTIONS_URL } from '@config/studio-address'
import { configPublicFacts, partyStartsForDate, settingsFromFacts, type PublicPartyFacts } from '@lib/parties/party-times'
import { quoteParty } from '@lib/parties/pricing'
import type { PartyAddOn, PartyPackage } from '@lib/parties/types'
import { visibleSteps, stepLabel, stepIndex, nextStep, prevStep, type PartyStepId } from '@lib/party-steps'
import { partySummary } from '@lib/party-summary'
import { partyRefundLine } from '@lib/refund-lines'
import { contactIsUsable, contactStarted, EMPTY_CONTACT, type Contact } from '@lib/contact-rules'
import { formatMoney } from '@lib/money'
import {
  googleCalendarUrl,
  buildIcs,
  icsDataUrl,
  partyWaiverUrl,
  partyInviteUrl,
  partyInviteMailto,
  partyInviteIcsUrl,
  PICKED_CRAFT_KEY,
} from '@lib/party-share'
import { formatTime, formatSlotLabel, formatDayAndSpan } from '@lib/studio-time'
import { saveRecentParty } from '@lib/recent-party'
import { newAttemptId } from '@lib/checkout-attempt'
import { messageForFailure, outcomeUnknown, partyMessages, UNKNOWN_OUTCOME_MESSAGE } from '@lib/checkout-messages'
import {
  trackWizardStarted,
  trackWizardStepCompleted,
  trackPaymentStarted,
  trackPaymentCompleted,
  trackPaymentFailed,
  trackBookingCompleted,
  trackSelectItem,
  trackBookingChoice,
  trackBeginCheckout,
  trackAddPaymentInfo,
  trackBookingAbandoned,
  trackBookingProblem,
  type AnalyticsItem,
  posthogId,
  identifyBooker,
  trackViewItem,
  trackShare,
  trackAddToCalendar,
} from '@lib/analytics'
import { readAttribution } from '@lib/attribution'

interface PartyModalProps {
  onClose: () => void
  /** ISO start time (from `?start=` / the calendar) to preselect. If it is still open, the date step is skipped. */
  initialStart?: string
  /**
   * Craft id (from a craft card or a shared `?craft=` link) to preselect. The
   * panel still opens on the craft step, with this craft first, selected and
   * fully described, so it can be read and changed.
   */
  initialCraftId?: string
  /** Local date YYYY-MM-DD (from `?date=` / a calendar day) to preselect. */
  initialDate?: string
  /** A package only booked by link (`/book?package=<id>`, the test package): offered and preselected. */
  linkPackageId?: string
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

/** In-studio themed-table add-on (present only when the kit product is live + seeded). */
interface PartyTheme {
  id: string
  displayName: string
  tagline: string
  photo: string
  tiers: { serves: number; packagePriceCents: number }[]
}

interface ServiceInfo {
  /** What /book may know of Parties setup (the config until an owner saves). Older answers have none. */
  facts?: PublicPartyFacts
  crafts: Craft[]
  themes?: PartyTheme[]
}

interface Slot {
  startAt: string
  endAt: string
  durationMinutes: number
}

const TEXT_US = partyContent.textNumber
const COULD_NOT_LOAD = TEXT_US ? `We couldn’t load this. Try again, or text us at ${TEXT_US}.` : 'We couldn’t load this. Please try again.'
const POLICY_UNTICKED = 'Tick the box to agree to the booking and cancellation policy.'

/** "Sat, Aug 15" from a local YYYY-MM-DD string (built locally to avoid a UTC day shift). */
function formatDateLabel(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

/** An add-on's price as offered: "$75", "$8 a guest". */
function addOnPriceLabel(a: PartyAddOn): string {
  return a.per === 'guest' ? `${formatMoney(a.priceCents)} a guest` : formatMoney(a.priceCents)
}

/** "$25" for a single price, "$30–$40" when a craft has a price range. */
function perPersonLabel(minCents: number, maxCents?: number): string {
  return maxCents && maxCents > minCents ? `${formatMoney(minCents)}–${formatMoney(maxCents)}` : formatMoney(minCents)
}

/**
 * The months with dates past the booking window, for "planning something
 * later?". The first is the month of the day after the window ends: when the
 * window ends on the 11th, the rest of that month is still to come.
 */
function laterMonths(count: number, lastBookable: string): { value: string; label: string }[] {
  const [y, m, day] = lastBookable.split('-').map(Number)
  const first = new Date(y, m - 1, day + 1)
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(first.getFullYear(), first.getMonth() + i, 1)
    return {
      value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    }
  })
}

const sectionLabel = { margin: '0 0 0.5rem', fontSize: '1rem', fontWeight: 600, color: 'var(--color-dark)' } as const
const helpText = { margin: 0, fontSize: '0.875rem', lineHeight: 1.5, color: 'var(--color-text)' } as const
const chipStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.4rem',
  padding: '0.3rem 0.75rem',
  borderRadius: '2rem',
  background: 'var(--color-sand)',
  border: '1px solid var(--color-line)',
  fontSize: '0.8125rem',
  fontWeight: 500,
  color: 'var(--color-dark)',
  whiteSpace: 'nowrap',
} as const

function pillStyle(active: boolean, disabled = false) {
  return {
    minHeight: '2.75rem',
    padding: '0.5rem 0.625rem',
    borderRadius: '0.625rem',
    border: active ? '2px solid var(--color-primary)' : '1.5px solid var(--color-field-border)',
    background: active ? 'rgba(var(--color-primary-rgb), 0.1)' : 'var(--color-surface)',
    fontSize: '0.9375rem',
    fontWeight: active ? 600 : 500,
    fontFamily: 'inherit',
    color: disabled ? 'var(--color-text)' : 'var(--color-dark)',
    opacity: disabled ? 0.6 : 1,
    cursor: disabled ? 'default' : 'pointer',
  } as const
}

export default function PartyModal({ onClose, initialStart, initialCraftId, initialDate, linkPackageId }: PartyModalProps) {
  const [currentStep, setCurrentStep] = useState<PartyStepId>('craft')

  // Service info
  const [info, setInfo] = useState<ServiceInfo | null>(null)
  const [infoError, setInfoError] = useState(false)

  // Date / availability
  const [selectedDate, setSelectedDate] = useState('')
  const [availableSlots, setAvailableSlots] = useState<Slot[]>([])
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [slotsError, setSlotsError] = useState(false)
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null)
  const [availableDates, setAvailableDates] = useState<string[]>([])
  const [bookedDates, setBookedDates] = useState<string[]>([])
  /** How many times each date offers at all (the server's answer: it knows the owners' closed days and café hours). */
  const [offeredByDate, setOfferedByDate] = useState<Record<string, number>>({})
  const [timesByDate, setTimesByDate] = useState<Record<string, Slot[]>>({})
  const [loadingDates, setLoadingDates] = useState(false)
  const [datesError, setDatesError] = useState(false)
  /** A calendar link carried an exact time that is still open: the date step drops out. */
  const [slotSettled, setSlotSettled] = useState(false)
  /** The time they wanted has gone. Says so on the date step. */
  const [slotMissed, setSlotMissed] = useState(false)
  /**
   * The date step is one of two things at a time, never both: picking one of
   * the open dates, or asking to be told when a later date opens.
   */
  const [whenMode, setWhenMode] = useState<'pick' | 'later'>('pick')
  const [laterMonth, setLaterMonth] = useState('')

  // Craft
  const [selectedCraft, setSelectedCraft] = useState<Craft | null>(null)
  const [expandedCraft, setExpandedCraft] = useState<string | null>(null)
  const [ackPersonalized, setAckPersonalized] = useState(false)

  // Package (a step only when there is a choice) and extras. `null` = the default package.
  const [packageId, setPackageId] = useState<string | null>(null)
  /** Extra id → how many (per guest extras: how many for each guest). */
  const [addOns, setAddOns] = useState<Record<string, number>>({})

  // Guests — anchored at a realistic party size, never 1.
  const [people, setPeople] = useState<number>(partyConfig.defaultGuests)
  /** True once the guest count was chosen by hand; the package's default guests apply until then. */
  const guestsChosen = useRef(false)

  // Optional in-studio themed table. `null` = "just crafts" (the default).
  const [selectedTheme, setSelectedTheme] = useState<PartyTheme | null>(null)
  const [themeDeselectedNote, setThemeDeselectedNote] = useState(false)

  // Contact and terms
  const [contact, setContact] = useState<Contact>(EMPTY_CONTACT)
  const [agreedToPolicy, setAgreedToPolicy] = useState(false)
  const [policyProblem, setPolicyProblem] = useState(false)
  /** What is missing on the current step, said when Continue is tapped. */
  const [stepProblem, setStepProblem] = useState('')
  /** Said when a package change moved the guest count. */
  const [guestNote, setGuestNote] = useState('')
  /** After a package change: drop the chosen date if the new package's dates don't include it. */
  const dropDateIfGone = useRef(false)
  /** With a time fixed by a link: extra-time add-on id → whether it fits that start. */
  const [timeExtraFits, setTimeExtraFits] = useState<Record<string, boolean>>({})
  /** Checking that the chosen start still fits the party with its extra time. */
  const [checkingExtras, setCheckingExtras] = useState(false)

  // Leaving
  const [askToLeave, setAskToLeave] = useState(false)
  /** True once the customer has chosen something themselves. A craft or date that arrived in a link doesn't count. */
  const [touched, setTouched] = useState(false)

  // Payment / completion
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [completed, setCompleted] = useState(false)
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null)
  const [totalCharged, setTotalCharged] = useState<number | null>(null)
  const [bookingId, setBookingId] = useState<string | null>(null)
  const [hostToken, setHostToken] = useState<string | null>(null)
  const [emailSent, setEmailSent] = useState(false)
  const [emailCheck, setEmailCheck] = useState<EmailCheckData | null>(null)
  const [partyTitle, setPartyTitle] = useState('')
  const [paymentReady, setPaymentReady] = useState(false)
  const paymentFormRef = useRef<PaymentFormRef>(null)
  const contactRef = useRef<ContactFieldsHandle>(null)
  const policyRef = useRef<HTMLInputElement>(null)
  const formId = useId()
  const policyErrorId = useId()
  const partyTitleId = useId()

  // ── Party settings ────────────────────────────────────────────────────────
  // Everything about the party (packages, extras, guests, length, times) comes
  // from the owners' Parties setup, sent with the service info. Until it has
  // arrived, the config stands in (the same answers until an owner saves).
  const firstPaintFacts = useMemo(() => configPublicFacts(new Date()), [])
  const facts: PublicPartyFacts = info?.facts ?? firstPaintFacts
  const settings = useMemo(() => settingsFromFacts(facts), [facts])
  /** The link-only package a `?package=` link named, when /book offers it. */
  const linkPackage = linkPackageId ? facts.packages.find((p) => p.id === linkPackageId && p.who === 'link') : undefined
  const pkg: PartyPackage =
    facts.packages.find((p) => p.id === packageId) ?? linkPackage ?? defaultPackageOf(facts) ?? firstPaintFacts.packages[0]
  const packageChoice = facts.packages.length > 1 || !!linkPackage
  const offeredAddOns = facts.addOns
  /** The extras chosen, without the ones set to none. */
  const chosenAddOns = useMemo(
    () => Object.fromEntries(Object.entries(addOns).filter(([id, n]) => n > 0 && offeredAddOns.some((a) => a.id === id))),
    [addOns, offeredAddOns],
  )
  const addOnsKey = JSON.stringify(Object.entries(chosenAddOns).sort())
  // Priced exactly as the server prices it (it prices it again when booking).
  const quoted = quoteParty(settings, { packageId: pkg.id, guests: people, addOns: chosenAddOns }, 'public', linkPackage?.id)
  const quote = quoted.ok ? quoted.value : null
  const extraItems = quote ? quote.items.filter((it) => it.kind === 'addon') : []
  /** Minutes the extras add to the party (extra time). */
  const extraMinutes = extraItems.reduce((m, it) => m + it.extraMinutes, 0)

  // One attempt ID per checkout. While we don't know how a try ended (dropped
  // connection, "we're not sure", "still finishing your last try"), a retry
  // sends the same ID, so the server can recognise its own earlier booking and
  // never book or charge twice. Changing what is being booked (time, craft,
  // guests, package, extras, table), or a plain "nothing was charged", starts
  // a new one.
  const attemptId = useRef(newAttemptId())
  useEffect(() => {
    attemptId.current = newAttemptId()
  }, [selectedSlot?.startAt, selectedCraft?.id, people, selectedTheme?.id, pkg.id, addOnsKey])

  useEffect(() => {
    trackWizardStarted('party')
  }, [])

  // Selecting a craft resets the personalized acknowledgment (must re-confirm per craft).
  useEffect(() => {
    setAckPersonalized(false)
  }, [selectedCraft?.id])

  // Keep the saved-invitation pointer in step with the party name the host
  // types on the confirmation screen.
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

  const steps = useMemo(
    () =>
      visibleSteps({
        slotSettled,
        themesAvailable: (info?.themes?.length ?? 0) > 0,
        addOnCount: offeredAddOns.length,
        packageCount: facts.packages.length,
        linkPackage: !!linkPackage,
      }),
    [slotSettled, info, offeredAddOns.length, facts.packages.length, linkPackage],
  )

  // When the settings arrive: a link package starts chosen, and the guest
  // count starts at the package's default until the customer picks one.
  useEffect(() => {
    if (!info) return
    if (linkPackage && packageId === null) setPackageId(linkPackage.id)
  }, [info, linkPackage, packageId])
  useEffect(() => {
    if (!guestsChosen.current) setPeople(pkg.defaultGuests)
  }, [pkg.id, pkg.defaultGuests])

  // Keep the current step valid as the flow changes under it.
  useEffect(() => {
    if (!steps.includes(currentStep)) setCurrentStep(steps[0])
  }, [steps, currentStep])

  // ── Loading ───────────────────────────────────────────────────────────────
  // Retryable: a brief network blip must not leave the panel empty for good.
  async function loadServiceInfo() {
    setInfoError(false)
    try {
      // ?test=1 on the page URL = staff smoke-test lane (shows TEST— crafts).
      const testLane = new URLSearchParams(window.location.search).get('test') === '1'
      const q = new URLSearchParams()
      if (testLane) q.set('includeTest', '1')
      if (linkPackageId) q.set('package', linkPackageId)
      const query = q.toString()
      const res = await fetch(`/api/party/service-info.json${query ? `?${query}` : ''}`, { cache: 'no-store' })
      if (!res.ok) throw new Error()
      const json = await res.json()
      setInfo((json.data ?? json) as ServiceInfo)
    } catch {
      setInfoError(true)
    }
  }

  useEffect(() => {
    loadServiceInfo()
  }, [])

  // Only dates with a party time still open are offered. Their times arrive
  // with them, so picking a date shows its times at once.
  async function loadAvailableDates(forPackage: string, isCancelled: () => boolean = () => false) {
    setLoadingDates(true)
    setDatesError(false)
    try {
      const res = await fetch('/api/party/available-dates.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageId: forPackage }),
      })
      if (!res.ok) throw new Error()
      const json = await res.json()
      const data = json.data ?? json
      if (isCancelled()) return
      if (dropDateIfGone.current) {
        dropDateIfGone.current = false
        if (selectedDate && !(data.dates ?? []).includes(selectedDate)) {
          setSelectedDate('')
          setAvailableSlots([])
        }
      }
      setAvailableDates(data.dates ?? [])
      setBookedDates(data.bookedDates ?? [])
      setTimesByDate(data.times ?? {})
      setOfferedByDate(data.offered ?? {})
    } catch {
      if (!isCancelled()) { setDatesError(true); trackBookingProblem('party', 'dates_unavailable') }
    } finally {
      if (!isCancelled()) setLoadingDates(false)
    }
  }

  // Party length depends on the package, so its dates are asked for again when it changes.
  useEffect(() => {
    if (!info) return
    let cancelled = false
    loadAvailableDates(pkg.id, () => cancelled)
    return () => {
      cancelled = true
    }
  }, [info, pkg.id])

  /** The open start times for a date, always asked fresh from the server (for this package and its extra time). */
  async function fetchAvailability(
    date: string,
    opts: { addOns?: Record<string, number>; packageId?: string } = {},
  ): Promise<Slot[]> {
    const withAddOns = opts.addOns ?? chosenAddOns
    const res = await fetch('/api/party/availability.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, packageId: opts.packageId ?? pkg.id, ...(Object.keys(withAddOns).length ? { addOns: withAddOns } : {}) }),
    })
    if (!res.ok) throw new Error()
    const json = await res.json()
    const data = json.data ?? json
    if (typeof data.offered === 'number') setOfferedByDate((m) => ({ ...m, [date]: data.offered }))
    return data.slots ?? []
  }

  // Link prefill: ?start=<ISO> preselects that date and time and removes the
  // date step. If the time has gone, the date step stays, with that date
  // chosen and a plain explanation. Runs once, when `info` has loaded.
  const prefillAttempted = useRef(false)
  useEffect(() => {
    if (!info || !initialStart || prefillAttempted.current) return
    prefillAttempted.current = true

    const startDate = new Date(initialStart)
    if (isNaN(startDate.getTime())) return
    const date = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`

    let cancelled = false
    setSelectedDate(date)
    setLoadingSlots(true)
    setSlotsError(false)
    ;(async () => {
      try {
        const slots = await fetchAvailability(date)
        if (cancelled) return
        setAvailableSlots(slots)
        const match = slots.find((s) => new Date(s.startAt).getTime() === startDate.getTime())
        if (match) {
          setSelectedSlot(match)
          setSlotSettled(true)
        } else {
          setSlotMissed(true)
        }
      } catch {
        if (!cancelled) setSlotsError(true)
      } finally {
        if (!cancelled) setLoadingSlots(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [info, initialStart])

  // Link prefill: ?date=<YYYY-MM-DD> preselects the date; the time is still theirs to pick.
  const datePrefillAttempted = useRef(false)
  useEffect(() => {
    if (!info || !initialDate || initialStart || datePrefillAttempted.current) return
    datePrefillAttempted.current = true
    if (!/^\d{4}-\d{2}-\d{2}$/.test(initialDate)) return
    chooseDate(initialDate, { byCustomer: false })
  }, [info, initialDate, initialStart])

  // A craft from a craft card or a shared link arrives selected and opened up.
  useEffect(() => {
    if (!info || !initialCraftId) return
    const c = info.crafts.find((x) => x.id === initialCraftId)
    if (c) {
      setSelectedCraft(c)
      setExpandedCraft(c.id)
    }
  }, [info, initialCraftId])

  // ── Money ─────────────────────────────────────────────────────────────────
  // Themed table: the package tier is the guest count rounded up to the next 5.
  const partyThemes = info?.themes ?? []
  const themeTierServes = Math.ceil(people / 5) * 5
  const themeTierAvailable = partyThemes[0]?.tiers.some((t) => t.serves === themeTierServes) ?? false
  const currentThemeTier = selectedTheme?.tiers.find((t) => t.serves === themeTierServes) ?? null
  // Only price or charge a table when the guest count maps to a real tier.
  const themePriceCents = themeTierAvailable ? (currentThemeTier?.packagePriceCents ?? 0) : 0

  const summary = partySummary({
    startIso: selectedSlot?.startAt,
    craft: selectedCraft,
    guests: people,
    // The package's name only where there was a package to choose; otherwise "Studio fee" as always.
    pkg: { name: packageChoice ? pkg.name : undefined, priceCents: pkg.priceCents, minGuests: pkg.minGuests },
    extras: extraItems.map((it) => ({ label: it.label, count: it.count ?? 1, forGuests: it.forGuests, unitCents: it.unitCents, cents: it.cents })),
    themedTable:
      selectedTheme && themePriceCents > 0
        ? { name: selectedTheme.displayName, serves: themeTierServes, priceCents: themePriceCents }
        : null,
  })
  const deposit = summary.dueTodayCents // charged today to book
  /** When the party ends: the slot's length plus any extra time. */
  const partyEndIso = selectedSlot ? new Date(Date.parse(selectedSlot.startAt) + (pkg.minutes + extraMinutes) * 60_000).toISOString() : ''

  // Guest count moved past the largest table → clear a stale choice, and say so.
  useEffect(() => {
    if (!themeTierAvailable) {
      if (selectedTheme) {
        setSelectedTheme(null)
        setThemeDeselectedNote(true)
      }
    } else {
      setThemeDeselectedNote(false)
    }
  }, [themeTierAvailable, selectedTheme])

  // ── Analytics ─────────────────────────────────────────────────────────────
  const craftItem = (c: Craft, quantity?: number): AnalyticsItem => ({
    item_id: c.id, item_name: c.name, item_category: 'party', price: c.perHeadCents / 100, ...(quantity ? { quantity } : {}),
  })
  /** Close without booking: say where they stopped (the funnel's drop-off). */
  function closeAndRecord() {
    if (!completed) {
      trackBookingAbandoned('party', currentStep, {
        ...(selectedCraft ? { craft: selectedCraft.name } : {}),
        ...(selectedSlot ? { start: selectedSlot.startAt } : {}),
        guests: people,
      })
    }
    onClose()
  }

  // ── Moving through the steps ──────────────────────────────────────────────
  const stepIdx = stepIndex(currentStep, steps)

  function whatIsMissing(step: PartyStepId): string {
    if (step === 'craft') {
      if (!selectedCraft) return 'Pick a craft to continue.'
      if (selectedCraft.personalized && !ackPersonalized) return 'Tick the box above to confirm you understand this craft is made to order.'
    }
    if (step === 'when') {
      if (!selectedDate) return 'Pick a date to continue.'
      if (!selectedSlot) return 'Pick a start time to continue.'
    }
    return ''
  }

  // A time fixed by a link (no date step): each extra that adds time is checked
  // against that start, and one that doesn't fit is shown as such, not offered.
  const timeExtraIds = offeredAddOns.filter((a) => a.extraMinutes > 0).map((a) => a.id).join(',')
  useEffect(() => {
    if (currentStep !== 'extras' || !slotSettled || !selectedSlot || !selectedDate || !timeExtraIds) return
    let cancelled = false
    const start = selectedSlot.startAt
    for (const id of timeExtraIds.split(',')) {
      fetchAvailability(selectedDate, { addOns: { [id]: 1 } })
        .then((slots) => {
          if (cancelled) return
          const fits = slots.some((sl) => sl.startAt === start)
          setTimeExtraFits((m) => ({ ...m, [id]: fits }))
          if (!fits) setAddOns((m) => (m[id] ? { ...m, [id]: 0 } : m))
        })
        .catch(() => {}) // can't tell: offered, and the server checks again when booking
    }
    return () => {
      cancelled = true
    }
  }, [currentStep, slotSettled, selectedSlot?.startAt, selectedDate, timeExtraIds, pkg.id])

  // Back on the date step with extra time chosen: the times shown are only
  // the starts that fit the whole party (the dates' times are for the package alone).
  const onWhenStep = currentStep === 'when'
  const slotsForExtras = useRef(false)
  useEffect(() => {
    if (!onWhenStep || !selectedDate || !info) return
    if (extraMinutes === 0) {
      // Extra time taken off again: back to the package's own times.
      const known = timesByDate[selectedDate]
      if (slotsForExtras.current && known) setAvailableSlots(known)
      slotsForExtras.current = false
      return
    }
    slotsForExtras.current = true
    let cancelled = false
    setLoadingSlots(true)
    fetchAvailability(selectedDate)
      .then((slots) => {
        if (cancelled) return
        setAvailableSlots(slots)
        setSelectedSlot((cur) => (cur && !slots.some((sl) => sl.startAt === cur.startAt) ? null : cur))
      })
      .catch(() => !cancelled && setSlotsError(true))
      .finally(() => !cancelled && setLoadingSlots(false))
    return () => {
      cancelled = true
    }
  }, [onWhenStep, addOnsKey])

  /** Extra time makes the party longer: is the chosen start still open for the longer party? */
  async function extraTimeFits(): Promise<boolean> {
    if (extraMinutes === 0 || !selectedSlot || !selectedDate) return true
    setCheckingExtras(true)
    try {
      const slots = await fetchAvailability(selectedDate)
      return slots.some((sl) => sl.startAt === selectedSlot.startAt)
    } catch {
      return true // the server checks again when booking
    } finally {
      setCheckingExtras(false)
    }
  }

  async function goNext() {
    if (checkingExtras) return
    const missing = whatIsMissing(currentStep)
    setStepProblem(missing)
    if (missing) return
    if (currentStep === 'extras' && !(await extraTimeFits())) {
      // With a time fixed by a link there is no date step to go back to.
      setStepProblem(
        steps.includes('when')
          ? 'That start time doesn’t leave room for the extra time. Go back and pick an earlier time, or leave the extra time off.'
          : 'The extra time doesn’t fit this start time. Leave it off to keep this time.',
      )
      return
    }
    const next = nextStep(currentStep, steps)
    if (next) {
      trackWizardStepCompleted(currentStep)
      if (currentStep === 'who') trackBookingChoice('party', 'guests', people)
      if (currentStep === 'package') trackBookingChoice('party', 'package', pkg.id)
      if (currentStep === 'extras' && extraItems.length > 0) trackBookingChoice('party', 'extras', extraItems.map((it) => it.refId).join(','))
      if (next === 'pay' && selectedCraft) {
        trackBeginCheckout('party', deposit / 100, [craftItem(selectedCraft, people)], {
          guests: people,
          // What the crafts should bring in at the studio, on top of the fee paid online.
          expected_craft_revenue: (selectedCraft.perHeadCents * people) / 100,
        })
      }
      setCurrentStep(next)
    }
  }

  function goBack() {
    const prev = prevStep(currentStep, steps)
    setStepProblem('')
    setError(null)
    setWhenMode('pick')
    if (prev) setCurrentStep(prev)
  }

  function requestClose() {
    if (completed || (!touched && !contactStarted(contact))) return closeAndRecord()
    setAskToLeave(true)
  }

  function chooseCraft(craft: Craft) {
    if (selectedCraft?.id !== craft.id) trackSelectItem('party booking', craftItem(craft))
    setSelectedCraft(craft)
    setStepProblem('')
    // Remembered for this visit: opening another date keeps the craft.
    try { sessionStorage.setItem(PICKED_CRAFT_KEY, craft.id) } catch { /* storage blocked */ }
  }

  async function chooseDate(date: string, options: { byCustomer: boolean } = { byCustomer: true }) {
    if (options.byCustomer) {
      setTouched(true)
      if (date) trackBookingChoice('party', 'date', date)
    }
    setSelectedDate(date)
    setSelectedSlot(null)
    setSlotsError(false)
    setSlotMissed(false)
    setStepProblem('')
    if (!date || !info) return

    // The times usually came with the dates. Ask only when they didn't, or
    // when extra time makes the party longer than the dates were asked for.
    const known = extraMinutes === 0 ? timesByDate[date] : undefined
    if (known) {
      setAvailableSlots(known)
      return
    }
    setAvailableSlots([])
    setLoadingSlots(true)
    try {
      setAvailableSlots(await fetchAvailability(date))
    } catch {
      setSlotsError(true)
    } finally {
      setLoadingSlots(false)
    }
  }

  function chooseSlot(slot: Slot) {
    setTouched(true)
    trackBookingChoice('party', 'time', slot.startAt)
    setSelectedSlot(slot)
    setStepProblem('')
  }

  /**
   * A package sets the length, the guest range and the fee. A longer or
   * shorter party may not fit the time already picked, so a picked time goes
   * when the length changes (the dates are asked for again).
   */
  function choosePackage(p: PartyPackage) {
    setTouched(true)
    setStepProblem('')
    if (p.id === pkg.id) return
    setPackageId(p.id)
    // The guest count stays when it fits the new package; otherwise it moves
    // to the nearest end, and says so.
    guestsChosen.current = true
    if (people > p.maxGuests) {
      setPeople(p.maxGuests)
      setGuestNote(`Changed to ${p.maxGuests} guests, the most this package holds.`)
    } else if (people < p.minGuests) {
      setPeople(p.minGuests)
      setGuestNote(`Changed to ${p.minGuests} guests, the fewest this package takes.`)
    } else {
      setGuestNote('')
    }
    // Times depend on the package's length: the chosen time goes, the date
    // stays while it is still bookable, and its times are asked for again.
    setSelectedSlot(null)
    setSlotSettled(false)
    setAvailableSlots([])
    setTimesByDate({})
    setOfferedByDate({})
    setSlotsError(false)
    if (selectedDate) {
      dropDateIfGone.current = true
      const date = selectedDate
      setLoadingSlots(true)
      fetchAvailability(date, { packageId: p.id })
        .then((slots) => setAvailableSlots(slots))
        .catch(() => setSlotsError(true))
        .finally(() => setLoadingSlots(false))
    }
  }

  /** Sets an extra to `to`, or moves it by `by` from what it is now (quick taps never use a stale count). */
  function chooseAddOn(a: PartyAddOn, change: { to: number } | { by: number }) {
    setTouched(true)
    setStepProblem('')
    setAddOns((m) => {
      const n = 'to' in change ? change.to : (m[a.id] ?? 0) + change.by
      return { ...m, [a.id]: Math.max(0, Math.min(a.maxQty, n)) }
    })
  }

  function chooseGuests(n: number) {
    setTouched(true)
    setGuestNote('')
    guestsChosen.current = true
    setPeople(Math.min(pkg.maxGuests, Math.max(pkg.minGuests, n)))
  }

  /**
   * The server says the time has gone (someone else booked it while they were
   * checking out). Take them back to pick another, with fresh times and
   * everything they typed still in place.
   */
  async function recoverFromLostTime() {
    trackBookingProblem('party', 'time_taken')
    const date = selectedSlot ? selectedDate : ''
    setSelectedSlot(null)
    setSlotSettled(false) // brings the date step back if a link had removed it
    setSlotMissed(true)
    setWhenMode('pick')
    setCurrentStep('when')
    if (!info) return
    loadAvailableDates(pkg.id)
    if (!date) return
    setLoadingSlots(true)
    try {
      setAvailableSlots(await fetchAvailability(date))
    } catch {
      setSlotsError(true)
    } finally {
      setLoadingSlots(false)
    }
  }

  // ── Paying ────────────────────────────────────────────────────────────────
  /** Marks what's missing, goes to it, and says whether payment can go ahead. */
  function readyToPay(): boolean {
    const contactOk = contactRef.current?.check() ?? contactIsUsable(contact, { phoneRequired: true })
    if (!agreedToPolicy) {
      setPolicyProblem(true)
      if (contactOk) {
        policyRef.current?.focus()
        policyRef.current?.scrollIntoView?.({ block: 'center' })
      }
    }
    return contactOk && agreedToPolicy
  }

  async function handlePay(walletToken?: string) {
    if (processing || !info || !selectedSlot || !selectedCraft) return
    if (!walletToken && !paymentReady) return
    if (!readyToPay()) {
      setError(null)
      return
    }

    setError(null)
    setProcessing(true)
    trackPaymentStarted(deposit / 100)

    try {
      let token = walletToken
      let sourceKind: 'card' | 'gift_card' = 'card'
      if (!token) {
        try {
          const tokenized = await paymentFormRef.current!.tokenize()
          token = tokenized.token
          sourceKind = tokenized.kind
        } catch {
          trackBookingProblem('party', 'card_unreadable')
          throw new Error('We couldn’t read that card. Check the number, date and code, then try again. Nothing was charged.')
        }
      }

      trackAddPaymentInfo('party', deposit / 100, walletToken ? 'wallet' : sourceKind)
      let bookRes: Response
      try {
        bookRes = await fetch('/api/party/book.json', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            attemptId: attemptId.current,
            // What was chosen, never a price: the server prices it from the
            // saved Parties setup and the catalog.
            startTime: selectedSlot.startAt,
            packageId: pkg.id,
            ...(linkPackage ? { linkPackageId: linkPackage.id } : {}),
            guests: people,
            addOns: chosenAddOns,
            craftId: selectedCraft.id,
            // Where this visitor first/last came from (Google, Facebook, a texted link…).
            attribution: readAttribution(),
            posthogId: posthogId(),
            customer: {
              firstName: contact.firstName.trim(),
              lastName: contact.lastName.trim(),
              email: contact.email.trim(),
              phone: contact.phone.trim(),
            },
            // Themed table: sent only when the guest count maps to a real tier
            // (the server works out price and item from themeId + serves).
            ...(selectedTheme && themeTierAvailable ? { theme: { themeId: selectedTheme.id, serves: themeTierServes } } : {}),
            paymentToken: token,
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
        // We were told plainly what happened (declined, time taken, something
        // changed…): that attempt is over, and the next try is a new one.
        // "Still finishing your last try" is not an ending: the next try must
        // be recognised as the same one, so it keeps the ID.
        const keep = outcomeUnknown(failure) || errData?.code === 'in_progress'
        if (!keep) attemptId.current = newAttemptId()
        if (errData?.code === 'slot_taken' || errData?.code === 'not_open') {
          trackPaymentFailed(errData.code)
          await recoverFromLostTime()
          return
        }
        throw new Error(messageForFailure(failure, partyMessages))
      }

      const json = await bookRes.json().catch(() => null)
      // A success we can't read is still not a failure we can vouch for.
      if (!json) throw new Error(UNKNOWN_OUTCOME_MESSAGE)
      const data = json.data ?? json
      setReceiptUrl(data.receiptUrl ?? null)
      setTotalCharged(typeof data.totalCharged === 'number' ? data.totalCharged : deposit)
      const newBookingId = typeof data.bookingId === 'string' ? data.bookingId : null
      const newHostToken = typeof data.hostToken === 'string' ? data.hostToken : null
      setBookingId(newBookingId)
      setHostToken(newHostToken)
      setEmailSent(data.emailSent === true)
      setEmailCheck(data.emailCheck ?? null)
      setAskToLeave(false)
      setCompleted(true)

      // Remember this booking so the host can get back to their party page
      // (the links otherwise live only on the confirmation screen and the email).
      if (newBookingId) {
        saveRecentParty({
          bookingId: newBookingId,
          hostToken: newHostToken ?? undefined,
          craftName: selectedCraft.name,
          slotLabel: formatSlotLabel(selectedSlot.startAt),
          startIso: selectedSlot.startAt,
          savedAt: new Date().toISOString(),
        })
      }
      identifyBooker(contact.email, contact.firstName, contact.lastName)
      trackPaymentCompleted((typeof data.totalCharged === 'number' ? data.totalCharged : deposit) / 100, {
        kind: 'party',
        transactionId: newBookingId,
        items: [craftItem(selectedCraft, people)],
        extra: { guests: people, craft: selectedCraft.name, expected_craft_revenue: (selectedCraft.perHeadCents * people) / 100 },
      })
      trackBookingCompleted('party')
    } catch (err) {
      const message = err instanceof Error ? err.message : partyMessages.unavailable
      setError(message)
      trackPaymentFailed(message)
    } finally {
      setProcessing(false)
    }
  }

  // ── Confirmation ──────────────────────────────────────────────────────────
  function renderConfirmation() {
    if (!selectedSlot || !selectedCraft) return null
    const origin = window.location.origin
    const slotLabel = formatSlotLabel(selectedSlot.startAt)
    const inviteUrl = bookingId
      ? partyInviteUrl(
          { bookingId, craftName: selectedCraft.name, slotLabel, startIso: selectedSlot.startAt, title: partyTitle.trim() || undefined },
          origin,
        )
      : ''
    // The calendar entry carries the invitation link, never the host's private link:
    // hosts often invite guests from this very calendar entry.
    const calendarEvent = {
      title: `${selectedCraft.name} party at ${STUDIO_ADDRESS.name}`,
      startIso: selectedSlot.startAt,
      endIso: partyEndIso,
      details: inviteUrl
        ? `Your private party at ${STUDIO_ADDRESS.name}.\n\nInvitation link for guests: ${inviteUrl}`
        : `Your private party at ${STUDIO_ADDRESS.name}.`,
      location: `${STUDIO_ADDRESS.name}, ${STUDIO_ADDRESS_LINE}`,
    }
    const hostPageUrl = bookingId && hostToken ? `${origin}/party/${encodeURIComponent(bookingId)}?key=${encodeURIComponent(hostToken)}` : ''

    return (
      <BookingConfirmed
        heading="You’re booked"
        what={
          <>
            <strong>{selectedCraft.name}</strong> party, {formatMoney(totalCharged ?? deposit)}{' '}
            {extraItems.length > 0 ? 'paid' : 'studio fee paid'}.
          </>
        }
        email={contact.email.trim()}
        emailSent={emailSent}
        emailCheck={emailCheck}
      >
        <div style={{ marginTop: '1.25rem' }}>
          <ConfirmedBlock label="When">
            <strong>{formatDayAndSpan(selectedSlot.startAt, partyEndIso)}</strong>
            <p style={{ margin: '0.125rem 0 0' }}>
              Arrive up to {partyConfig.hostArrivalMinutesEarly} minutes early to set up.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem 1rem', marginTop: '0.25rem' }}>
              <a href={googleCalendarUrl(calendarEvent)} target="_blank" rel="noopener noreferrer" className="btn btn-quiet" style={{ width: 'auto' }} onClick={() => trackAddToCalendar('confirmation', 'google', 'party')}>
                Add to Google Calendar
              </a>
              <a href={icsDataUrl(buildIcs(calendarEvent))} download="hometown-party.ics" className="btn btn-quiet" style={{ width: 'auto' }} onClick={() => trackAddToCalendar('confirmation', 'ics', 'party')}>
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

          {hostPageUrl ? (
            <ConfirmedBlock label="Your party page">
              <p style={{ margin: '0 0 0.625rem' }}>See who’s coming and manage the details. Keep this link: it’s also in your email.</p>
              {/* ph-no-capture: the link carries the host key; PostHog never records this click. */}
              <a href={hostPageUrl} className="btn btn-primary ph-no-capture">
                Open your party page
              </a>
            </ConfirmedBlock>
          ) : (
            <ConfirmedBlock label="Your party page">
              Your party page is being set up.{' '}
              {TEXT_US ? `Text us at ${TEXT_US} and we’ll send you the link.` : 'We’ll send you the link.'}
            </ConfirmedBlock>
          )}

          {bookingId && (
            <ConfirmedBlock label="Invite your guests">
              <div className="field" style={{ marginBottom: '0.75rem' }}>
                <label className="field-label" htmlFor={partyTitleId}>
                  Party name for the invitation <span className="field-optional">(optional)</span>
                </label>
                <input
                  id={partyTitleId}
                  name="party-name"
                  className="field-input"
                  value={partyTitle}
                  onChange={(e) => setPartyTitle(e.target.value)}
                  placeholder="Maya’s birthday, team night…"
                  maxLength={60}
                />
              </div>
              <ShareLink
                url={inviteUrl}
                label="Share the invitation"
                shareTitle={partyTitle.trim() || 'You’re invited'}
                contentType="party_invite"
              />
              <a
                href={partyInviteMailto({
                  craftName: selectedCraft.name,
                  slotLabel,
                  inviteUrl,
                  title: partyTitle.trim() || undefined,
                  icsUrl: partyInviteIcsUrl(bookingId, origin),
                })}
                className="btn btn-quiet"
                style={{ width: 'auto' }}
                // The host writing to their own guests — a share, not a lead.
                data-track-ignore
                onClick={() => trackShare('party_invite', 'email')}
              >
                Or email it to your guests
              </a>
            </ConfirmedBlock>
          )}

          <ConfirmedBlock label="Before the party">
            <p style={{ margin: '0 0 0.5rem' }}>
              About a week before, we’ll text you to check your headcount. It’s for our prep only: you pay for who comes, minimum{' '}
              {pkg.minGuests}.
            </p>
            {selectedCraft.personalized && (
              <p style={{ margin: '0 0 0.5rem' }}>
                Your craft is made to order, so we’ll also email you for your final count and personalization details.
              </p>
            )}
            {bookingId && (
              <a href={partyWaiverUrl(bookingId, origin)} target="_blank" rel="noopener noreferrer" className="btn btn-secondary">
                Sign your participation agreement
              </a>
            )}
          </ConfirmedBlock>

          <ConfirmedBlock label="Changing plans">{partyRefundLine(selectedSlot.startAt, new Date(), totalCharged ?? deposit)}</ConfirmedBlock>

          {TEXT_US && (
            <ConfirmedBlock label="Questions">
              Text us at{' '}
              <a href={`sms:${TEXT_US.replace(/[^+\d]/g, '')}`} style={{ color: 'var(--color-primary)', fontWeight: 600 }}>
                {TEXT_US}
              </a>
              .
            </ConfirmedBlock>
          )}

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

  // ── Steps ─────────────────────────────────────────────────────────────────
  function renderCraftStep(crafts: Craft[]) {
    // A craft that arrived in a link comes first, so it is the first thing seen.
    const ordered = initialCraftId
      ? [...crafts].sort((a, b) => Number(b.id === initialCraftId) - Number(a.id === initialCraftId))
      : crafts
    return (
      <div>
        <p style={sectionLabel}>Choose a craft</p>
        <div className="party-craft-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 15rem), 1fr))', gap: '0.875rem', alignItems: 'start' }}>
          {ordered.map((craft) => {
            const active = selectedCraft?.id === craft.id
            const expanded = expandedCraft === craft.id
            return (
              <div
                key={craft.id}
                style={{
                  borderRadius: '0.875rem',
                  border: active ? '2px solid var(--color-primary)' : '1.5px solid var(--color-line)',
                  background: active ? 'rgba(var(--color-primary-rgb), 0.06)' : 'var(--color-surface)',
                  overflow: 'hidden',
                }}
              >
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => chooseCraft(craft)}
                  style={{ display: 'block', width: '100%', padding: 0, border: 'none', background: 'none', textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit' }}
                >
                  <div style={{ position: 'relative', width: '100%', aspectRatio: '4 / 3', background: 'var(--color-sand)' }}>
                    {craft.imageUrl && (
                      <img src={craft.imageUrl} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    )}
                    {/* Over the photo, so it never makes one card taller than the rest. */}
                    {craft.popular && (
                      <span className="chip tone-event" style={{ position: 'absolute', top: '0.625rem', left: '0.625rem' }}>
                        Our pick
                      </span>
                    )}
                    {active && (
                      <span
                        style={{
                          position: 'absolute',
                          top: '0.625rem',
                          right: '0.625rem',
                          padding: '0.2rem 0.6rem',
                          borderRadius: '999px',
                          background: 'var(--color-primary)',
                          color: '#fff',
                          fontSize: '0.8125rem',
                          fontWeight: 600,
                        }}
                      >
                        Selected
                      </span>
                    )}
                  </div>
                  <div style={{ padding: '0.875rem 1rem 0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.75rem' }}>
                      <span style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-dark)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: 1.3, minHeight: '2.6em' }}>{craft.name}</span>
                      <span style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--color-dark)', flexShrink: 0 }}>
                        {perPersonLabel(craft.perHeadCents, craft.perHeadMaxCents)} a person
                      </span>
                    </div>
                  </div>
                </button>

                <div style={{ padding: '0.375rem 1rem 0.875rem' }}>
                  {craft.description && (
                    <>
                      <p
                        style={{
                          margin: 0,
                          fontSize: '0.875rem',
                          lineHeight: 1.55,
                          color: 'var(--color-text)',
                          ...(expanded
                            ? { whiteSpace: 'pre-line' }
                            : // Four lines at a fixed height, so every card is the same size.
                              { display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden', minHeight: '5.425rem' }),
                        }}
                      >
                        {craft.description}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          if (!expanded) trackViewItem(craftItem(craft))
                          setExpandedCraft(expanded ? null : craft.id)
                        }}
                        aria-expanded={expanded}
                        className="btn btn-quiet"
                        style={{ width: 'auto', minHeight: '2.75rem', fontSize: '0.875rem' }}
                      >
                        {expanded ? 'Read less' : 'Read more'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {selectedCraft?.personalized && (
          <div style={{ marginTop: '1.25rem', padding: '1rem 1.125rem', borderRadius: '0.75rem', border: '1.5px solid var(--craft-marigold, #e3a72f)', background: 'var(--craft-marigold-soft, #fdf3dc)' }}>
            <p style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 600, color: 'var(--color-dark)' }}>This craft is made to order</p>
            <p style={{ margin: '0.35rem 0 0.75rem', fontSize: '0.875rem', lineHeight: 1.5, color: 'var(--color-dark)' }}>
              It’s personalized for your group. Once your items are made, they can’t be changed or refunded. We’ll email you after booking
              for your final count and personalization details.
            </p>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.625rem', cursor: 'pointer', minHeight: '2.75rem' }}>
              <input
                type="checkbox"
                name="made-to-order"
                checked={ackPersonalized}
                onChange={(e) => {
                  setAckPersonalized(e.target.checked)
                  if (e.target.checked) setStepProblem('')
                }}
                style={{ marginTop: '0.2rem', width: '1.25rem', height: '1.25rem', flexShrink: 0, cursor: 'pointer', accentColor: 'var(--color-primary)' }}
              />
              <span style={{ fontSize: '0.9375rem', fontWeight: 500, color: 'var(--color-dark)' }}>
                I understand these items are made to order and can’t be refunded once made.
              </span>
            </label>
          </div>
        )}
      </div>
    )
  }

  /** Someone planning past the booking window: one email, and nothing to pick. */
  function renderLaterView() {
    const months = laterMonths(6, facts.last)
    // A month is always named: it is what tells us when to send the email.
    const month = laterMonth || months[0].value
    return (
      <div>
        <p style={sectionLabel}>Planning something later?</p>
        <p style={{ ...helpText, marginBottom: '1rem' }}>
          We open dates {facts.times.bookingWindowDays} days ahead. Pick a month and leave your email, and we’ll tell you the day its dates start to open.
        </p>
        <div className="field" style={{ maxWidth: '26rem', margin: '0 auto 0.75rem' }}>
          <label className="field-label" htmlFor={`${formId}-later`}>
            Month you have in mind
          </label>
          <select id={`${formId}-later`} name="month" className="field-input" value={month} onChange={(e) => setLaterMonth(e.target.value)}>
            {months.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <NotifyMe
          interest={`party-later:${month}`}
          buttonLabel="Tell me when it opens"
          note="One email the day dates in that month start to open. Nothing else."
          successText="Got it. We’ll email you the day dates in that month start to open."
        />
      </div>
    )
  }

  function renderWhenStep() {
    if (whenMode === 'later') return renderLaterView()

    // How many times this day offers, against how many are still open.
    const offered = selectedDate
      ? offeredByDate[selectedDate] ?? partyStartsForDate(settings, selectedDate, new Date(), facts.days, { minutes: pkg.minutes }).length
      : 0
    const someBooked = !loadingSlots && !slotsError && availableSlots.length > 0 && offered > availableSlots.length
    const onOffer = { first: facts.first, last: facts.last }
    const allDates = [...availableDates, ...bookedDates.filter((d) => d >= onOffer.first && d <= onOffer.last)].sort()

    return (
      <div>
        {slotMissed && (
          <p role="status" style={{ margin: '0 0 1rem', padding: '0.75rem 1rem', borderRadius: '0.625rem', border: '1.5px solid var(--craft-marigold, #e3a72f)', background: 'var(--craft-marigold-soft, #fdf3dc)', fontSize: '0.9375rem', color: 'var(--color-dark)' }}>
            {availableSlots.length === 0 && !loadingSlots
              ? 'That time was just booked and that date is now full. Nothing was charged. Pick another date.'
              : 'That time was just booked. Nothing was charged. These are still open.'}
          </p>
        )}

        <p style={sectionLabel}>Choose a date</p>
        <p style={{ ...helpText, marginBottom: '0.75rem' }}>
          {packageChoice ? `This package is ${pkg.minutes} minutes.` : `Every party is ${pkg.minutes} minutes. The whole studio, just your group.`}
        </p>

        {loadingDates && <p role="status" style={helpText}>Loading dates…</p>}
        {datesError && (
          <div role="alert" style={{ marginBottom: '0.75rem' }}>
            <p style={{ ...helpText, color: 'var(--color-error)', marginBottom: '0.5rem' }}>{COULD_NOT_LOAD}</p>
            <button type="button" className="btn btn-secondary" style={{ width: 'auto' }} onClick={() => info && loadAvailableDates(pkg.id)}>
              Try again
            </button>
          </div>
        )}

        {!loadingDates && !datesError && availableDates.length === 0 && (
          <div>
            <p style={{ ...helpText, marginBottom: '0.75rem' }}>
              Every party date in the next {facts.times.bookingWindowDays} days is booked. Leave your email and we’ll text or email you when dates open.
            </p>
            <NotifyMe
              interest="party:more-dates"
              buttonLabel="Tell me when dates open"
              note="One message when dates open. Nothing else."
              successText="Got it. We’ll text or email you when dates open."
            />
          </div>
        )}

        {allDates.length > 0 && availableDates.length > 0 && (
          <div role="group" aria-label="Dates" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(8rem, 1fr))', gap: '0.5rem' }}>
            {allDates.map((d) => {
              const open = availableDates.includes(d)
              return open ? (
                <button key={d} type="button" aria-pressed={selectedDate === d} onClick={() => chooseDate(d)} style={pillStyle(selectedDate === d)}>
                  {formatDateLabel(d)}
                </button>
              ) : (
                <button key={d} type="button" disabled style={pillStyle(false, true)}>
                  {formatDateLabel(d)} · Booked
                </button>
              )
            })}
          </div>
        )}

        {selectedDate && (
          <div style={{ marginTop: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '1rem', flexWrap: 'wrap' }}>
              <p style={sectionLabel}>Start time</p>
              {someBooked && (
                <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-dark)' }}>
                  {availableSlots.length} of {offered} times still open
                </span>
              )}
            </div>
            {loadingSlots && <p role="status" style={helpText}>Loading times…</p>}
            {slotsError && (
              <p role="alert" style={{ ...helpText, color: 'var(--color-error)' }}>
                {COULD_NOT_LOAD}
              </p>
            )}
            {!loadingSlots && !slotsError && availableSlots.length === 0 && (
              <p style={helpText}>No start times are open on this date. Pick another.</p>
            )}
            {availableSlots.length > 0 && (
              <div role="group" aria-label="Start times" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(7rem, 1fr))', gap: '0.5rem' }}>
                {availableSlots.map((slot) => (
                  <button
                    key={slot.startAt}
                    type="button"
                    aria-pressed={selectedSlot?.startAt === slot.startAt}
                    onClick={() => chooseSlot(slot)}
                    style={pillStyle(selectedSlot?.startAt === slot.startAt)}
                  >
                    {formatTime(slot.startAt)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* The window, said plainly, with a way out for someone planning further ahead.
            It leads to its own view: a date is either picked here or asked about there. */}
        {!loadingDates && !datesError && availableDates.length > 0 && (
          <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid var(--color-line)' }}>
            <p style={helpText}>We open dates {facts.times.bookingWindowDays} days ahead.</p>
            <button
              type="button"
              className="btn btn-quiet"
              style={{ width: 'auto', minHeight: '2.75rem' }}
              onClick={() => {
                setStepProblem('')
                setWhenMode('later')
              }}
            >
              Planning something later?
            </button>
          </div>
        )}
      </div>
    )
  }

  function renderWhoStep() {
    const counterButton = {
      width: '2.75rem',
      height: '2.75rem',
      borderRadius: '0.75rem',
      border: '1.5px solid var(--color-field-border)',
      background: 'var(--color-surface)',
      fontSize: '1.375rem',
      lineHeight: 1,
      color: 'var(--color-dark)',
    } as const
    const atMin = people <= pkg.minGuests
    const atMax = people >= pkg.maxGuests
    return (
      <div>
        <p id={`${formId}-guests`} style={sectionLabel}>
          About how many guests?
        </p>
        {guestNote && (
          <p role="status" style={{ ...helpText, margin: '0 0 0.75rem', fontWeight: 600, color: 'var(--color-dark)' }}>
            {guestNote}
          </p>
        )}
        <div role="group" aria-labelledby={`${formId}-guests`}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.875rem' }}>
            {pkg.quickPicks.map((n) => (
              <button key={n} type="button" aria-pressed={people === n} onClick={() => chooseGuests(n)} style={{ ...pillStyle(people === n), minWidth: '3.5rem' }}>
                {n}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <button type="button" aria-label="Fewer guests" onClick={() => chooseGuests(people - 1)} disabled={atMin} style={{ ...counterButton, opacity: atMin ? 0.35 : 1, cursor: atMin ? 'default' : 'pointer' }}>
              <span aria-hidden="true">&minus;</span>
            </button>
            <span aria-live="polite" aria-atomic="true" style={{ minWidth: '2rem', textAlign: 'center', fontSize: '1.25rem', fontWeight: 600, color: 'var(--color-dark)' }}>
              <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{people} guests</span>
              <span aria-hidden="true">{people}</span>
            </span>
            <button type="button" aria-label="More guests" onClick={() => chooseGuests(people + 1)} disabled={atMax} style={{ ...counterButton, opacity: atMax ? 0.35 : 1, cursor: atMax ? 'default' : 'pointer' }}>
              <span aria-hidden="true">+</span>
            </button>
          </div>
        </div>
        <p style={{ ...helpText, margin: '0.75rem 0 1.25rem' }}>
          {atMax
            ? packageChoice
              ? `${pkg.maxGuests} guests is the most this package holds.`
              : `${pkg.maxGuests} guests is the most the studio holds.`
            : `An estimate is fine. Parties are for ${pkg.minGuests} to ${pkg.maxGuests} guests, and you pay for crafts at the studio for whoever comes.`}
        </p>
        <PartyPriceSummary summary={summary} />
      </div>
    )
  }

  /** Choosing between packages: shown only when there is more than one, or a link named one. */
  function renderPackageStep() {
    return (
      <div>
        <p style={sectionLabel}>Choose your party</p>
        <div role="group" aria-label="Packages" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 14rem), 1fr))', gap: '0.75rem' }}>
          {facts.packages.map((p) => {
            const active = p.id === pkg.id
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={active}
                onClick={() => choosePackage(p)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.25rem',
                  padding: '0.875rem 1rem',
                  minHeight: '2.75rem',
                  borderRadius: '0.75rem',
                  border: active ? '2px solid var(--color-primary)' : '1.5px solid var(--color-line)',
                  background: active ? 'rgba(var(--color-primary-rgb), 0.06)' : 'var(--color-surface)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  font: 'inherit',
                }}
              >
                <span style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', width: '100%' }}>
                  <span style={{ fontWeight: 600, fontSize: '1rem', color: 'var(--color-dark)' }}>{p.name}</span>
                  <span style={{ fontWeight: 600, fontSize: '0.9375rem', color: 'var(--color-dark)', flexShrink: 0 }}>{formatMoney(p.priceCents)}</span>
                </span>
                <span style={{ fontSize: '0.875rem', color: 'var(--color-text)' }}>
                  {p.minutes} minutes · {p.minGuests} to {p.maxGuests} guests
                </span>
              </button>
            )
          })}
        </div>
        {guestNote && (
          <p role="status" style={{ ...helpText, marginTop: '0.75rem', fontWeight: 600, color: 'var(--color-dark)' }}>
            {guestNote}
          </p>
        )}
        <p style={{ ...helpText, marginTop: '0.75rem' }}>Crafts are paid at the studio for whoever comes, whichever you choose.</p>
      </div>
    )
  }

  /** Extras for the party, paid today: the online add-ons, and themed tables when that product is live. */
  function renderExtrasStep() {
    return (
      <div>
        {offeredAddOns.length > 0 && (
          <div style={{ marginBottom: '1.25rem' }}>
            <p style={sectionLabel}>Add extras?</p>
            <p style={{ ...helpText, marginBottom: '1rem' }}>Optional, and paid today with your booking.</p>
            <div role="group" aria-label="Extras" style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
              {offeredAddOns.map((a) => renderAddOn(a))}
            </div>
          </div>
        )}
        {partyThemes.length > 0 && renderThemeSection()}
        <PartyPriceSummary summary={summary} />
      </div>
    )
  }

  function renderAddOn(a: PartyAddOn) {
    const count = chosenAddOns[a.id] ?? 0
    const nameId = `${formId}-addon-${a.id}`
    /** Extra time that doesn't fit the start a link fixed: shown, not offered. */
    const doesntFit = slotSettled && a.extraMinutes > 0 && timeExtraFits[a.id] === false
    const detail = [
      addOnPriceLabel(a),
      a.extraMinutes > 0 ? `${a.extraMinutes} more minutes` : '',
      a.per === 'guest' ? `for each of your ${people} guests` : '',
    ].filter(Boolean).join(' · ')
    const box = {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '0.75rem',
      padding: '0.75rem 1rem',
      borderRadius: '0.75rem',
      border: count > 0 ? '2px solid var(--color-primary)' : '1.5px solid var(--color-line)',
      background: count > 0 ? 'rgba(var(--color-primary-rgb), 0.06)' : 'var(--color-surface)',
    } as const
    const text = (
      <span style={{ display: 'flex', flexDirection: 'column', gap: '0.125rem', textAlign: 'left' }}>
        <span id={nameId} style={{ fontWeight: 600, fontSize: '0.9375rem', color: 'var(--color-dark)' }}>{a.label}</span>
        <span style={{ fontSize: '0.875rem', color: 'var(--color-text)' }}>{detail}</span>
      </span>
    )
    if (a.maxQty <= 1) {
      return (
        <button
          key={a.id}
          type="button"
          aria-pressed={count > 0}
          disabled={doesntFit}
          onClick={() => chooseAddOn(a, { to: count > 0 ? 0 : 1 })}
          style={{ ...box, minHeight: '2.75rem', cursor: doesntFit ? 'default' : 'pointer', opacity: doesntFit ? 0.6 : 1, font: 'inherit', width: '100%' }}
        >
          {text}
          <span style={{ flexShrink: 0, fontSize: '0.875rem', fontWeight: 600, color: doesntFit ? 'var(--color-text)' : 'var(--color-primary)' }}>
            {doesntFit ? 'Doesn’t fit this time' : count > 0 ? 'Added' : 'Add'}
          </span>
        </button>
      )
    }
    const counterButton = (disabled: boolean) =>
      ({
        width: '2.75rem',
        height: '2.75rem',
        borderRadius: '0.75rem',
        border: '1.5px solid var(--color-field-border)',
        background: 'var(--color-surface)',
        fontSize: '1.25rem',
        lineHeight: 1,
        color: 'var(--color-dark)',
        opacity: disabled ? 0.35 : 1,
        cursor: disabled ? 'default' : 'pointer',
      }) as const
    return (
      <div key={a.id} role="group" aria-labelledby={nameId} style={box}>
        {text}
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
          <button type="button" aria-label={`Fewer ${a.label}`} disabled={count === 0} onClick={() => chooseAddOn(a, { by: -1 })} style={counterButton(count === 0)}>
            <span aria-hidden="true">&minus;</span>
          </button>
          <span aria-live="polite" style={{ minWidth: '1.5rem', textAlign: 'center', fontWeight: 600, color: 'var(--color-dark)', whiteSpace: 'nowrap' }}>
            {doesntFit ? 'Doesn’t fit this time' : a.per === 'guest' ? `${count} each` : count}
          </span>
          <button type="button" aria-label={`More ${a.label}`} disabled={count >= a.maxQty || doesntFit} onClick={() => chooseAddOn(a, { by: 1 })} style={counterButton(count >= a.maxQty || doesntFit)}>
            <span aria-hidden="true">+</span>
          </button>
        </span>
      </div>
    )
  }

  // In-studio themed table: part of the extras step, present only when that product is live.
  function renderThemeSection() {
    const cardStyle = (active: boolean) =>
      ({
        display: 'flex',
        flexDirection: 'column',
        padding: 0,
        overflow: 'hidden',
        borderRadius: '0.75rem',
        border: active ? '2px solid var(--color-primary)' : '1.5px solid var(--color-line)',
        background: active ? 'rgba(var(--color-primary-rgb), 0.06)' : 'var(--color-surface)',
        cursor: 'pointer',
        textAlign: 'left',
        font: 'inherit',
      }) as const
    return (
      <div>
        <p style={sectionLabel}>Add a themed table?</p>
        <p style={{ ...helpText, marginBottom: '1.25rem' }}>
          A styled table for your group, set up and ready when you arrive.
          {themeTierAvailable ? ` Priced for ${themeTierServes} guests.` : ''}
        </p>

        {themeTierAvailable ? (
          <div role="group" aria-label="Themed tables" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 12rem), 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
            {partyThemes.map((t) => {
              const tier = t.tiers.find((tt) => tt.serves === themeTierServes)
              return (
                <button key={t.id} type="button" aria-pressed={selectedTheme?.id === t.id} onClick={() => { setTouched(true); setSelectedTheme(t) }} style={cardStyle(selectedTheme?.id === t.id)}>
                  {t.photo && <img src={t.photo} alt="" loading="lazy" decoding="async" style={{ width: '100%', aspectRatio: '16 / 9', objectFit: 'cover' }} />}
                  <span style={{ display: 'flex', flexDirection: 'column', gap: '0.125rem', padding: '0.75rem' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.9375rem', color: 'var(--color-dark)' }}>{t.displayName}</span>
                    <span style={{ fontSize: '0.875rem', color: 'var(--color-text)' }}>{t.tagline}</span>
                    {tier && <span style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--color-dark)', marginTop: '0.125rem' }}>{formatMoney(tier.packagePriceCents)}</span>}
                  </span>
                </button>
              )
            })}
            <button type="button" aria-pressed={selectedTheme === null} onClick={() => setSelectedTheme(null)} style={{ ...cardStyle(selectedTheme === null), justifyContent: 'center', padding: '0.75rem' }}>
              <span style={{ fontWeight: 600, fontSize: '0.9375rem', color: 'var(--color-dark)' }}>No themed table</span>
              <span style={{ fontSize: '0.875rem', color: 'var(--color-text)' }}>Just the crafts</span>
            </button>
          </div>
        ) : (
          <p style={{ ...helpText, marginBottom: '1.25rem' }}>
            {themeDeselectedNote
              ? `Themed tables are for parties of up to 20 guests, so we’ve taken it off for ${people} guests.`
              : 'Themed tables are for parties of up to 20 guests.'}
          </p>
        )}
      </div>
    )
  }

  function renderPayStep() {
    return (
      <form
        id={formId}
        noValidate
        onSubmit={(e: FormEvent) => {
          e.preventDefault()
          handlePay()
        }}
      >
        <ContactFields ref={contactRef} value={contact} onChange={setContact} phoneRequired disabled={processing} />

        <div style={{ margin: '1.25rem 0' }}>
          <PartyPriceSummary summary={summary} />
        </div>

        {/* Booking terms: needed before any way of paying, card or wallet. */}
        <div style={{ marginBottom: '1rem' }}>
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
              <a href={`${POLICY_PATH}#${POLICY_ANCHORS.parties}`} target="_blank" rel="noopener" style={{ color: 'var(--color-primary)', fontWeight: 600, textDecoration: 'underline' }}>
                booking and cancellation policy
              </a>
              . <span style={{ color: 'var(--color-text)' }}>{partyCheckoutPolicySummary(pkg.minGuests)}.</span>
            </span>
          </label>
          {policyProblem && (
            <p id={policyErrorId} role="alert" className="field-error" style={{ marginTop: '0.375rem' }}>
              {POLICY_UNTICKED}
            </p>
          )}
        </div>

        {/* Party charges go through the standard Payments API, so the SDK runs
            under OUR application (from client-config). That is what Apple Pay
            needs: its domain registration belongs to our app. The
            CLASS_BOOKING_APP_ID override is only for workshops. The SDK's
            environment comes from client-config too, so a sandbox preview
            uses Square's sandbox (18 Oct 2026). */}
        <PaymentForm
          bookingKind="party"
          ref={paymentFormRef}
          wallet={{ amount: (deposit / 100).toFixed(2), label: 'Hometown Studio party, studio fee', bnpl: true }}
          onWalletToken={(token) => handlePay(token)}
          // Runs before the wallet sheet opens, so nobody approves in their
          // wallet and then meets a form error. Marks what's missing as it goes.
          canPayWithWallet={() => (readyToPay() ? null : 'Add the details marked above first.')}
          onReadyChange={setPaymentReady}
        />

        {error && (
          <p role="alert" className="field-error" style={{ marginTop: '0.875rem', fontSize: '0.9375rem', lineHeight: 1.5 }}>
            {error}
          </p>
        )}

        <p style={{ ...helpText, marginTop: '1rem' }}>{partyContent.trust.securedBy}. Nothing else is due today.</p>
      </form>
    )
  }

  function renderBody() {
    if (completed) return renderConfirmation()
    if (infoError) {
      return (
        <div role="alert">
          <p style={{ ...helpText, color: 'var(--color-error)', marginBottom: '1rem' }}>{COULD_NOT_LOAD}</p>
          <button type="button" className="btn btn-secondary" onClick={loadServiceInfo}>
            Try again
          </button>
        </div>
      )
    }
    if (!info) return <p role="status" style={helpText}>Loading party details…</p>

    let step
    if (currentStep === 'craft') step = renderCraftStep(info.crafts)
    else if (currentStep === 'when') step = renderWhenStep()
    else if (currentStep === 'who') step = renderWhoStep()
    else if (currentStep === 'package') step = renderPackageStep()
    else if (currentStep === 'extras') step = renderExtrasStep()
    else step = renderPayStep()

    return (
      <>
        {step}
        {TEXT_US && (
          <p style={{ ...helpText, marginTop: '1.5rem', textAlign: 'center' }}>
            Questions?{' '}
            <a href={`sms:${TEXT_US.replace(/[^+\d]/g, '')}`} style={{ color: 'var(--color-primary)', fontWeight: 600 }}>
              Text us at {TEXT_US}
            </a>
          </p>
        )}
      </>
    )
  }

  // ── What's pinned to the bottom ───────────────────────────────────────────
  let footer
  if (completed) {
    footer = (
      <button type="button" className="btn btn-primary" onClick={onClose}>
        Done
      </button>
    )
  } else if (!info) {
    footer = undefined
  } else if (currentStep === 'pay') {
    footer = (
      <>
        {/* Only ever off while working or while the card field loads, and it says which. */}
        <button type="submit" form={formId} className="btn btn-primary" disabled={processing || !paymentReady}>
          {processing ? 'Processing…' : !paymentReady ? 'Loading payment form…' : summary.payLabel}
        </button>
        {selectedSlot && (
          <p style={{ margin: '0.5rem 0 0', textAlign: 'center', fontSize: '0.8125rem', lineHeight: 1.4, color: 'var(--color-text)' }}>
            {partyRefundLine(selectedSlot.startAt, new Date(), deposit)}
          </p>
        )}
      </>
    )
  } else if (currentStep === 'when' && whenMode === 'later') {
    footer = (
      <button type="button" className="btn btn-secondary" onClick={() => setWhenMode('pick')}>
        Back to open dates
      </button>
    )
  } else {
    const cameFromLink = currentStep === 'craft' && !!initialCraftId && selectedCraft?.id === initialCraftId
    footer = (
      <>
        {stepProblem && (
          <p role="alert" className="field-error" style={{ margin: '0 0 0.5rem', textAlign: 'center' }}>
            {stepProblem}
          </p>
        )}
        <button type="button" className="btn btn-primary" onClick={goNext} disabled={checkingExtras}>
          {checkingExtras ? 'Checking the time…' : cameFromLink ? 'Book this craft' : 'Continue'}
        </button>
      </>
    )
  }

  const showSummary = !completed && (selectedCraft || selectedSlot)
  return (
    <BookingPanel
      title="Book a party"
      onRequestClose={requestClose}
      stepKey={completed ? 'confirmed' : currentStep === 'when' ? `when-${whenMode}` : currentStep}
      stepName={completed || !info ? undefined : stepLabel(currentStep)}
      stepNumber={stepIdx + 1}
      stepCount={steps.length}
      width={!completed && currentStep === 'craft' ? 'wide' : 'narrow'}
      summary={
        showSummary ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {selectedCraft && (
              <span style={{ ...chipStyle, paddingLeft: selectedCraft.imageUrl ? '0.3rem' : '0.75rem' }}>
                {selectedCraft.imageUrl && (
                  <img src={selectedCraft.imageUrl} alt="" style={{ width: '1.5rem', height: '1.5rem', borderRadius: '50%', objectFit: 'cover', display: 'block' }} />
                )}
                {selectedCraft.name}
              </span>
            )}
            {packageChoice && stepIdx > stepIndex('package', steps) && <span style={chipStyle}>{pkg.name}</span>}
            {selectedSlot && !(currentStep === 'when' && whenMode === 'later') && (
              <span style={chipStyle}>{formatSlotLabel(selectedSlot.startAt)}</span>
            )}
            {stepIdx > stepIndex('who', steps) && <span style={chipStyle}>About {people} guests</span>}
          </div>
        ) : undefined
      }
      onBack={
        completed || !info || processing
          ? undefined
          : currentStep === 'when' && whenMode === 'later'
            ? // From the "later" view, Back means back to the dates, not back a step.
              () => setWhenMode('pick')
            : stepIdx > 0
              ? goBack
              : undefined
      }
      footer={footer}
      leavePrompt={
        askToLeave && !completed
          ? {
              title: 'Leave without booking?',
              body: 'Your date isn’t held until you pay.',
              keepLabel: 'Keep booking',
              leaveLabel: 'Close',
              onKeep: () => setAskToLeave(false),
              onLeave: closeAndRecord,
            }
          : null
      }
    >
      {renderBody()}
    </BookingPanel>
  )
}
