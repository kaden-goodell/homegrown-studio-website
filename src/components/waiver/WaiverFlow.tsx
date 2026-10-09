import { useEffect, useMemo, useRef, useState } from 'react'
import { waiverContent } from '@config/waiver-content'
import { lateFeeLine } from '@config/dropoff.config'
import { formatCalendarDate } from '@lib/studio-time'
import PickupFields, { type PickupRow } from '@components/waiver/PickupFields'
import { trackWaiverSigned, trackWaiverStarted, trackWaiverStep } from '@lib/analytics'
import { inputStyle, labelStyle, sectionHeadingStyle, sectionNoteStyle, scrollBoxStyle, cardStyle } from '@components/waiver/waiver-ui'

interface Props {
  /** Present when opened from a party guest link — /waiver?party={bookingId} */
  partyId?: string
  /** Human-readable label shown to the guest so they can see which party their
   *  signature attaches to. Derived server-side from the party record. */
  partyLabel?: string
  /** Present when opened from a workshop confirmation — /waiver?workshop={classScheduleId}&booking={bookingId} */
  workshopId?: string
  /** Human-readable label for a workshop event (title + when), resolved
   *  server-side via `getEvent('workshop', id)` — the workshop counterpart
   *  to `partyLabel`. Unused for now; a later step surfaces it in the flow. */
  eventTitle?: string
  /** True for studio-run drop-off events (camps/PNO) — resolved server-side from
   *  the party/workshop event. Skips the responsible-adult question (drop-off
   *  programs have their own check-in + pickup-code procedures). */
  dropOff?: boolean
  /** Present when opened from a workshop confirmation — the per-seat Square
   *  booking id, carried through to the RSVP as `ref.bookingId`. */
  booking?: string
  /** True on the shared staff iPad (`/waiver?kiosk=1`, HOM-209) — skips the
   *  returning-customer lookup, shows a disclosure bar, and swaps the
   *  confirmation for a minimal "hand it back" screen that auto-returns. */
  kiosk?: boolean
  /** Same-origin path to auto-return to after signing in kiosk mode.
   *  Pre-validated server-side (`@lib/safe-return`) — trusted as-is here. */
  returnTo?: string
}

interface MinorRow {
  name: string
  dob: string
  allergies: string
  /** Drop-off only (HOM-212) — the Studio never administers medication. */
  medications: string
}

/** Small "None" chip next to an allergies input — fills the literal string
 *  'None', distinct from a blank left unanswered (HOM-212). */
function NoneChip({ onClick, active }: { onClick: () => void; active: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: `1px solid ${active ? 'var(--color-primary)' : 'rgba(var(--color-primary-rgb), 0.3)'}`,
        background: active ? 'rgba(var(--color-primary-rgb), 0.1)' : 'transparent',
        color: active ? 'var(--color-primary)' : 'var(--color-muted)',
        borderRadius: '0.625rem',
        padding: '0 0.9rem',
        cursor: 'pointer',
        fontSize: '0.8125rem',
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      {waiverContent.form.allergiesNoneChip}
    </button>
  )
}

/** Pill shown above the flow content so guests can confirm which party they're RSVPing to. */
function PartyLabelChip({ label }: { label: string }) {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.4rem',
        padding: '0.4rem 0.9rem',
        borderRadius: '999px',
        background: 'rgba(var(--color-primary-rgb), 0.10)',
        border: '1px solid rgba(var(--color-primary-rgb), 0.22)',
        fontSize: '0.8125rem',
        fontWeight: 600,
        color: 'var(--color-dark)',
        marginBottom: '1.25rem',
      }}
    >
      <span style={{ color: 'var(--color-primary)', fontWeight: 700 }}>RSVP’ing to:</span>
      <span>{label}</span>
    </div>
  )
}

