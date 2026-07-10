import { useMemo, useState } from 'react'
import { waiverContent } from '@config/waiver-content'

interface Props {
  /** Present when opened from a party guest link — /waiver?party={bookingId} */
  partyId?: string
}

interface MinorRow {
  name: string
  dob: string
  allergies: string
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.65rem 0.85rem',
  borderRadius: '0.625rem',
  border: '1px solid rgba(150, 112, 91, 0.25)',
  background: 'rgba(255, 255, 255, 0.85)',
  fontSize: '0.9375rem',
  color: 'var(--color-dark)',
  outline: 'none',
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.8125rem',
  fontWeight: 600,
  color: 'var(--color-dark)',
  marginBottom: '0.3rem',
}

const sectionHeadingStyle: React.CSSProperties = {
  fontSize: '1.0625rem',
  fontFamily: 'var(--font-heading)',
  fontWeight: 600,
  color: 'var(--color-dark)',
  margin: '0 0 0.25rem',
}

const sectionNoteStyle: React.CSSProperties = {
  fontSize: '0.8125rem',
  color: 'var(--color-muted)',
  margin: '0 0 0.9rem',
  lineHeight: 1.5,
}

const cardStyle: React.CSSProperties = {
  background: 'rgba(255, 255, 255, 0.72)',
  backdropFilter: 'blur(14px)',
  WebkitBackdropFilter: 'blur(14px)',
  border: '1px solid rgba(150, 112, 91, 0.16)',
  borderRadius: '1.25rem',
  padding: '1.5rem',
  boxShadow: '0 18px 44px rgba(150, 112, 91, 0.12)',
  marginBottom: '1.25rem',
}

