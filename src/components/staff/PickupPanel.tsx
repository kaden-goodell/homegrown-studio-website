import { useState } from 'react'
import { btn, field } from '@components/staff/ui'
import type { Household } from '@components/staff/HouseholdCard'

type PostFn = (recordId: string, extra: any) => Promise<{ error?: string; oneTimeCode?: string; smsFailed?: boolean }>

const OVERRIDE_REASONS: { value: 'called-parent' | 'parent-present' | 'other'; label: (phone: string) => string }[] = [
  { value: 'called-parent', label: (phone) => `Called the parent at ${phone} — verified` },
  { value: 'parent-present', label: () => 'Parent is here in person' },
]

/** Case-insensitive, trimmed match against a chip or the signer's own name —
 *  mirrors the server's "known collector" check (HOM-214) so the checkbox
 *  only appears when it would actually be required. Matches against the
 *  LIVE door-side list (`checkin.confirmedPickup`, editable via "Edit list")
 *  rather than the static waiver-level `authorizedPickup` — the server gate
 *  reads the same live list. */
function isKnownCollector(name: string, h: Household): boolean {
  const n = name.trim().toLowerCase()
  if (!n) return false
  if (n === h.signer.trim().toLowerCase()) return true
  return h.checkin.confirmedPickup.some((p) => p.name.trim().toLowerCase() === n)
}

/**
 * Drop-off custody UI for one household's checkout, extracted from
 * `HouseholdCard` (HOM-214): who's-collecting chips + photo-ID checkbox,
 * pickup-code entry with a tries-left counter, the quiet Override sheet, the
 * locked state, and Re-send code — plus the pickup-code reveal itself. Falls
 * back to a plain "collected by" input + Check out for non-drop-off events
 * (§8 — unchanged there).
 */