export default function WaiverFlow({ partyId, partyLabel, workshopId, eventTitle, dropOff, booking, kiosk = false, returnTo = '/staff' }: Props) {
  const { form, confirmation, legalSections } = waiverContent

  // Analytics: which agreement this is — counts only, never names.
  const waiverKind = partyId ? 'party' : workshopId ? 'workshop' : 'open_studio'
  useEffect(() => {
    trackWaiverStarted(waiverKind, kiosk)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  // Age attestation replaces the adult date-of-birth field (Oct 2026).
  const [ageConfirmed, setAgeConfirmed] = useState(false)
  const [minors, setMinors] = useState<MinorRow[]>([])
  const [emergencyName, setEmergencyName] = useState('')
  const [emergencyPhone, setEmergencyPhone] = useState('')
  // Authorized pickup + "may NOT collect" — drop-off events only (HOM-212).
  const [pickupRows, setPickupRows] = useState<PickupRow[]>([])
  const [notAuthorized, setNotAuthorized] = useState('')
  const [adultAllergies, setAdultAllergies] = useState('')
  // Photo consent defaults to yes and never blocks submit; opting out is a tap.
  const [photoConsent, setPhotoConsent] = useState<boolean>(true)
  const [agreeRelease, setAgreeRelease] = useState(false)
  const [signature, setSignature] = useState('')
  const [responsibleAdult, setResponsibleAdult] = useState('')
  // Kids crafting without the signer on the list: is the signer still coming
  // (watching, not crafting) or is another adult bringing them? null = unanswered.
  const [signerPresent, setSignerPresent] = useState<boolean | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // `subline` is the confirmation-screen line under the headline — varies by
  // path (fresh sign with an emailed copy vs. returning RSVP), see HOM-216.
  const [done, setDone] = useState<{ covered: string[]; validUntil: string; subline: string; kidsComing: boolean } | null>(null)
  // Kiosk only: signing at the counter means they're here — marked straight away.
  const [arrival, setArrival] = useState<null | { marked: boolean; code?: string; smsFailed?: boolean }>(null)

  /**
   * On the studio iPad, a family that just signed is standing at the counter:
   * mark them here (on the event's roster, or as a Craft Café visit) with no
   * extra staff step. Uses the staff endpoints, so it only works in a browser
   * signed in to /staff; anywhere else it's refused and nothing changes.
   */
  async function markArrived(recordId: string, people: string[]) {
    if (!kiosk || !recordId || people.length === 0) return
    const event = partyId ? { kind: 'party', id: partyId } : workshopId ? { kind: 'workshop', id: workshopId } : null
    try {
      const res = await fetch(event ? '/api/staff/rsvp.json' : '/api/staff/open-studio.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event ? { kind: event.kind, id: event.id, recordId, attending: people } : { recordId, personIds: people }),
      })
      const json = await res.json().catch(() => null)
      setArrival(res.ok ? { marked: true, code: json?.data?.oneTimeCode, smsFailed: !!json?.data?.smsFailed } : { marked: false })
    } catch {
      setArrival({ marked: false })
    }
  }

  // Returning-customer lookup: start on the lookup step; fall through to the
  // full form for new/expired households. Kiosk mode skips straight to the
  // full form — the crew already checked coverage on the Today screen, and a
  // shared device must never show one guest another guest's household.
  const [mode, setMode] = useState<'lookup' | 'returning' | 'form'>(kiosk ? 'form' : 'lookup')
  const [contact, setContact] = useState('')
  // This island is server-rendered, so the lookup field is on screen and
  // typeable before React hydrates — and hydration then re-asserts the empty
  // state, swallowing whatever was typed in that window (F5). Adopt the DOM's
  // value on mount instead of discarding it.
  const contactRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const typed = contactRef.current?.value
    if (typed) setContact((c) => c || typed)
  }, [])
  const [lookupBusy, setLookupBusy] = useState(false)
  const [returning, setReturning] = useState<{ recordId: string; reuseToken: string; firstName: string; kids: string[]; validUntil: string; signedAt: string; hasPickup: boolean } | null>(null)
  // Compact "Who may pick up?" block on the returning screen (HOM-212) —
  // only shown when `dropOff` and the on-file signature has no pickup rows.
  const [returningPickupRows, setReturningPickupRows] = useState<PickupRow[]>([])
  const [returningNotAuthorized, setReturningNotAuthorized] = useState('')
  // Friendly heads-up shown atop the form (e.g. a lapsed agreement was found).
  const [formNotice, setFormNotice] = useState<string | null>(null)
  // RSVP "who's coming" for the returning-household path: person id → coming?
  const [attending, setAttending] = useState<Record<string, boolean>>({})
  // Same idea for the fresh-form path — the signer may be dropping off, not
  // crafting. `false` = not coming; missing key defaults to coming.
  const [formAttending, setFormAttending] = useState<Record<string, boolean>>({})
  const formComing = (id: string) => formAttending[id] !== false

  // Any event context RSVPs; only parties ask the responsible-adult question
  // (workshops have no drop-off/responsible-adult concept server-side).
  const hasEvent = !!(partyId || workshopId)

  const fullName = `${firstName.trim()} ${lastName.trim()}`.trim()
  const signatureMatches =
    fullName.length > 2 &&
    signature.trim().toLowerCase().replace(/\s+/g, ' ') === fullName.toLowerCase().replace(/\s+/g, ' ')

  // True when a party RSVP has kids crafting but the signer isn't on the craft
  // list — we then ask whether the signer is still coming (watching) or another
  // adult is. Skipped entirely for studio-run drop-off events.
  const kidsWithoutSigner =
    !!partyId &&
    !dropOff &&
    minors.length > 0 &&
    formAttending['adult'] === false &&
    minors.some((_, i) => formComing(`child:${i}`))

  /** What we tell staff about who's with the kids: the signer themselves
   *  (watching, not crafting) or the adult they named. */
  const effectiveResponsibleAdult = (signerName: string) =>
    signerPresent === true ? `${signerName} (there, not crafting)` : responsibleAdult.trim()

  const returningKidsWithoutSigner =
    !!partyId &&
    !dropOff &&
    !!returning &&
    returning.kids.length > 0 &&
    attending['adult'] === false &&
    returning.kids.some((_, i) => !!attending[`child:${i}`])

  // Compact "Who may pick up?" block on the returning screen (HOM-212) —
  // only for a drop-off event whose on-file signature has no pickup rows yet.
  const showReturningPickup = !!dropOff && !!returning && !returning.hasPickup

  // The block asked "Who may pick up?" and then showed no name field at all
  // until you found the dashed "+ Add another" — start it with one empty row
  // so there's somewhere to answer. Still entirely optional: a blank row
  // never makes `returningPickupFilled` true.
  useEffect(() => {
    if (!showReturningPickup) return
    setReturningPickupRows((rows) => (rows.length === 0 ? [{ name: '', phone: '' }] : rows))
  }, [showReturningPickup])

  // Only send pickupUpdate when the guest actually typed something into the
  // block — an absent field must mean "no change" (fix round 1),
  // never an accidental clear from a block that was shown but left blank,
  // and never at all when the block wasn't shown in the first place.
  const returningPickupFilled =
    returningPickupRows.some((r) => r.name.trim()) || !!returningNotAuthorized.trim()

  /** One gentle question when kids are crafting and the signer isn't: are you
   *  still coming (watching), or is another adult bringing them? The name input
   *  only appears in the second case. */
  function presenceBlock(idPrefix: string) {
    return (
      <div style={{ marginTop: '0.9rem', textAlign: 'left' }}>
        <p style={{ ...labelStyle, marginBottom: '0.45rem' }}>{form.presenceQuestion}</p>
        {[
          { value: true, label: form.presenceYes },
          { value: false, label: form.presenceNo },
        ].map((opt) => (
          <label
            key={String(opt.value)}
            style={{
              display: 'flex',
              gap: '0.6rem',
              alignItems: 'flex-start',
              padding: '0.55rem 0.8rem',
              borderRadius: '0.75rem',
              border: `1px solid ${signerPresent === opt.value ? 'var(--color-primary)' : 'rgba(var(--color-primary-rgb), 0.2)'}`,
              background: signerPresent === opt.value ? 'rgba(var(--color-primary-rgb), 0.08)' : 'transparent',
              marginBottom: '0.45rem',
              cursor: 'pointer',
              fontSize: '0.875rem',
              color: 'var(--color-dark)',
              lineHeight: 1.45,
            }}
          >
            <input
              type="radio"
              name={`${idPrefix}-presence`}
              checked={signerPresent === opt.value}
              onChange={() => setSignerPresent(opt.value)}
              style={{ marginTop: '0.15rem' }}
            />
            {opt.label}
          </label>
        ))}
        {signerPresent === false && (
          <div style={{ marginTop: '0.5rem' }}>
            <label style={labelStyle} htmlFor={`${idPrefix}-responsible-adult`}>
              {form.responsibleAdultLabel}
            </label>
            <input
              id={`${idPrefix}-responsible-adult`}
              style={inputStyle}
              value={responsibleAdult}
              onChange={(e) => setResponsibleAdult(e.target.value)}
              placeholder="e.g. Grandma Sue"
            />
            <p style={{ ...sectionNoteStyle, margin: '0.3rem 0 0' }}>{form.responsibleAdultNote}</p>
          </div>
        )}
      </div>
    )
  }

  // What's still keeping the form from being signable — surfaced by the button
  // so a disabled state is never a mystery (the photo choice and exact-match
  // signature are the usual culprits).
  const missing = useMemo(() => {
    const m: string[] = []
    if (!firstName.trim()) m.push('your first name')
    if (!lastName.trim()) m.push('your last name')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) m.push('a valid email address')
    if (phone.replace(/\D/g, '').length < 10) m.push('a phone number (at least 10 digits)')
    if (!ageConfirmed) m.push(`to confirm you’re ${waiverContent.adultAge} or older`)
    if (minors.some((mn) => !mn.name.trim() || !mn.dob)) m.push('a name and date of birth for each child')
    // Emergency contact: required for drop-off (the signer isn't here);
    // otherwise optional, but a half-filled pair is an error, not a blank.
    const emName = emergencyName.trim()
    const emPhoneOk = emergencyPhone.replace(/\D/g, '').length >= 10
    const emStarted = !!emName || !!emergencyPhone.trim()
    if (dropOff || emStarted) {
      if (!emName) m.push('an emergency contact name')
      if (!emPhoneOk) m.push('an emergency contact phone (at least 10 digits)')
    }
    if (hasEvent && !['adult', ...minors.map((_, i) => `child:${i}`)].some((id) => formAttending[id] !== false)) {
      m.push('at least one person coming')
    }
    if (kidsWithoutSigner && signerPresent === null) {
      m.push("whether you’ll be at the party with your kids")
    }
    if (kidsWithoutSigner && signerPresent === false && !responsibleAdult.trim()) {
      m.push("the adult who’ll be with your child at the party")
    }
    if (!agreeRelease) m.push('the checkbox agreeing to the terms')
    if (dropOff && pickupRows.some((r) => r.name.trim() && r.name.trim().length < 2)) {
      m.push('a full name (2+ characters) for each pickup person')
    }
    if (dropOff && pickupRows.some((r) => r.phone.trim() && r.phone.replace(/\D/g, '').length < 10)) {
      m.push('a valid phone number (10+ digits) for each pickup person, or leave it blank')
    }
    if (!signatureMatches) m.push('your typed signature (must match your name exactly)')
    return m
  }, [firstName, lastName, email, phone, ageConfirmed, minors, emergencyName, emergencyPhone, agreeRelease, signatureMatches, partyId, formAttending, kidsWithoutSigner, signerPresent, responsibleAdult, dropOff, pickupRows])

  const canSubmit = missing.length === 0 && !submitting

  function updateMinor(i: number, patch: Partial<MinorRow>) {
    setMinors((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }

  async function handleSubmit() {
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/waiver/sign.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adult: {
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            email: email.trim(),
            phone: phone.trim(),
            ageConfirmed,
          },
          minors: minors.map((m) => ({
            name: m.name.trim(),
            dob: m.dob,
            allergies: m.allergies.trim(),
            medications: m.medications.trim(),
          })),
          emergency: {
            name: emergencyName.trim(),
            phone: emergencyPhone.trim(),
          },
          authorizedPickup: dropOff
            ? pickupRows.filter((r) => r.name.trim()).map((r) => ({ name: r.name.trim(), phone: r.phone.trim() }))
            : [],
          notAuthorized: dropOff ? notAuthorized.trim() : '',
          adultAllergies: adultAllergies.trim(),
          photoConsent,
          agreeRelease,
          signature: signature.trim(),
          partyId: partyId ?? null,
          workshopId: workshopId ?? null,
          booking: booking ?? null,
          // Who's making a craft — watchers come free and aren't counted here.
          attending: ['adult', ...minors.map((_, i) => `child:${i}`)].filter(formComing),
          responsibleAdult: kidsWithoutSigner ? effectiveResponsibleAdult(fullName) : '',
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        trackWaiverStep('sign_failed', waiverKind, kiosk, { status: res.status })
        throw new Error(json?.error ?? 'Something went wrong — please try again.')
      }
      trackWaiverSigned({ kind: waiverKind, kids: minors.filter((_, i) => formComing(`child:${i}`)).length, dropOff: !!dropOff, kiosk, returning: false })
      // Fresh signature — we always email a copy (HOM-216).
      setDone({
        covered: json.data.covered,
        validUntil: json.data.validUntil,
        subline: confirmation.emailedCopyLine.replace('{email}', email.trim()),
        kidsComing: minors.some((_, i) => formComing(`child:${i}`)),
      })
      await markArrived(json.data.recordId, ['adult', ...minors.map((_, i) => `child:${i}`)].filter(formComing))
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong — please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleLookup() {
    const c = contact.trim()
    if (!c) return
    setLookupBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/waiver/lookup.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact: c, partyId: partyId ?? null, workshopId: workshopId ?? null }),
      })
      const json = await res.json().catch(() => null)
      trackWaiverStep('lookup', waiverKind, kiosk, {
        result: !res.ok ? 'error' : json?.data?.mustResign ? 'must_resign' : json?.data?.found && json.data.recordId ? 'found' : json?.data?.expired ? 'expired' : 'new',
      })
      if (!res.ok) {
        setError(json?.error ?? 'Something went wrong — please try again.')
      } else if (json?.data?.mustResign) {
        // The agreement changed since they last signed (HOM-210) — no
        // one-tap reuse; open the full form prefilled with what we have.
        setFirstName(json.data.firstName ?? '')
        if (c.includes('@')) setEmail(c)
        else setPhone(c)
        setFormNotice(json.data.notice ?? waiverContent.mustResignNotice)
        setMode('form')
      } else if (json?.data?.found && json.data.recordId) {
        // A valid household is on file — show it (no code step).
        const kids: string[] = json.data.kids ?? []
        setReturning({ recordId: json.data.recordId, reuseToken: json.data.reuseToken ?? '', firstName: json.data.firstName, kids, validUntil: json.data.validUntil ?? '', signedAt: json.data.signedAt ?? '', hasPickup: !!json.data.hasPickup })
        // Default everyone in the household to "coming"; they can uncheck below.
        setAttending(Object.fromEntries(['adult', ...kids.map((_, i) => `child:${i}`)].map((id) => [id, true])))
        setMode('returning')
      } else {
        // New or expired — prefill what they typed and open the full form.
        if (c.includes('@')) setEmail(c)
        else setPhone(c)
        if (json?.data?.expired) {
          const on = json.data.validUntil
            ? ` on ${new Date(json.data.validUntil).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`
            : ''
          const hi = json.data.firstName ? `Welcome back, ${json.data.firstName}! ` : ''
          setFormNotice(`${hi}We found your previous agreement, but it expired${on}. Agreements are good for a year, so we just need a quick re-sign below.`)
        } else {
          setFormNotice(null)
        }
        setMode('form')
      }
    } catch {
      trackWaiverStep('lookup', waiverKind, kiosk, { result: 'unreachable' })
      // Graceful degradation: the lookup service hiccuped, but the full form
      // still works — tell them why they landed here instead of failing silently.
      if (c.includes('@')) setEmail(c)
      else setPhone(c)
      setFormNotice("We couldn’t look you up just now — no problem, the full form below works too.")
      setMode('form')
    } finally {
      setLookupBusy(false)
    }
  }

  async function handleReturningRsvp() {
    if (!returning) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/waiver/sign.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reuseRecordId: returning.recordId,
          reuseToken: returning.reuseToken,
          partyId: partyId ?? null,
          workshopId: workshopId ?? null,
          booking: booking ?? null,
          attending: Object.entries(attending).filter(([, coming]) => coming).map(([id]) => id),
          responsibleAdult: returningKidsWithoutSigner ? effectiveResponsibleAdult(returning.firstName) : '',
          ...(showReturningPickup && returningPickupFilled
            ? {
                pickupUpdate: {
                  authorizedPickup: returningPickupRows
                    .filter((r) => r.name.trim())
                    .map((r) => ({ name: r.name.trim(), phone: r.phone.trim() })),
                  notAuthorized: returningNotAuthorized.trim(),
                },
              }
            : {}),
        }),
      })
      const json = await res.json().catch(() => null)
      if (res.status === 401) {
        trackWaiverStep('returning_expired', waiverKind, kiosk)
        // Session token expired — send back to lookup with a clear message.
        setReturning(null)
        setMode('lookup')
        setError('Your session expired — enter your email or phone again to continue.')
        return
      }
      if (res.status === 409 && json?.mustResign) {
        // The agreement changed since this household last signed — open the
        // full form prefilled with what we have (defense in depth: the
        // lookup step should already have routed them here directly).
        trackWaiverStep('returning_must_resign', waiverKind, kiosk)
        setFirstName(returning.firstName)
        setReturning(null)
        setFormNotice(json?.error ?? waiverContent.mustResignNotice)
        setMode('form')
        return
      }
      if (!res.ok) {
        trackWaiverStep('sign_failed', waiverKind, kiosk, { status: res.status, returning: true })
        throw new Error(json?.error ?? 'Something went wrong — please try again.')
      }
      trackWaiverSigned({
        kind: waiverKind,
        kids: (returning?.kids ?? []).filter((_, i) => !!attending[`child:${i}`]).length,
        dropOff: !!dropOff,
        kiosk,
        returning: true,
      })
      setDone({
        covered: json.data.covered,
        validUntil: json.data.validUntil,
        subline: confirmation.subline,
        kidsComing: (returning?.kids ?? []).some((_, i) => !!attending[`child:${i}`]),
      })
      await markArrived(json.data.waiverId ?? returning.recordId, Object.entries(attending).filter(([, coming]) => coming).map(([id]) => id))
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong — please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  /**
   * Kiosk hand-back: navigate to `returnTo` and, in the same breath, clear
   * every bit of what was typed — belt and suspenders alongside
   * `history.replaceState` so a back-navigation from the next page can never
   * land on this filled-in state (HOM-209 — a shared iPad, next guest up).
   */
  function kioskReturn() {
    setFirstName(''); setLastName(''); setEmail(''); setPhone(''); setAgeConfirmed(false)
    setMinors([])
    setEmergencyName(''); setEmergencyPhone('')
    setPickupRows([]); setNotAuthorized(''); setAdultAllergies('')
    setPhotoConsent(true); setAgreeRelease(false); setSignature('')
    setResponsibleAdult(''); setSignerPresent(null)
    setError(null); setFormNotice(null); setDone(null); setArrival(null)
    try {
      history.replaceState(null, '', returnTo)
    } catch {
      // ignore — location.replace below still gets us there
    }
    location.replace(returnTo)
  }

  // 20s auto-return from the kiosk done screen (or an immediate tap on Done).
  useEffect(() => {
    if (!kiosk || !done) return
    const t = setTimeout(kioskReturn, 20_000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kiosk, done])

  if (done && kiosk) {
    const validDate = new Date(done.validUntil).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })
    return (
      <div style={{ ...cardStyle, textAlign: 'center', padding: '2.5rem 1.5rem' }}>
        <div
          style={{
            width: '3.5rem',
            height: '3.5rem',
            margin: '0 auto 1.25rem',
            borderRadius: '50%',
            background: 'rgba(34, 197, 94, 0.12)',
            color: 'rgb(22, 163, 74)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.75rem',
            fontWeight: 700,
          }}
        >
          ✓
        </div>
        <h2 style={{ ...sectionHeadingStyle, fontSize: '1.375rem', marginBottom: '0.5rem' }}>
          Done — hand the iPad back
        </h2>
        <p style={{ ...sectionNoteStyle, maxWidth: '22rem', margin: '0 auto 0.5rem' }}>
          {firstName.trim() ? `Thanks, ${firstName.trim()}!` : 'Thanks!'}
        </p>
        <p style={{ ...sectionNoteStyle, maxWidth: '22rem', margin: '0 auto 1rem' }}>
          Valid through <strong>{validDate}</strong>.
        </p>
        {arrival?.marked && (
          <p data-testid="kiosk-arrived" style={{ margin: '0 auto 1rem', fontWeight: 700, color: 'rgb(21,128,61)' }}>✓ Checked in — you’re all set.</p>
        )}
        {arrival?.code && (
          <div style={{ margin: '0 auto 1.25rem' }}>
            <p style={{ ...sectionNoteStyle, margin: '0 0 0.2rem' }}>Pickup code</p>
            <p style={{ margin: 0, fontSize: '2.25rem', fontWeight: 800, letterSpacing: '0.2em', color: 'var(--color-dark)' }}>{arrival.code}</p>
            <p style={{ ...sectionNoteStyle, margin: '0.3rem 0 0', ...(arrival.smsFailed ? { color: '#b91c1c', fontWeight: 700 } : {}) }}>
              {arrival.smsFailed ? 'The text didn’t send. Write this down or show the staff.' : 'We texted it to you too.'}
            </p>
          </div>
        )}
        {arrival && !arrival.marked && (
          <p data-testid="kiosk-not-arrived" style={{ ...sectionNoteStyle, margin: '0 auto 1.25rem', fontWeight: 600 }}>
            Staff: tap ✓ Here for them on the roster.
          </p>
        )}
        <button
          type="button"
          onClick={kioskReturn}
          style={{
            padding: '0.85rem 2rem',
            borderRadius: '0.875rem',
            border: 'none',
            background: 'var(--color-primary)',
            color: '#fff',
            fontSize: '1rem',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Done
        </button>
      </div>
    )
  }

  if (done) {
    const validDate = new Date(done.validUntil).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })
    return (
      <div style={{ ...cardStyle, textAlign: 'center', padding: '2.5rem 1.5rem' }}>
        <div
          style={{
            width: '3.5rem',
            height: '3.5rem',
            margin: '0 auto 1.25rem',
            borderRadius: '50%',
            background: 'rgba(34, 197, 94, 0.12)',
            color: 'rgb(22, 163, 74)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.75rem',
            fontWeight: 700,
          }}
        >
          ✓
        </div>
        <h2 style={{ ...sectionHeadingStyle, fontSize: '1.375rem', marginBottom: '0.5rem' }}>
          {confirmation.headline}
        </h2>
        <p style={{ ...sectionNoteStyle, maxWidth: '26rem', margin: '0 auto 0.75rem' }}>
          {done.subline}
        </p>
        <p style={{ ...sectionNoteStyle, maxWidth: '26rem', margin: '0 auto 1.25rem', fontSize: '0.8125rem' }}>
          {confirmation.anotherAdultLine}
        </p>
        {hasEvent && dropOff && done.kidsComing && (
          <div style={{ maxWidth: '26rem', margin: '0 auto 1.25rem', textAlign: 'left' }}>
            {[confirmation.dropOffPickupLine, confirmation.dropOffIdLine, lateFeeLine()].map((line) => (
              <p key={line} style={{ ...sectionNoteStyle, margin: '0 0 0.35rem' }}>{line}</p>
            ))}
          </div>
        )}
        {partyId && (
          <p style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--color-dark)', marginBottom: '1rem' }}>
            {confirmation.partyLine}
          </p>
        )}
        <div
          style={{
            maxWidth: '22rem',
            margin: '0 auto',
            textAlign: 'left',
            background: 'rgba(var(--color-primary-rgb), 0.06)',
            border: '1px solid rgba(var(--color-primary-rgb), 0.12)',
            borderRadius: '0.875rem',
            padding: '1rem 1.25rem',
          }}
        >
          <p style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-primary)', margin: '0 0 0.4rem' }}>
            {confirmation.coversLabel}
          </p>
          {done.covered.map((name) => (
            <p key={name} style={{ fontSize: '0.9375rem', color: 'var(--color-dark)', margin: '0 0 0.2rem' }}>
              {name}
            </p>
          ))}
          <p style={{ fontSize: '0.8125rem', color: 'var(--color-muted)', margin: '0.6rem 0 0' }}>
            {confirmation.validLabel} <strong>{validDate}</strong>
          </p>
        </div>
      </div>
    )
  }

  // Step 0 — returning-customer lookup.
  if (mode === 'lookup') {
    return (
      <div style={{ maxWidth: '30rem', margin: '0 auto' }}>
        {partyLabel && <PartyLabelChip label={partyLabel} />}
        <div style={{ ...cardStyle, marginBottom: 0 }}>
        <h2 style={sectionHeadingStyle}>Been here before?</h2>
        <p style={sectionNoteStyle}>
          Enter your email or phone and we’ll pull up your agreement — no need to fill it out again.
        </p>
        <input
          ref={contactRef}
          style={inputStyle}
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleLookup()}
          placeholder="Email or phone"
          autoComplete="email"
        />
        {error && <p style={{ color: 'rgb(185,28,28)', fontSize: '0.875rem', marginTop: '0.6rem' }}>{error}</p>}
        <button
          type="button"
          onClick={handleLookup}
          disabled={!contact.trim() || lookupBusy}
          style={{
            marginTop: '0.9rem',
            width: '100%',
            padding: '0.8rem',
            borderRadius: '0.875rem',
            border: 'none',
            background: contact.trim() && !lookupBusy ? 'var(--color-primary)' : 'rgba(var(--color-primary-rgb),0.35)',
            color: '#fff',
            fontSize: '1rem',
            fontWeight: 600,
            cursor: contact.trim() && !lookupBusy ? 'pointer' : 'not-allowed',
          }}
        >
          {lookupBusy ? 'Looking you up…' : 'Continue'}
        </button>
        <button
          type="button"
          onClick={() => { trackWaiverStep('lookup', waiverKind, kiosk, { result: 'skipped' }); setMode('form') }}
          style={{ display: 'block', margin: '0.9rem auto 0', background: 'none', border: 'none', color: 'var(--color-primary)', fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer' }}
        >
          First time here? Fill out the form →
        </button>
        </div>
      </div>
    )
  }

  // Returning customer with a valid agreement on file — one-tap RSVP.
  if (mode === 'returning' && returning) {
    const returningValidDate = returning.validUntil
      ? new Date(returning.validUntil).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
      : ''

    return (
      <div style={{ maxWidth: '30rem', margin: '0 auto' }}>
        {partyLabel && <PartyLabelChip label={partyLabel} />}
        <div style={{ ...cardStyle, marginBottom: 0, textAlign: 'center' }}>
        <h2 style={{ ...sectionHeadingStyle, fontSize: '1.375rem' }}>Welcome back, {returning.firstName}! 🎉</h2>
        <p style={{ ...sectionNoteStyle, maxWidth: '24rem', margin: '0.25rem auto 1.25rem' }}>
          Your participation agreement is already on file — you don’t need to sign again.
          {hasEvent ? ' Just tell us who’s coming.' : ''}
        </p>
        {(() => {
          const roster = [
            { id: 'adult', label: `${returning.firstName} (you)` },
            ...returning.kids.map((k, i) => ({ id: `child:${i}`, label: k })),
          ]
          const comingCount = roster.filter((r) => attending[r.id]).length
          return (
            <div style={{ background: 'rgba(var(--color-primary-rgb),0.06)', border: '1px solid rgba(var(--color-primary-rgb),0.12)', borderRadius: '0.875rem', padding: '0.85rem 1rem', textAlign: 'left', maxWidth: '22rem', margin: '0 auto 1.1rem' }}>
              <p style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-primary)', margin: '0 0 0.5rem' }}>
                {hasEvent ? 'Who’s coming?' : 'On file for your household'}
              </p>
              {roster.map((r) => (
                <label
                  key={r.id}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.4rem 0', cursor: hasEvent ? 'pointer' : 'default', fontSize: '0.9375rem', color: 'var(--color-dark)' }}
                >
                  {hasEvent && (
                    <input
                      type="checkbox"
                      checked={!!attending[r.id]}
                      onChange={(e) => setAttending((a) => ({ ...a, [r.id]: e.target.checked }))}
                    />
                  )}
                  <span>{r.label}</span>
                </label>
              ))}
              {hasEvent && (
                <p style={{ fontSize: '0.75rem', color: 'var(--color-muted)', margin: '0.5rem 0 0' }}>
                  Someone can still be added at the door if plans change.
                </p>
              )}
              {hasEvent && comingCount === 0 && (
                <p style={{ fontSize: '0.8125rem', color: 'rgb(185,28,28)', margin: '0.4rem 0 0', fontWeight: 600 }}>
                  Pick at least one person who’s coming.
                </p>
              )}
            </div>
          )
        })()}
        {returning.signedAt && (
          <p style={{ fontSize: '0.8125rem', color: 'var(--color-muted)', maxWidth: '22rem', margin: '0 auto 1.1rem' }}>
            Your agreement signed {formatCalendarDate(returning.signedAt)} still covers everyone here.
          </p>
        )}
        {returningKidsWithoutSigner && (
          <div style={{ maxWidth: '22rem', margin: '0 auto 1rem' }}>{presenceBlock('wv-ret')}</div>
        )}
        {dropOff && returning.hasPickup && (
          <p style={{ ...sectionNoteStyle, maxWidth: '22rem', margin: '0 auto 1rem' }}>
            Pickup people are on file — tell the front desk if that changes.
          </p>
        )}
        {showReturningPickup && (
          <div style={{ maxWidth: '22rem', margin: '0 auto 1rem', textAlign: 'left' }}>
            <p style={{ ...labelStyle, marginBottom: '0.5rem' }}>{form.returningPickupHeading}</p>
            <PickupFields
              rows={returningPickupRows}
              onRowsChange={setReturningPickupRows}
              notAuthorized={returningNotAuthorized}
              onNotAuthorizedChange={setReturningNotAuthorized}
              compact
            />
          </div>
        )}
        {error && <p style={{ color: 'rgb(185,28,28)', fontSize: '0.875rem', marginBottom: '0.75rem' }}>{error}</p>}
        {hasEvent ? (
          (() => {
            const noneComing = !Object.values(attending).some(Boolean)
            const needsAdult =
              returningKidsWithoutSigner &&
              (signerPresent === null || (signerPresent === false && !responsibleAdult.trim()))
            const disabled = submitting || noneComing || needsAdult
            return (
              <button
                type="button"
                onClick={handleReturningRsvp}
                disabled={disabled}
                style={{
                  width: '100%',
                  padding: '0.85rem',
                  borderRadius: '0.875rem',
                  border: 'none',
                  background: disabled ? 'rgba(var(--color-primary-rgb),0.35)' : 'var(--color-button)',
                  color: '#fff',
                  fontSize: '1rem',
                  fontWeight: 600,
                  cursor: disabled ? 'not-allowed' : 'pointer',
                }}
              >
                {submitting ? 'One moment…' : '✓ RSVP us'}
              </button>
            )
          })()
        ) : (
          <p style={{ ...sectionNoteStyle, fontWeight: 600, color: 'var(--color-dark)', margin: '0 0 0.25rem' }}>
            You’re already covered — valid through {returningValidDate}.
          </p>
        )}
        <button
          type="button"
          onClick={() => { setReturning(null); setMode('form') }}
          style={{ display: 'block', margin: '0.9rem auto 0', background: 'none', border: 'none', color: 'var(--color-primary)', fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer' }}
        >
          Adding a new child, or something changed? Update your agreement →
        </button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={(e) => e.preventDefault()} autoComplete={kiosk ? 'off' : undefined}>
      {kiosk && (
        <div
          style={{
            background: 'rgba(var(--color-primary-rgb), 0.08)',
            border: '1px solid rgba(var(--color-primary-rgb), 0.2)',
            borderRadius: '0.75rem',
            padding: '0.65rem 1rem',
            marginBottom: '1.25rem',
            fontSize: '0.8125rem',
            color: 'var(--color-dark)',
            lineHeight: 1.5,
            textAlign: 'center',
          }}
        >
          Signing on the studio iPad — your details are only saved to your agreement, not to this device.
        </div>
      )}
      {(partyLabel ?? eventTitle) && <PartyLabelChip label={(partyLabel ?? eventTitle)!} />}
      {formNotice && (
        <div
          style={{
            background: 'rgba(217, 119, 6, 0.08)',
            border: '1px solid rgba(217, 119, 6, 0.28)',
            borderRadius: '0.875rem',
            padding: '0.9rem 1.15rem',
            marginBottom: '1.25rem',
            fontSize: '0.875rem',
            color: 'var(--color-dark)',
            lineHeight: 1.5,
          }}
        >
          {formNotice}
        </div>
      )}

      {/* The agreement — full text, scrollable, before any checkbox. */}
      <div style={cardStyle}>
        <h2 style={sectionHeadingStyle}>{form.agreementHeading}</h2>
        <p style={sectionNoteStyle}>{form.agreementNote}</p>
        <div style={scrollBoxStyle}>
          {legalSections.map((section) => (
            <div key={section.heading} style={{ marginBottom: '1rem' }}>
              <h3 style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--color-dark)', margin: '0 0 0.35rem' }}>
                {section.heading}
              </h3>
              {section.body.map((para, i) => (
                <p key={i} style={{ fontSize: '0.8125rem', color: 'var(--color-dark)', lineHeight: 1.6, margin: '0 0 0.5rem' }}>
                  {para}
                </p>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* About you */}
      <div style={cardStyle}>
        <h2 style={sectionHeadingStyle}>{form.adultHeading}</h2>
        <p style={sectionNoteStyle}>{form.adultNote}</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))', gap: '0.75rem' }}>
          <div>
            <label style={labelStyle} htmlFor="wv-first">First name</label>
            <input id="wv-first" style={inputStyle} value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" />
          </div>
          <div>
            <label style={labelStyle} htmlFor="wv-last">Last name</label>
            <input id="wv-last" style={inputStyle} value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" />
          </div>
          <div>
            <label style={labelStyle} htmlFor="wv-email">Email</label>
            <input id="wv-email" type="email" style={inputStyle} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </div>
          <div>
            <label style={labelStyle} htmlFor="wv-phone">Phone</label>
            <input id="wv-phone" type="tel" style={inputStyle} value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
          </div>
        </div>
        <label
          htmlFor="wv-age"
          style={{
            display: 'flex',
            gap: '0.65rem',
            alignItems: 'flex-start',
            marginTop: '0.9rem',
            fontSize: '0.875rem',
            color: 'var(--color-dark)',
            lineHeight: 1.5,
            cursor: 'pointer',
          }}
        >
          <input
            id="wv-age"
            type="checkbox"
            checked={ageConfirmed}
            onChange={(e) => setAgeConfirmed(e.target.checked)}
            style={{ marginTop: '0.2rem' }}
          />
          <span><strong>{form.ageConfirmLabel}</strong></span>
        </label>
        <p style={{ ...sectionNoteStyle, margin: '0.4rem 0 0' }}>{form.ageConfirmNote}</p>
      </div>

      {/* Children */}
      <div style={cardStyle}>
        <h2 style={sectionHeadingStyle}>{form.minorsHeading}</h2>
        <p style={sectionNoteStyle}>{form.minorsNote}</p>
        {minors.map((minor, i) => (
          <div key={i} style={{ border: '1px solid rgba(var(--color-primary-rgb),0.14)', borderRadius: '0.75rem', padding: '0.85rem', marginBottom: '0.75rem', background: 'rgba(var(--color-primary-rgb),0.03)' }}>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ flex: '2 1 12rem' }}>
                <label style={labelStyle} htmlFor={`wv-minor-name-${i}`}>Child’s full name</label>
                <input id={`wv-minor-name-${i}`} style={inputStyle} value={minor.name} onChange={(e) => updateMinor(i, { name: e.target.value })} />
              </div>
              <div style={{ flex: '1 1 9rem' }}>
                <label style={labelStyle} htmlFor={`wv-minor-dob-${i}`}>Date of birth</label>
                <input id={`wv-minor-dob-${i}`} type="date" style={inputStyle} value={minor.dob} onChange={(e) => updateMinor(i, { dob: e.target.value })} />
              </div>
              <button
                type="button"
                aria-label={`Remove ${minor.name || 'child'}`}
                onClick={() => setMinors((rows) => rows.filter((_, idx) => idx !== i))}
                style={{ border: '1px solid rgba(var(--color-primary-rgb), 0.25)', background: 'transparent', color: 'var(--color-muted)', borderRadius: '0.625rem', padding: '0.6rem 0.8rem', cursor: 'pointer', fontSize: '0.875rem' }}
              >
                ✕
              </button>
            </div>
            <div style={{ marginTop: '0.6rem' }}>
              <label style={labelStyle} htmlFor={`wv-minor-allergy-${i}`}>{minor.name ? `${minor.name.split(' ')[0]}’s allergies / medical` : 'Allergies / medical'} (optional)</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input id={`wv-minor-allergy-${i}`} style={inputStyle} value={minor.allergies} onChange={(e) => updateMinor(i, { allergies: e.target.value })} placeholder="e.g. Peanuts, bee stings — or leave blank" />
                <NoneChip active={minor.allergies === form.allergiesNoneChip} onClick={() => updateMinor(i, { allergies: form.allergiesNoneChip })} />
              </div>
              <p style={{ ...sectionNoteStyle, margin: '0.3rem 0 0' }}>{form.allergiesNoneHelper}</p>
            </div>
            {dropOff && (
              <div style={{ marginTop: '0.6rem' }}>
                <label style={labelStyle} htmlFor={`wv-minor-meds-${i}`}>{form.medicationsLabel}</label>
                <input
                  id={`wv-minor-meds-${i}`}
                  style={inputStyle}
                  value={minor.medications}
                  onChange={(e) => updateMinor(i, { medications: e.target.value })}
                  placeholder="Leave blank if none"
                  maxLength={300}
                />
              </div>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={() => setMinors((rows) => [...rows, { name: '', dob: '', allergies: '', medications: '' }])}
          style={{
            border: '1px dashed rgba(var(--color-primary-rgb), 0.4)',
            background: 'rgba(var(--color-primary-rgb), 0.05)',
            color: 'var(--color-primary)',
            borderRadius: '0.75rem',
            padding: '0.6rem 1rem',
            cursor: 'pointer',
            fontSize: '0.875rem',
            fontWeight: 600,
          }}
        >
          {form.addMinorLabel}
        </button>
      </div>

      {/* Emergency contact */}
      <div style={cardStyle}>
        <h2 style={sectionHeadingStyle}>{form.emergencyHeading}</h2>
        <p style={sectionNoteStyle}>{dropOff ? form.emergencyNoteDropOff : form.emergencyNote}</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))', gap: '0.75rem' }}>
          <div>
            <label style={labelStyle} htmlFor="wv-em-name">Name</label>
            <input id="wv-em-name" style={inputStyle} value={emergencyName} onChange={(e) => setEmergencyName(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle} htmlFor="wv-em-phone">Phone</label>
            <input id="wv-em-phone" type="tel" style={inputStyle} value={emergencyPhone} onChange={(e) => setEmergencyPhone(e.target.value)} />
          </div>
        </div>
        <div style={{ marginTop: '0.9rem' }}>
          <label style={labelStyle} htmlFor="wv-adult-allergies">{form.adultAllergiesLabel}</label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              id="wv-adult-allergies"
              style={inputStyle}
              value={adultAllergies}
              onChange={(e) => setAdultAllergies(e.target.value)}
              placeholder="Your own allergies, if you’ll be crafting — or leave blank"
            />
            <NoneChip active={adultAllergies === form.allergiesNoneChip} onClick={() => setAdultAllergies(form.allergiesNoneChip)} />
          </div>
          <p style={{ ...sectionNoteStyle, margin: '0.3rem 0 0' }}>{form.allergiesNoneHelper}</p>
        </div>
        {dropOff && (
          <div style={{ marginTop: '0.9rem' }}>
            <PickupFields
              rows={pickupRows}
              onRowsChange={setPickupRows}
              notAuthorized={notAuthorized}
              onNotAuthorizedChange={setNotAuthorized}
            />
          </div>
        )}
      </div>

      {/* Photo preference — defaults to yes; opting out is one tap and never blocks. */}
      <div style={cardStyle}>
        <h2 style={sectionHeadingStyle}>{form.photoHeading}</h2>
        <p style={sectionNoteStyle}>{form.photoNote}</p>
        {[
          { value: true, label: form.photoYes },
          { value: false, label: form.photoNo },
        ].map((opt) => (
          <label
            key={String(opt.value)}
            style={{
              display: 'flex',
              gap: '0.65rem',
              alignItems: 'flex-start',
              padding: '0.7rem 0.85rem',
              borderRadius: '0.75rem',
              border: `1px solid ${photoConsent === opt.value ? 'var(--color-primary)' : 'rgba(var(--color-primary-rgb), 0.2)'}`,
              background: photoConsent === opt.value ? 'rgba(var(--color-primary-rgb), 0.08)' : 'transparent',
              marginBottom: '0.5rem',
              cursor: 'pointer',
              fontSize: '0.875rem',
              color: 'var(--color-dark)',
              lineHeight: 1.45,
            }}
          >
            <input
              type="radio"
              name="photoConsent"
              checked={photoConsent === opt.value}
              onChange={() => setPhotoConsent(opt.value)}
              style={{ marginTop: '0.2rem' }}
            />
            {opt.label}
          </label>
        ))}
      </div>

      {/* Who's coming — any event context (party, workshop), incl. the staff kiosk */}
      {hasEvent && (
        <div style={cardStyle}>
          <h2 style={sectionHeadingStyle}>Who’s making a craft?</h2>
          <p style={sectionNoteStyle}>
            Check everyone who’s crafting — coming along to watch is free, no checkmark needed.
          </p>
          {[{ id: 'adult', label: `${fullName || 'You'} (you)`, icon: '👤' }, ...minors.map((m, i) => ({ id: `child:${i}`, label: m.name.trim() || `Child ${i + 1}`, icon: '🧒' }))].map((p) => (
            <label
              key={p.id}
              style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', padding: '0.5rem 0', cursor: 'pointer', fontSize: '0.9375rem', color: 'var(--color-dark)' }}
            >
              <input
                type="checkbox"
                checked={formComing(p.id)}
                onChange={(e) => setFormAttending((a) => ({ ...a, [p.id]: e.target.checked }))}
                style={{ width: '1.3rem', height: '1.3rem', flex: '0 0 auto', accentColor: 'var(--color-primary)', cursor: 'pointer' }}
              />
              <span>{p.icon} {p.label}</span>
            </label>
          ))}
          {!['adult', ...minors.map((_, i) => `child:${i}`)].some(formComing) && (
            <p style={{ fontSize: '0.8125rem', color: 'rgb(185,28,28)', margin: '0.4rem 0 0', fontWeight: 600 }}>
              Pick at least one person who’s coming.
            </p>
          )}
          {kidsWithoutSigner && presenceBlock('wv')}
        </div>
      )}

      {/* Assent + signature */}
      <div style={cardStyle}>
        <label
          style={{
            display: 'flex',
            gap: '0.65rem',
            alignItems: 'flex-start',
            fontSize: '0.875rem',
            color: 'var(--color-dark)',
            lineHeight: 1.5,
            cursor: 'pointer',
            marginBottom: '1rem',
          }}
        >
          <input
            type="checkbox"
            checked={agreeRelease}
            onChange={(e) => setAgreeRelease(e.target.checked)}
            style={{ marginTop: '0.2rem' }}
          />
          <span>
            <strong>{form.releaseCheckboxLabel}</strong>
          </span>
        </label>

        <label style={labelStyle} htmlFor="wv-signature">{form.signatureLabel}</label>
        <input
          id="wv-signature"
          style={{
            ...inputStyle,
            fontFamily: 'var(--font-heading)',
            fontSize: '1.125rem',
            fontStyle: 'italic',
            borderColor: signature && !signatureMatches ? 'rgba(220, 38, 38, 0.5)' : 'rgba(var(--color-primary-rgb), 0.25)',
          }}
          value={signature}
          onChange={(e) => setSignature(e.target.value)}
          placeholder={fullName || 'Your full name'}
          autoComplete="off"
        />
        {signature.trim() && !signatureMatches && (
          <p style={{ color: '#b45309', fontSize: '0.8125rem', margin: '0.35rem 0 0', fontWeight: 600 }}>
            This needs to match your name exactly — type: “{fullName || 'enter your name above first'}”
          </p>
        )}
        <p style={{ ...sectionNoteStyle, margin: '0.35rem 0 0' }}>{form.signatureNote}</p>

        {error && (
          <p style={{ color: 'rgb(185, 28, 28)', fontSize: '0.875rem', marginTop: '0.9rem', fontWeight: 500 }}>
            {error}
          </p>
        )}

        {missing.length > 0 && (
          <div
            style={{
              marginTop: '1.1rem',
              background: 'rgba(217, 119, 6, 0.08)',
              border: '1px solid rgba(217, 119, 6, 0.28)',
              borderRadius: '0.75rem',
              padding: '0.75rem 1rem',
            }}
          >
            <p style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#b45309', margin: '0 0 0.35rem' }}>
              Almost there — still need:
            </p>
            <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
              {missing.map((item) => (
                <li key={item} style={{ fontSize: '0.8125rem', color: 'var(--color-dark)', lineHeight: 1.55 }}>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}

        <button
          type="button"
          disabled={!canSubmit}
          onClick={handleSubmit}
          title={missing.length > 0 ? `Still needed: ${missing.join(', ')}` : undefined}
          style={{
            marginTop: '1.1rem',
            width: '100%',
            padding: '0.85rem',
            borderRadius: '0.875rem',
            border: 'none',
            background: canSubmit ? 'var(--color-primary)' : 'rgba(var(--color-primary-rgb), 0.35)',
            color: '#fff',
            fontSize: '1rem',
            fontWeight: 600,
            cursor: canSubmit ? 'pointer' : 'not-allowed',
            transition: 'background 150ms ease',
          }}
        >
          {submitting ? form.submittingLabel : form.submitLabel}
        </button>
      </div>
    </form>
  )
}
