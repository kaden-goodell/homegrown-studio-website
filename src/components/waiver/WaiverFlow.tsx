import { useEffect, useMemo, useRef, useState } from 'react'
import { waiverContent, dropOffAddendum } from '@config/waiver-content'
import { formatCalendarDate } from '@lib/studio-time'
import { maskDob, dobToIso } from '@lib/dob-input'
import PickupFields, { type PickupRow } from '@components/waiver/PickupFields'
import { inputStyle, labelStyle, sectionHeadingStyle, sectionNoteStyle, scrollBoxStyle, cardStyle } from '@components/waiver/waiver-ui'

interface Props {
  /** Present when opened from a party guest link — /waiver?party={bookingId} */
  partyId?: string
  /** Human-readable label shown to the guest so they can see which party their
   *  signature attaches to. Derived server-side from the party record. */
  partyLabel?: string
  /** Present when opened from a workshop confirmation — /waiver?workshop={bookingId} */
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
        border: `1px solid ${active ? 'var(--color-primary)' : 'rgba(150, 112, 91, 0.3)'}`,
        background: active ? 'rgba(150, 112, 91, 0.1)' : 'transparent',
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

/** Drop-off Program Addendum card — full text + its own unchecked checkbox
 *  (HOM-211). Rendered identically on the fresh-form path (after the main
 *  agreement) and the returning-RSVP path (above the roster); never
 *  pre-checked, never merged with the release checkbox. */
function AddendumCard({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  const { form } = waiverContent
  return (
    <div style={cardStyle}>
      <h2 style={sectionHeadingStyle}>{dropOffAddendum.title}</h2>
      <div style={scrollBoxStyle}>
        {dropOffAddendum.sections.map((section) => (
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
      <label
        style={{
          display: 'flex',
          gap: '0.65rem',
          alignItems: 'flex-start',
          fontSize: '0.875rem',
          color: 'var(--color-dark)',
          lineHeight: 1.5,
          cursor: 'pointer',
          marginTop: '1rem',
        }}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          style={{ marginTop: '0.2rem' }}
        />
        <span>
          <strong>{form.addendumCheckboxLabel}</strong>
        </span>
      </label>
    </div>
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
        background: 'rgba(150, 112, 91, 0.10)',
        border: '1px solid rgba(150, 112, 91, 0.22)',
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

const CODE_LENGTH = 6
const RESEND_COOLDOWN_MS = 60_000
const MAX_RESENDS = 3

/** Six single-digit boxes for the SMS one-time code (HOM-218) — numeric
 *  keyboard, auto-advance on entry, backspace walks back, and pasting all 6
 *  digits at once (e.g. from an iOS SMS autofill suggestion) fills every box. */
function CodeBoxes({ value, onChange, disabled }: { value: string[]; onChange: (v: string[]) => void; disabled: boolean }) {
  const refs = useRef<Array<HTMLInputElement | null>>([])
  return (
    <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', margin: '1rem 0' }}>
      {value.map((digit, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el }}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={1}
          disabled={disabled}
          value={digit}
          onChange={(e) => {
            const raw = e.target.value.replace(/\D/g, '')
            if (!raw) {
              onChange(value.map((d, idx) => (idx === i ? '' : d)))
              return
            }
            const next = value.map((d, idx) => (idx === i ? raw.slice(-1) : d))
            onChange(next)
            if (i < value.length - 1) refs.current[i + 1]?.focus()
          }}
          onPaste={(e) => {
            const digits = e.clipboardData.getData('text').replace(/\D/g, '')
            if (digits.length >= value.length) {
              e.preventDefault()
              onChange(digits.slice(0, value.length).split(''))
              refs.current[value.length - 1]?.focus()
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !value[i] && i > 0) refs.current[i - 1]?.focus()
          }}
          style={{
            width: '2.75rem',
            height: '3.25rem',
            textAlign: 'center',
            fontSize: '1.5rem',
            fontWeight: 700,
            borderRadius: '0.75rem',
            border: '1px solid rgba(150, 112, 91, 0.3)',
            color: 'var(--color-dark)',
          }}
        />
      ))}
    </div>
  )
}

export default function WaiverFlow({ partyId, partyLabel, workshopId, eventTitle: _eventTitle, dropOff, booking, kiosk = false, returnTo = '/staff' }: Props) {
  const { form, confirmation, legalSections } = waiverContent

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  // `dob` stays the ISO value the server expects; `dobMasked` is the
  // MM/DD/YYYY text the person actually sees/types (HOM-212).
  const [dob, setDob] = useState('')
  const [dobMasked, setDobMasked] = useState('')
  const [minors, setMinors] = useState<MinorRow[]>([])
  const [emergencyName, setEmergencyName] = useState('')
  const [emergencyPhone, setEmergencyPhone] = useState('')
  const [emergencyRelationship, setEmergencyRelationship] = useState('')
  // Authorized pickup + "may NOT collect" — drop-off events only (HOM-212).
  const [pickupRows, setPickupRows] = useState<PickupRow[]>([])
  const [notAuthorized, setNotAuthorized] = useState('')
  const [adultAllergies, setAdultAllergies] = useState('')
  const [photoConsent, setPhotoConsent] = useState<boolean | null>(null)
  const [agreeRelease, setAgreeRelease] = useState(false)
  // Drop-off Program Addendum checkbox (HOM-211) — separate from agreeRelease,
  // shown only when a drop-off event has a minor attending.
  const [agreeAddendum, setAgreeAddendum] = useState(false)
  const [signature, setSignature] = useState('')
  const [responsibleAdult, setResponsibleAdult] = useState('')
  // Kids crafting without the signer on the list: is the signer still coming
  // (watching, not crafting) or is another adult bringing them? null = unanswered.
  const [signerPresent, setSignerPresent] = useState<boolean | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // `subline` is the confirmation-screen line under the headline — varies by
  // path (fresh sign vs. returning RSVP w/ or w/o an addendum), see HOM-216.
  const [done, setDone] = useState<{ covered: string[]; validUntil: string; subline: string } | null>(null)

  // Returning-customer lookup: start on the lookup step; fall through to the
  // full form for new/expired households. Kiosk mode skips straight to the
  // full form — the crew already checked coverage on the Today screen, and a
  // shared device must never show one guest another guest's household.
  const [mode, setMode] = useState<'lookup' | 'code' | 'returning' | 'form'>(kiosk ? 'form' : 'lookup')
  const [contact, setContact] = useState('')
  const [lookupBusy, setLookupBusy] = useState(false)
  const [returning, setReturning] = useState<{ recordId: string; reuseToken: string; firstName: string; kids: string[]; validUntil: string; signedAt: string; hasPickup: boolean } | null>(null)
  // SMS one-time-code step (HOM-218) — sits between "Been here before?" and
  // the returning screen; nothing identifying (kids, recordId, reuseToken)
  // exists client-side until `handleVerify` succeeds.
  const [phoneHint, setPhoneHint] = useState('')
  const [code, setCode] = useState<string[]>(Array(CODE_LENGTH).fill(''))
  const [codeBusy, setCodeBusy] = useState(false)
  const [resendBusy, setResendBusy] = useState(false)
  const [resendCount, setResendCount] = useState(0)
  const [resendAvailableAt, setResendAvailableAt] = useState(0)
  // Forces a re-render each second while the resend cooldown counts down —
  // otherwise the "(58s)" label would only update on the next keystroke.
  const [, forceTick] = useState(0)
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

  // Small local age calculator (mirrors the server's yearsBetween).
  function yearsBetween(dobIso: string, now: Date): number {
    const d = new Date(`${dobIso}T00:00:00`)
    let years = now.getFullYear() - d.getFullYear()
    const anniversary = new Date(d)
    anniversary.setFullYear(now.getFullYear())
    if (now < anniversary) years--
    return years
  }

  // Adult DOB masked input (HOM-212) — `dob` stays the ISO value the server
  // expects; the text field shows/edits `dobMasked` instead.
  function handleDobInput(raw: string) {
    const masked = maskDob(raw)
    setDobMasked(masked)
    setDob(dobToIso(masked) ?? '')
  }

  // Inline note (not just on submit) when the typed DOB makes the signer 18
  // or younger — Alabama's age of majority is 19 (HOM-212).
  const signerUnderage = !!dob && yearsBetween(dob, new Date()) < waiverContent.adultAge
  const underageNoteText = waiverContent.form.underageNote.replace(
    '{link}',
    typeof window !== 'undefined' ? window.location.href : '',
  )

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

  // Drop-off Program Addendum (HOM-211) on the fresh path: required whenever
  // the event is drop-off, full stop — deliberately stricter client-side
  // than the server's minors-only `addendumRequired` (an adult-only
  // drop-off registration never needs it server-side, but always showing/
  // requiring it here is harmless and avoids the card popping in/out as
  // minors are added or removed).
  //
  // Same "needs a minor attending" rule for the returning path (left as-is —
  // it already sits above the roster, so there's no fold-visibility issue).
  const returningKidsWithoutSigner =
    !!partyId &&
    !dropOff &&
    !!returning &&
    returning.kids.length > 0 &&
    attending['adult'] === false &&
    returning.kids.some((_, i) => !!attending[`child:${i}`])

  // Same addendum rule as the fresh path, evaluated against the returning
  // household's roster instead of the freshly-typed minors list.
  const addendumNeededReturning = !!dropOff && !!returning && returning.kids.some((_, i) => !!attending[`child:${i}`])

  // Compact "Who may pick up?" block on the returning screen (HOM-212) —
  // only for a drop-off event whose on-file signature has no pickup rows yet.
  const showReturningPickup = !!dropOff && !!returning && !returning.hasPickup

  // Only send pickupUpdate when the guest actually typed something into the
  // block — an absent field must mean "no change" (fix round 1 addendum),
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
              border: `1px solid ${signerPresent === opt.value ? 'var(--color-primary)' : 'rgba(150, 112, 91, 0.2)'}`,
              background: signerPresent === opt.value ? 'rgba(150, 112, 91, 0.08)' : 'transparent',
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
    if (!dob) m.push('your date of birth')
    if (dob && yearsBetween(dob, new Date()) < waiverContent.adultAge) {
      m.push(`to be ${waiverContent.adultAge}+ to sign — ask a parent/guardian to sign and list you`)
    }
    if (minors.some((mn) => !mn.name.trim() || !mn.dob)) m.push('a name and date of birth for each child')
    if (!emergencyName.trim()) m.push('an emergency contact name')
    if (emergencyPhone.replace(/\D/g, '').length < 10) m.push('an emergency contact phone')
    if (photoConsent === null) m.push('a photo preference (either answer is fine)')
    if (partyId && !['adult', ...minors.map((_, i) => `child:${i}`)].some((id) => formAttending[id] !== false)) {
      m.push('at least one person going to the party')
    }
    if (kidsWithoutSigner && signerPresent === null) {
      m.push("whether you’ll be at the party with your kids")
    }
    if (kidsWithoutSigner && signerPresent === false && !responsibleAdult.trim()) {
      m.push("the adult who’ll be with your child at the party")
    }
    if (!agreeRelease) m.push('the checkbox agreeing to the terms')
    if (dropOff && !agreeAddendum) m.push('the Drop-off Program Addendum checkbox')
    if (dropOff && pickupRows.some((r) => r.name.trim() && r.name.trim().length < 2)) {
      m.push('a full name (2+ characters) for each pickup person')
    }
    if (dropOff && pickupRows.some((r) => r.phone.trim() && r.phone.replace(/\D/g, '').length < 10)) {
      m.push('a valid phone number (10+ digits) for each pickup person, or leave it blank')
    }
    if (!signatureMatches) m.push('your typed signature (must match your name exactly)')
    return m
  }, [firstName, lastName, email, phone, dob, minors, emergencyName, emergencyPhone, photoConsent, agreeRelease, agreeAddendum, signatureMatches, partyId, formAttending, kidsWithoutSigner, signerPresent, responsibleAdult, dropOff, pickupRows])

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
            dob,
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
            relationship: emergencyRelationship.trim(),
          },
          authorizedPickup: dropOff
            ? pickupRows.filter((r) => r.name.trim()).map((r) => ({ name: r.name.trim(), phone: r.phone.trim() }))
            : [],
          notAuthorized: dropOff ? notAuthorized.trim() : '',
          adultAllergies: adultAllergies.trim(),
          photoConsent,
          agreeRelease,
          agreeAddendum,
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
      if (!res.ok) throw new Error(json?.error ?? 'Something went wrong — please try again.')
      // Fresh signature — we always email a copy (HOM-216).
      setDone({
        covered: json.data.covered,
        validUntil: json.data.validUntil,
        subline: confirmation.emailedCopyLine.replace('{email}', email.trim()),
      })
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong — please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  // Countdown for the code step's "Send again" cooldown (HOM-218) — a bare
  // second-by-second re-render so the "(58s)" label ticks down on its own.
  useEffect(() => {
    if (mode !== 'code') return
    const t = setInterval(() => forceTick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [mode])
  const resendSecondsLeft = Math.max(0, Math.ceil((resendAvailableAt - Date.now()) / 1000))

  async function handleLookup() {
    const c = contact.trim()
    if (!c) return
    setLookupBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/waiver/lookup.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact: c }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        setError(json?.error ?? 'Something went wrong — please try again.')
      } else if (json?.data?.mustResign) {
        // The agreement changed since they last signed (HOM-210) — no
        // one-tap reuse; open the full form prefilled with what we have.
        setFirstName(json.data.firstName ?? '')
        if (c.includes('@')) setEmail(c)
        else setPhone(c)
        setFormNotice(waiverContent.mustResignNotice)
        setMode('form')
      } else if (json?.data?.smsFailed) {
        // Quo's down, or the on-file phone can't be normalized (HOM-218) — no
        // OTP step is possible; fall straight through to the full form,
        // never a bypass of the code check.
        if (c.includes('@')) setEmail(c)
        else setPhone(c)
        setFormNotice(waiverContent.lookup.smsFailedLine)
        setMode('form')
      } else if (json?.data?.needsCode) {
        // A code just went out to the on-file phone (HOM-218) — nothing
        // identifying (kids, recordId, reuseToken) exists client-side yet.
        setPhoneHint(json.data.phoneHint ?? '')
        setCode(Array(CODE_LENGTH).fill(''))
        setResendCount(0)
        setResendAvailableAt(Date.now() + RESEND_COOLDOWN_MS)
        setMode('code')
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

  /** Verify the 6-digit code (HOM-218) — success is the only path that ever
   *  hands the browser kids' names, a recordId, or a reuseToken. */
  async function handleVerify() {
    const typed = code.join('')
    if (typed.length !== CODE_LENGTH || codeBusy) return
    setCodeBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/waiver/verify.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // partyId/workshopId let the server check whether an existing RSVP's
        // pickup override already covers THIS event (fix round 1) — without
        // them hasPickup could only ever see the signature's own fields.
        body: JSON.stringify({ contact: contact.trim(), code: typed, partyId: partyId ?? null, workshopId: workshopId ?? null }),
      })
      const json = await res.json().catch(() => null)
      if (res.status === 429 || res.status === 410) {
        // Locked out or expired — the OTP is gone either way; back to lookup.
        setMode('lookup')
        setError(json?.error ?? 'Please look yourself up again.')
        return
      }
      if (!res.ok) {
        setError(json?.error ?? "That code isn't right — try again.")
        setCode(Array(CODE_LENGTH).fill(''))
        return
      }
      const kids: string[] = json.data.kids ?? []
      setReturning({ recordId: json.data.recordId, reuseToken: json.data.reuseToken ?? '', firstName: json.data.firstName, kids, validUntil: json.data.validUntil ?? '', signedAt: json.data.signedAt ?? '', hasPickup: !!json.data.hasPickup })
      // Defensive prefill (fix round 1): if the compact pickup block ever
      // does render for a household that already has an override on file,
      // start it from that data instead of blank — an edit, not a replace.
      if (json.data.pickup) {
        setReturningPickupRows(
          (json.data.pickup.authorizedPickup ?? []).map((p: { name: string; phone: string }) => ({ name: p.name, phone: p.phone })),
        )
        setReturningNotAuthorized(json.data.pickup.notAuthorized ?? '')
      }
      // Default everyone in the household to "coming"; they can uncheck below.
      setAttending(Object.fromEntries(['adult', ...kids.map((_, i) => `child:${i}`)].map((id) => [id, true])))
      setMode('returning')
    } catch {
      setError('Something went wrong — please try again.')
    } finally {
      setCodeBusy(false)
    }
  }

  /** "Didn't get it? Send again" — 60s cooldown, hidden after 3 uses (HOM-218). */
  async function handleResend() {
    if (resendBusy || resendCount >= MAX_RESENDS || resendSecondsLeft > 0) return
    setResendBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/waiver/lookup.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact: contact.trim(), resend: true }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        setError(json?.error ?? 'Something went wrong — please try again.')
      } else if (json?.data?.smsFailed) {
        setError(waiverContent.lookup.smsFailedLine)
      } else if (json?.data?.phoneHint) {
        setPhoneHint(json.data.phoneHint)
      }
    } catch {
      setError('Something went wrong — please try again.')
    } finally {
      setResendCount((n) => n + 1)
      setResendAvailableAt(Date.now() + RESEND_COOLDOWN_MS)
      setResendBusy(false)
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
          agreeAddendum,
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
        setFirstName(returning.firstName)
        setReturning(null)
        setFormNotice(waiverContent.mustResignNotice)
        setMode('form')
        return
      }
      if (!res.ok) throw new Error(json?.error ?? 'Something went wrong — please try again.')
      // Only an addendum acceptance sends an email on this path — the base
      // agreement is already on file and unchanged (HOM-216).
      setDone({
        covered: json.data.covered,
        validUntil: json.data.validUntil,
        subline: json.data.addendumAccepted ? confirmation.emailedAddendumLine : confirmation.subline,
      })
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
    setFirstName(''); setLastName(''); setEmail(''); setPhone(''); setDob(''); setDobMasked('')
    setMinors([])
    setEmergencyName(''); setEmergencyPhone(''); setEmergencyRelationship('')
    setPickupRows([]); setNotAuthorized(''); setAdultAllergies('')
    setPhotoConsent(null); setAgreeRelease(false); setAgreeAddendum(false); setSignature('')
    setResponsibleAdult(''); setSignerPresent(null)
    setError(null); setFormNotice(null); setDone(null)
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
        <p style={{ ...sectionNoteStyle, maxWidth: '22rem', margin: '0 auto 1.5rem' }}>
          Valid through <strong>{validDate}</strong>.
        </p>
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
            background: 'rgba(150, 112, 91, 0.06)',
            border: '1px solid rgba(150, 112, 91, 0.12)',
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
            background: contact.trim() && !lookupBusy ? 'var(--color-primary)' : 'rgba(150,112,91,0.35)',
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
          onClick={() => setMode('form')}
          style={{ display: 'block', margin: '0.9rem auto 0', background: 'none', border: 'none', color: 'var(--color-primary)', fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer' }}
        >
          First time here? Fill out the form →
        </button>
        </div>
      </div>
    )
  }

  // Step 0.5 — SMS one-time code (HOM-218). Gates the returning-household
  // screen; nothing identifying exists client-side until handleVerify succeeds.
  if (mode === 'code') {
    const { lookup } = waiverContent
    const codeComplete = code.every((d) => d !== '')
    const resendDisabled = resendBusy || resendCount >= MAX_RESENDS || resendSecondsLeft > 0
    return (
      <div style={{ maxWidth: '30rem', margin: '0 auto' }}>
        {partyLabel && <PartyLabelChip label={partyLabel} />}
        <div style={{ ...cardStyle, marginBottom: 0, textAlign: 'center' }}>
          <h2 style={sectionHeadingStyle}>{lookup.codeSentLine.replace('{phoneHint}', phoneHint)}</h2>
          <p style={sectionNoteStyle}>{lookup.codeInputLabel}</p>
          <CodeBoxes value={code} onChange={setCode} disabled={codeBusy} />
          {error && <p style={{ color: 'rgb(185,28,28)', fontSize: '0.875rem', marginTop: '0.4rem' }}>{error}</p>}
          <button
            type="button"
            onClick={handleVerify}
            disabled={!codeComplete || codeBusy}
            style={{
              marginTop: '0.9rem',
              width: '100%',
              padding: '0.8rem',
              borderRadius: '0.875rem',
              border: 'none',
              background: codeComplete && !codeBusy ? 'var(--color-primary)' : 'rgba(150,112,91,0.35)',
              color: '#fff',
              fontSize: '1rem',
              fontWeight: 600,
              cursor: codeComplete && !codeBusy ? 'pointer' : 'not-allowed',
            }}
          >
            {codeBusy ? lookup.verifyingLabel : lookup.verifyLabel}
          </button>
          {resendCount < MAX_RESENDS && (
            <button
              type="button"
              onClick={handleResend}
              disabled={resendDisabled}
              style={{
                display: 'block',
                margin: '0.9rem auto 0',
                background: 'none',
                border: 'none',
                color: resendDisabled ? 'var(--color-muted)' : 'var(--color-primary)',
                fontSize: '0.8125rem',
                fontWeight: 600,
                cursor: resendDisabled ? 'default' : 'pointer',
              }}
            >
              {resendBusy
                ? lookup.resendingLabel
                : resendSecondsLeft > 0
                  ? lookup.resendCooldownLabel.replace('{seconds}', String(resendSecondsLeft))
                  : lookup.resendLabel}
            </button>
          )}
          <button
            type="button"
            onClick={() => { setMode('lookup'); setError(null); setCode(Array(CODE_LENGTH).fill('')) }}
            style={{ display: 'block', margin: '0.6rem auto 0', background: 'none', border: 'none', color: 'var(--color-muted)', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer' }}
          >
            Not you? Look up again →
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
        {addendumNeededReturning && <AddendumCard checked={agreeAddendum} onChange={setAgreeAddendum} />}
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
            <div style={{ background: 'rgba(150,112,91,0.06)', border: '1px solid rgba(150,112,91,0.12)', borderRadius: '0.875rem', padding: '0.85rem 1rem', textAlign: 'left', maxWidth: '22rem', margin: '0 auto 1.1rem' }}>
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
            const needsAddendum = addendumNeededReturning && !agreeAddendum
            const disabled = submitting || noneComing || needsAdult || needsAddendum
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
                  background: disabled ? 'rgba(150,112,91,0.35)' : 'linear-gradient(135deg, var(--color-primary), var(--color-accent))',
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
            background: 'rgba(150, 112, 91, 0.08)',
            border: '1px solid rgba(150, 112, 91, 0.2)',
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
      {partyLabel && <PartyLabelChip label={partyLabel} />}
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
          <div>
            <label style={labelStyle} htmlFor="wv-dob">Your date of birth</label>
            <input
              id="wv-dob"
              inputMode="numeric"
              style={inputStyle}
              value={dobMasked}
              onChange={(e) => handleDobInput(e.target.value)}
              placeholder="MM/DD/YYYY"
              autoComplete="bday"
            />
          </div>
        </div>
        {signerUnderage && (
          <p style={{ ...sectionNoteStyle, margin: '0.75rem 0 0', color: '#b45309', fontWeight: 600 }}>
            {underageNoteText}
          </p>
        )}
      </div>

      {/* Children */}
      <div style={cardStyle}>
        <h2 style={sectionHeadingStyle}>{form.minorsHeading}</h2>
        <p style={sectionNoteStyle}>{form.minorsNote}</p>
        {minors.map((minor, i) => (
          <div key={i} style={{ border: '1px solid rgba(150,112,91,0.14)', borderRadius: '0.75rem', padding: '0.85rem', marginBottom: '0.75rem', background: 'rgba(150,112,91,0.03)' }}>
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
                style={{ border: '1px solid rgba(150, 112, 91, 0.25)', background: 'transparent', color: 'var(--color-muted)', borderRadius: '0.625rem', padding: '0.6rem 0.8rem', cursor: 'pointer', fontSize: '0.875rem' }}
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
            border: '1px dashed rgba(150, 112, 91, 0.4)',
            background: 'rgba(150, 112, 91, 0.05)',
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
        <p style={sectionNoteStyle}>{form.emergencyNote}</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))', gap: '0.75rem' }}>
          <div>
            <label style={labelStyle} htmlFor="wv-em-name">Name</label>
            <input id="wv-em-name" style={inputStyle} value={emergencyName} onChange={(e) => setEmergencyName(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle} htmlFor="wv-em-phone">Phone</label>
            <input id="wv-em-phone" type="tel" style={inputStyle} value={emergencyPhone} onChange={(e) => setEmergencyPhone(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle} htmlFor="wv-em-rel">Relationship</label>
            <input id="wv-em-rel" style={inputStyle} value={emergencyRelationship} onChange={(e) => setEmergencyRelationship(e.target.value)} placeholder="Spouse, grandparent…" />
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

      {/* Photo preference — separate, optional, no default. */}
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
              border: `1px solid ${photoConsent === opt.value ? 'var(--color-primary)' : 'rgba(150, 112, 91, 0.2)'}`,
              background: photoConsent === opt.value ? 'rgba(150, 112, 91, 0.08)' : 'transparent',
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

      {/* Who's coming — only in a party context */}
      {partyId && (
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
              Pick at least one person going to the party.
            </p>
          )}
          {kidsWithoutSigner && presenceBlock('wv')}
        </div>
      )}

      {/* Drop-off Program Addendum (HOM-211) — its own card, its own
          checkbox. Rendered whenever the event is drop-off, regardless of
          whether a minor has been added yet (a Task 5 review fix: gating on
          minors.some(formComing) made it invisible on first load and popped
          it in below the fold once a child was added). Sits immediately
          above the assent/signature card — the last thing before the
          release checkbox. */}
      {dropOff && <AddendumCard checked={agreeAddendum} onChange={setAgreeAddendum} />}

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
            borderColor: signature && !signatureMatches ? 'rgba(220, 38, 38, 0.5)' : 'rgba(150, 112, 91, 0.25)',
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
            background: canSubmit ? 'var(--color-primary)' : 'rgba(150, 112, 91, 0.35)',
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