export default function WaiverFlow({ partyId }: Props) {
  const { form, confirmation, legalSections } = waiverContent

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [dob, setDob] = useState('')
  const [minors, setMinors] = useState<MinorRow[]>([])
  const [emergencyName, setEmergencyName] = useState('')
  const [emergencyPhone, setEmergencyPhone] = useState('')
  const [emergencyRelationship, setEmergencyRelationship] = useState('')
  const [authorizedPickup, setAuthorizedPickup] = useState('')
  const [adultAllergies, setAdultAllergies] = useState('')
  const [photoConsent, setPhotoConsent] = useState<boolean | null>(null)
  const [agreeRelease, setAgreeRelease] = useState(false)
  const [signature, setSignature] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ covered: string[]; validUntil: string } | null>(null)

  // Returning-customer lookup: start on the lookup step; fall through to the
  // full form for new/expired households.
  const [mode, setMode] = useState<'lookup' | 'returning' | 'form'>('lookup')
  const [contact, setContact] = useState('')
  const [lookupBusy, setLookupBusy] = useState(false)
  const [returning, setReturning] = useState<{ recordId: string; reuseToken: string; firstName: string; kids: string[] } | null>(null)
  // Friendly heads-up shown atop the form (e.g. a lapsed agreement was found).
  const [formNotice, setFormNotice] = useState<string | null>(null)
  // RSVP "who's coming" for the returning-household path: person id → coming?
  const [attending, setAttending] = useState<Record<string, boolean>>({})
  // Same idea for the fresh-form path — the signer may be dropping off, not
  // crafting. `false` = not coming; missing key defaults to coming.
  const [formAttending, setFormAttending] = useState<Record<string, boolean>>({})
  const formComing = (id: string) => formAttending[id] !== false

  const fullName = `${firstName.trim()} ${lastName.trim()}`.trim()
  const signatureMatches =
    fullName.length > 2 &&
    signature.trim().toLowerCase().replace(/\s+/g, ' ') === fullName.toLowerCase().replace(/\s+/g, ' ')

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
    if (minors.some((mn) => !mn.name.trim() || !mn.dob)) m.push('a name and date of birth for each child')
    if (!emergencyName.trim()) m.push('an emergency contact name')
    if (emergencyPhone.replace(/\D/g, '').length < 10) m.push('an emergency contact phone')
    if (photoConsent === null) m.push('a photo preference (either answer is fine)')
    if (partyId && !['adult', ...minors.map((_, i) => `child:${i}`)].some((id) => formAttending[id] !== false)) {
      m.push('at least one person going to the party')
    }
    if (!agreeRelease) m.push('the checkbox agreeing to the terms')
    if (!signatureMatches) m.push('your typed signature (must match your name exactly)')
    return m
  }, [firstName, lastName, email, phone, dob, minors, emergencyName, emergencyPhone, photoConsent, agreeRelease, signatureMatches, partyId, formAttending])

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
          minors: minors.map((m) => ({ name: m.name.trim(), dob: m.dob, allergies: m.allergies.trim() })),
          emergency: {
            name: emergencyName.trim(),
            phone: emergencyPhone.trim(),
            relationship: emergencyRelationship.trim(),
          },
          authorizedPickup: authorizedPickup.trim(),
          adultAllergies: adultAllergies.trim(),
          photoConsent,
          agreeRelease,
          signature: signature.trim(),
          partyId: partyId ?? null,
          // Who's actually doing the craft — the signer may just be dropping off.
          attending: ['adult', ...minors.map((_, i) => `child:${i}`)].filter(formComing),
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error ?? 'Something went wrong — please try again.')
      setDone({ covered: json.data.covered, validUntil: json.data.validUntil })
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
        body: JSON.stringify({ contact: c }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        setError(json?.error ?? 'Something went wrong — please try again.')
      } else if (json?.data?.found) {
        const kids: string[] = json.data.kids ?? []
        setReturning({ recordId: json.data.recordId, reuseToken: json.data.reuseToken ?? '', firstName: json.data.firstName, kids })
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
      if (c.includes('@')) setEmail(c)
      else setPhone(c)
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
          attending: Object.entries(attending).filter(([, coming]) => coming).map(([id]) => id),
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
      if (!res.ok) throw new Error(json?.error ?? 'Something went wrong — please try again.')
      setDone({ covered: json.data.covered, validUntil: json.data.validUntil })
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong — please try again.')
    } finally {
      setSubmitting(false)
    }
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
        <p style={{ ...sectionNoteStyle, maxWidth: '26rem', margin: '0 auto 1.25rem' }}>
          {confirmation.subline}
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
      <div style={{ ...cardStyle, maxWidth: '30rem', margin: '0 auto' }}>
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
    )
  }

  // Returning customer with a valid agreement on file — one-tap RSVP.
  if (mode === 'returning' && returning) {
    return (
      <div style={{ ...cardStyle, maxWidth: '30rem', margin: '0 auto', textAlign: 'center' }}>
        <h2 style={{ ...sectionHeadingStyle, fontSize: '1.375rem' }}>Welcome back, {returning.firstName}! 🎉</h2>
        <p style={{ ...sectionNoteStyle, maxWidth: '24rem', margin: '0.25rem auto 1.25rem' }}>
          Your participation agreement is already on file — you don’t need to sign again.
          {partyId ? ' Just tell us who’s coming.' : ''}
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
                {partyId ? "Who's coming?" : 'On file for your household'}
              </p>
              {roster.map((r) => (
                <label
                  key={r.id}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.4rem 0', cursor: partyId ? 'pointer' : 'default', fontSize: '0.9375rem', color: 'var(--color-dark)' }}
                >
                  {partyId && (
                    <input
                      type="checkbox"
                      checked={!!attending[r.id]}
                      onChange={(e) => setAttending((a) => ({ ...a, [r.id]: e.target.checked }))}
                    />
                  )}
                  <span>{r.label}</span>
                </label>
              ))}
              {partyId && (
                <p style={{ fontSize: '0.75rem', color: 'var(--color-muted)', margin: '0.5rem 0 0' }}>
                  Someone can still be added at the door if plans change.
                </p>
              )}
              {partyId && comingCount === 0 && (
                <p style={{ fontSize: '0.8125rem', color: 'rgb(185,28,28)', margin: '0.4rem 0 0', fontWeight: 600 }}>
                  Pick at least one person who’s coming.
                </p>
              )}
            </div>
          )
        })()}
        {error && <p style={{ color: 'rgb(185,28,28)', fontSize: '0.875rem', marginBottom: '0.75rem' }}>{error}</p>}
        {(() => {
          const noneComing = !!partyId && !Object.values(attending).some(Boolean)
          const disabled = submitting || noneComing
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
              {submitting ? 'One moment…' : partyId ? '✓ RSVP us' : '✓ Check me in'}
            </button>
          )
        })()}
        <button
          type="button"
          onClick={() => { setReturning(null); setMode('form') }}
          style={{ display: 'block', margin: '0.9rem auto 0', background: 'none', border: 'none', color: 'var(--color-primary)', fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer' }}
        >
          Adding a new child, or something changed? Update your agreement →
        </button>
      </div>
    )
  }

  return (
    <div>
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
        <div
          style={{
            maxHeight: '20rem',
            overflowY: 'auto',
            border: '1px solid rgba(150, 112, 91, 0.18)',
            borderRadius: '0.75rem',
            padding: '1rem 1.1rem',
            background: 'rgba(255, 255, 255, 0.9)',
          }}
        >
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
            <input id="wv-dob" type="date" style={inputStyle} value={dob} onChange={(e) => setDob(e.target.value)} />
          </div>
        </div>
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
              <input id={`wv-minor-allergy-${i}`} style={inputStyle} value={minor.allergies} onChange={(e) => updateMinor(i, { allergies: e.target.value })} placeholder="e.g. Peanuts, bee stings — or leave blank" />
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setMinors((rows) => [...rows, { name: '', dob: '', allergies: '' }])}
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
          <input
            id="wv-adult-allergies"
            style={inputStyle}
            value={adultAllergies}
            onChange={(e) => setAdultAllergies(e.target.value)}
            placeholder="Your own allergies, if you’ll be crafting — or leave blank"
          />
        </div>
        <div style={{ marginTop: '0.9rem' }}>
          <label style={labelStyle} htmlFor="wv-pickup">{form.pickupLabel}</label>
          <input
            id="wv-pickup"
            style={inputStyle}
            value={authorizedPickup}
            onChange={(e) => setAuthorizedPickup(e.target.value)}
            placeholder="Names of adults allowed to pick up your child(ren)"
          />
        </div>
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

      {/* Who's coming — only in a party context; the signer may be dropping off */}
      {partyId && (
        <div style={cardStyle}>
          <h2 style={sectionHeadingStyle}>Who’s coming to the party?</h2>
          <p style={sectionNoteStyle}>
            Check everyone who’ll be there doing the craft. If you’re just dropping off, leave yourself unchecked.
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
    </div>
  )
}