export default function PickupPanel({
  h,
  dropOff,
  day,
  selectedOut,
  checkingOutChild,
  post,
  revealCode,
  smsFailed,
  onCodeIssued,
}: {
  h: Household
  dropOff: boolean
  day: string
  selectedOut: string[]
  checkingOutChild: boolean
  post: PostFn
  revealCode: string | null
  smsFailed: boolean
  onCodeIssued: (code: string | null, smsFailed: boolean) => void
}) {
  const [collectedBy, setCollectedBy] = useState('')
  const [idChecked, setIdChecked] = useState(false)
  const [code, setCode] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [overrideOpen, setOverrideOpen] = useState(false)
  const [overrideReason, setOverrideReason] = useState<'called-parent' | 'parent-present' | 'other' | ''>('')
  const [overrideText, setOverrideText] = useState('')

  const [resendChoosing, setResendChoosing] = useState(false)
  const [resendOtherText, setResendOtherText] = useState('')
  const [resendToast, setResendToast] = useState<string | null>(null)

  const [editingList, setEditingList] = useState(false)
  const [editRows, setEditRows] = useState<{ name: string; phone: string }[]>([])

  const gated = dropOff && checkingOutChild
  const known = isKnownCollector(collectedBy, h)
  const showIdCheckbox = gated && collectedBy.trim() !== '' && !known
  const attemptsLeft = Math.max(0, 5 - h.checkin.codeAttempts)
  const locked = h.checkin.locked
  // fix round 1 addendum, finding 10: the button's own required-collectedBy
  // check, mirrored here so it's disabled before the server ever sees it.
  const overrideDisabled = !collectedBy.trim() || !overrideReason || (overrideReason === 'other' && overrideText.trim().length < 5)

  function reset() {
    setCode('')
    setCollectedBy('')
    setIdChecked(false)
  }

  function pickChip(name: string) {
    setCollectedBy(name)
    setIdChecked(false)
    setErr(null)
  }

  async function doCheckout() {
    setErr(null)
    setBusy(true)
    const r = await post(h.recordId, {
      action: 'pickup',
      personIds: selectedOut,
      day,
      code: code.trim(),
      collectedBy: collectedBy.trim(),
      idChecked,
    })
    setBusy(false)
    if (r.error) setErr(r.error)
    else reset()
  }

  async function doOverride() {
    setErr(null)
    if (!overrideReason) return
    setBusy(true)
    const r = await post(h.recordId, {
      action: 'pickup-override',
      personIds: selectedOut,
      day,
      collectedBy: collectedBy.trim(),
      reason: overrideReason,
      reasonText: overrideText.trim(),
      idChecked,
    })
    setBusy(false)
    if (r.error) { setErr(r.error); return }
    setOverrideOpen(false)
    setOverrideReason('')
    setOverrideText('')
    reset()
  }

  function openEditList() {
    // Seed from the LIVE door-side list (`checkin.confirmedPickup`), not the
    // static waiver-level `authorizedPickup` — fix round 1, Critical 2. Those
    // two can diverge (this is exactly what "Edit list" is for), and seeding
    // from the wrong one meant a name removed at the door came back the next
    // time the editor was opened, and Save would silently re-authorize it.
    setEditRows(h.checkin.confirmedPickup.map((p) => ({ name: p.name, phone: p.phone })))
    setEditingList(true)
  }

  async function saveEditList() {
    setErr(null)
    setBusy(true)
    const confirmedPickup = editRows.map((r) => ({ name: r.name.trim(), phone: r.phone.trim() })).filter((r) => r.name)
    const r = await post(h.recordId, { action: 'set-pickup', day, confirmedPickup })
    setBusy(false)
    if (r.error) { setErr(r.error); return }
    setEditingList(false)
  }

  async function doResend(reason: string) {
    setResendChoosing(false)
    setResendOtherText('')
    setResendToast(null)
    setErr(null)
    setBusy(true)
    const r = await post(h.recordId, { action: 'reissue-code', day, reason })
    setBusy(false)
    if (r.error) { setErr(r.error); return }
    onCodeIssued(r.oneTimeCode ?? null, !!r.smsFailed)
    setResendToast(r.smsFailed ? 'Text didn’t send — tell the parent the code.' : `New code texted to ${h.phone}`)
  }

  return (
    <div style={{ marginTop: '0.8rem', borderTop: '1px solid rgba(var(--color-primary-rgb),0.12)', paddingTop: '0.7rem' }}>
      {/* Pickup code — shown ONCE, right after it's issued or resent */}
      {dropOff && revealCode && (
        <div style={{ marginBottom: '0.7rem', background: 'rgba(var(--color-primary-rgb),0.1)', border: '1px solid rgba(var(--color-primary-rgb),0.4)', borderRadius: '0.6rem', padding: '0.7rem 0.8rem', textAlign: 'center' }}>
          <span style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-primary)', fontWeight: 700 }}>Pickup code — give to parent now</span>
          <div style={{ fontSize: '2rem', fontWeight: 800, letterSpacing: '0.25em', color: 'var(--color-dark)', margin: '0.1rem 0' }}>{revealCode}</div>
          <p style={{ fontSize: '0.7rem', color: smsFailed ? '#b91c1c' : 'var(--color-muted)', fontWeight: smsFailed ? 700 : 400, margin: '0 0 0.5rem' }}>
            {smsFailed ? 'Text didn’t send — tell the parent the code.' : 'Texted to the parent — won’t be shown again.'}
          </p>
          <button type="button" onClick={() => onCodeIssued(null, false)} style={btn(true)}>Parent has it — hide</button>
        </div>
      )}

      {/* Drop-off: chips + ID checkbox + code entry */}
      {gated && (
        <div style={{ marginBottom: '0.7rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.5rem' }}>
            <p style={{ margin: '0 0 0.4rem', fontSize: '0.8125rem', fontWeight: 700, color: 'var(--color-dark)' }}>Who’s collecting?</p>
            {!editingList && (
              <button type="button" onClick={openEditList} style={{ ...btn(), padding: '0.15rem 0.5rem', fontSize: '0.72rem', color: 'var(--color-muted)', borderColor: 'transparent' }}>
                Edit list
              </button>
            )}
          </div>

          {editingList ? (
            <div style={{ marginBottom: '0.6rem' }}>
              {editRows.map((row, i) => (
                <div key={i} style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.4rem', flexWrap: 'wrap' }}>
                  <input
                    value={row.name}
                    onChange={(e) => setEditRows((rows) => rows.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))}
                    placeholder="Name"
                    style={{ ...field, flex: '1 1 8rem' }}
                  />
                  <input
                    value={row.phone}
                    onChange={(e) => setEditRows((rows) => rows.map((r, j) => (j === i ? { ...r, phone: e.target.value } : r)))}
                    placeholder="Phone (optional)"
                    style={{ ...field, flex: '1 1 8rem' }}
                  />
                  <button type="button" onClick={() => setEditRows((rows) => rows.filter((_, j) => j !== i))} style={{ ...btn(), color: '#b91c1c', borderColor: 'transparent' }}>✕</button>
                </div>
              ))}
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button type="button" onClick={() => setEditRows((rows) => [...rows, { name: '', phone: '' }])} style={{ ...btn(), fontSize: '0.78125rem' }}>+ Add</button>
                <button type="button" disabled={busy} onClick={saveEditList} style={{ ...btn(true), fontSize: '0.78125rem' }}>Save</button>
                <button type="button" onClick={() => setEditingList(false)} style={{ ...btn(), fontSize: '0.78125rem' }}>Cancel</button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
              {h.checkin.confirmedPickup.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => pickChip(p.name)}
                  style={{ ...btn(collectedBy.trim().toLowerCase() === p.name.trim().toLowerCase()), padding: '0.35rem 0.75rem', fontSize: '0.8125rem' }}
                >
                  {p.name}
                </button>
              ))}
              <button
                type="button"
                onClick={() => pickChip(h.signer)}
                style={{ ...btn(collectedBy.trim().toLowerCase() === h.signer.trim().toLowerCase()), padding: '0.35rem 0.75rem', fontSize: '0.8125rem' }}
              >
                {h.signer} (parent)
              </button>
            </div>
          )}
          {!editingList && (
            <>
              <input
                value={collectedBy}
                onChange={(e) => setCollectedBy(e.target.value)}
                placeholder="Someone else…"
                style={{ ...field, width: '100%', boxSizing: 'border-box' }}
              />
              {showIdCheckbox && (
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem', fontSize: '0.8125rem', color: 'var(--color-dark)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={idChecked} onChange={(e) => setIdChecked(e.target.checked)} style={{ width: '1.1rem', height: '1.1rem', accentColor: 'var(--color-primary)' }} />
                  Not on the list — I checked their photo ID
                </label>
              )}

              <div style={{ marginTop: '0.6rem' }}>
                {locked ? (
                  <p style={{ margin: 0, fontSize: '0.8125rem', color: '#b91c1c', fontWeight: 700 }}>Locked after 5 wrong codes — use Override.</p>
                ) : (
                  <>
                    <input
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      placeholder="Pickup code"
                      inputMode="numeric"
                      disabled={locked}
                      style={{ ...field, width: '6.5rem' }}
                    />
                    {h.checkin.codeAttempts > 0 && (
                      <span style={{ marginLeft: '0.5rem', fontSize: '0.78125rem', color: '#b91c1c', fontWeight: 600 }}>
                        Doesn’t match · {attemptsLeft} tries left
                      </span>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Non-drop-off (or adults-only): plain, optional collected-by note */}
      {!gated && (
        <div style={{ marginBottom: '0.6rem' }}>
          <input
            value={collectedBy}
            onChange={(e) => setCollectedBy(e.target.value)}
            placeholder="Collected by (optional)"
            style={{ ...field, width: '100%', boxSizing: 'border-box' }}
          />
        </div>
      )}

      {err && <p style={{ color: '#b91c1c', fontSize: '0.8125rem', margin: '0 0 0.5rem', fontWeight: 600 }}>{err}</p>}
      {resendToast && <p style={{ color: 'var(--color-muted)', fontSize: '0.8125rem', margin: '0 0 0.5rem', fontWeight: 600 }}>{resendToast}</p>}

      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          disabled={selectedOut.length === 0 || busy || (gated && locked)}
          onClick={doCheckout}
          style={{ ...btn(true), opacity: selectedOut.length === 0 || busy || (gated && locked) ? 0.5 : 1 }}
        >
          Check out ({selectedOut.length})
        </button>

        {gated && (
          <button type="button" onClick={() => setOverrideOpen(true)} style={{ ...btn(), color: 'var(--color-muted)', borderColor: 'transparent', fontSize: '0.78125rem' }}>
            Override…
          </button>
        )}

        {dropOff && (
          resendChoosing ? (
            <span style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="button" disabled={busy} onClick={() => doResend('Parent didn’t get the text')} style={{ ...btn(), fontSize: '0.78125rem' }}>Parent didn’t get the text</button>
              <input
                value={resendOtherText}
                onChange={(e) => setResendOtherText(e.target.value)}
                placeholder="Other reason…"
                style={{ ...field, width: '9rem', fontSize: '0.78125rem' }}
              />
              <button
                type="button"
                disabled={busy || !resendOtherText.trim()}
                onClick={() => doResend(resendOtherText.trim())}
                style={{ ...btn(), fontSize: '0.78125rem', opacity: !resendOtherText.trim() ? 0.5 : 1 }}
              >
                Send
              </button>
              <button type="button" onClick={() => setResendChoosing(false)} style={{ ...btn(), fontSize: '0.78125rem' }}>Cancel</button>
            </span>
          ) : (
            <button type="button" onClick={() => setResendChoosing(true)} style={{ ...btn(), fontSize: '0.78125rem' }}>
              {h.checkin.hasPickupCode ? 'Re-send code' : 'Issue pickup code'}
            </button>
          )
        )}
      </div>

      {/* Override sheet — in-app, never window.confirm */}
      {overrideOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Release without code"
          onClick={(e) => { if (e.target === e.currentTarget) setOverrideOpen(false) }}
          style={{ position: 'fixed', inset: 0, zIndex: 130, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(2px)', padding: '1rem' }}
        >
          <div style={{ width: '100%', maxWidth: '24rem', maxHeight: '90vh', overflowY: 'auto', padding: '1.25rem', borderRadius: '1rem', background: 'rgba(255,255,255,0.98)', border: '1px solid rgba(255,255,255,0.6)', boxShadow: '0 24px 60px rgba(0,0,0,0.25)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
              <h4 style={{ margin: 0, fontFamily: 'var(--font-heading)', fontWeight: 700, color: 'var(--color-dark)' }}>Why?</h4>
              <button type="button" onClick={() => setOverrideOpen(false)} aria-label="Close" style={{ ...btn(), padding: '0.3rem 0.55rem' }}>✕</button>
            </div>

            {/* Who's collecting — prefilled from the panel's chip/text, but
                editable here too (fix round 1 addendum, finding 10): opening
                Override before ever picking a chip left this blank with no
                way to fill it in, so "Release without code" always 400'd. */}
            <div style={{ marginTop: '0.8rem' }}>
              <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-dark)', marginBottom: '0.3rem' }}>Who’s collecting?</label>
              <input
                value={collectedBy}
                onChange={(e) => setCollectedBy(e.target.value)}
                placeholder="Name"
                style={{ ...field, width: '100%', boxSizing: 'border-box' }}
              />
            </div>

            <div style={{ marginTop: '0.8rem', display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
              {OVERRIDE_REASONS.map((r) => (
                <label key={r.value} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: '0.875rem', color: 'var(--color-dark)', cursor: 'pointer' }}>
                  <input type="radio" name="override-reason" checked={overrideReason === r.value} onChange={() => setOverrideReason(r.value)} style={{ marginTop: '0.2rem' }} />
                  {r.label(h.phone)}
                </label>
              ))}
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: '0.875rem', color: 'var(--color-dark)', cursor: 'pointer' }}>
                <input type="radio" name="override-reason" checked={overrideReason === 'other'} onChange={() => setOverrideReason('other')} style={{ marginTop: '0.2rem' }} />
                <span style={{ flex: 1 }}>
                  Other:{' '}
                  <input
                    value={overrideText}
                    onChange={(e) => { setOverrideText(e.target.value); setOverrideReason('other') }}
                    placeholder="say why"
                    style={{ ...field, width: '100%', boxSizing: 'border-box', marginTop: '0.3rem' }}
                  />
                </span>
              </label>
            </div>

            <a href={`tel:${h.phone}`} style={{ display: 'block', marginTop: '0.8rem', fontSize: '0.875rem', color: 'var(--color-primary)', textDecoration: 'none', fontWeight: 600 }}>
              📞 Call {h.signer} — {h.phone}
            </a>

            {err && <p style={{ color: '#b91c1c', fontSize: '0.8125rem', marginTop: '0.7rem', fontWeight: 600 }}>{err}</p>}

            <button
              type="button"
              disabled={busy || overrideDisabled}
              onClick={doOverride}
              style={{
                width: '100%',
                marginTop: '1rem',
                padding: '0.7rem',
                borderRadius: '0.625rem',
                border: 'none',
                background: '#b91c1c',
                color: '#fff',
                fontSize: '0.875rem',
                fontWeight: 700,
                cursor: 'pointer',
                opacity: overrideDisabled ? 0.5 : 1,
              }}
            >
              Release without code
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
