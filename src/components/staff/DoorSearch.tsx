import { useEffect, useState } from 'react'
import QrModal from '@components/staff/QrModal'
import { card, btn, field, Badge } from '@components/staff/ui'
import { formatMonthDay, formatMonthDayYear, formatMonthYear } from '@lib/studio-time'

const STORAGE_KEY = 'hg_lastDoorQuery'
const DEBOUNCE_MS = 250

interface Kid {
  name: string
  allergies: string
}

interface HouseholdMatch {
  recordId: string
  firstName: string
  lastName: string
  signedAt: string
  agreementVersion: string
  validUntil: string
  covered: boolean
  kids: Kid[]
  adultAllergies: string
  photoConsent: boolean
  openStudioToday: boolean
}

const firstOf = (name: string) => name.trim().split(/\s+/)[0]
const personIdsFor = (h: HouseholdMatch) => ['adult', ...h.kids.map((_, i) => `child:${i}`)]

function signOnIpad() {
  location.assign('/waiver?kiosk=1&return=/staff')
}

/** One household's result — GOOD TO GO / EXPIRED, with the exact wording
 *  from HOM-208 §3. Words, not colors — a first-shift crew member reads the
 *  headline and knows the answer without interpreting anything. */
function ResultCard({ h, onCheckedIn, onShowQr }: { h: HouseholdMatch; onCheckedIn: () => void; onShowQr: () => void }) {
  const [sel, setSel] = useState<Record<string, boolean>>(() => Object.fromEntries(personIdsFor(h).map((id) => [id, true])))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [justCheckedIn, setJustCheckedIn] = useState(false)

  // Reset the selector when the displayed household changes.
  useEffect(() => {
    setSel(Object.fromEntries(personIdsFor(h).map((id) => [id, true])))
    setError(null)
    setJustCheckedIn(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [h.recordId])

  async function checkIn() {
    const ids = personIdsFor(h).filter((id) => sel[id] !== false)
    if (ids.length === 0) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/staff/open-studio.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordId: h.recordId, personIds: ids }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) { setError(json?.error ?? 'Something went wrong.'); return }
      setJustCheckedIn(true)
      onCheckedIn()
    } catch {
      setError('Couldn’t save — check wifi and try again.')
    } finally {
      setBusy(false)
    }
  }

  const allergyChips = [
    ...h.kids.filter((k) => k.allergies).map((k) => <Badge key={k.name} tone="alert" wrap>⚠ {firstOf(k.name)}: {k.allergies}</Badge>),
    ...(h.adultAllergies ? [<Badge key="adult" tone="alert" wrap>⚠ {h.firstName}: {h.adultAllergies}</Badge>] : []),
    ...(!h.photoConsent ? [<Badge key="photo" tone="muted">🚫 No photos</Badge>] : []),
  ]

  if (h.covered) {
    const checkedIn = h.openStudioToday || justCheckedIn
    return (
      <div style={{ ...card, background: 'rgba(34,197,94,0.05)', borderLeft: '5px solid rgb(34,197,94)' }}>
        <h3 style={{ margin: 0, fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: '1.0625rem', color: 'var(--color-dark)' }}>
          GOOD TO GO — {h.firstName} {h.lastName}
        </h3>
        <p style={{ margin: '0.35rem 0 0', fontSize: '0.8125rem', color: 'var(--color-muted)' }}>
          Signed {formatMonthDay(h.signedAt)} · {h.agreementVersion} · valid through {formatMonthYear(h.validUntil)}
        </p>
        {h.kids.length > 0 && (
          <p style={{ margin: '0.3rem 0 0', fontSize: '0.875rem', color: 'var(--color-dark)' }}>
            Kids on file: {h.kids.map((k) => firstOf(k.name)).join(', ')}
          </p>
        )}
        {allergyChips.length > 0 && (
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.6rem' }}>{allergyChips}</div>
        )}

        <div style={{ marginTop: '0.9rem', borderTop: '1px solid rgba(150,112,91,0.12)', paddingTop: '0.8rem' }}>
          {checkedIn && (
            <p style={{ margin: '0 0 0.5rem', fontSize: '0.8125rem', color: 'rgb(21,128,61)', fontWeight: 700 }}>✓ Checked in to Open Studio today</p>
          )}
          {personIdsFor(h).map((id, i) => {
            const label = id === 'adult' ? `${h.firstName} (adult)` : firstOf(h.kids[i - 1].name)
            return (
              <label key={id} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.4rem 0', cursor: 'pointer', fontSize: '0.9375rem', color: 'var(--color-dark)' }}>
                <input
                  type="checkbox"
                  checked={sel[id] !== false}
                  onChange={(e) => setSel((s) => ({ ...s, [id]: e.target.checked }))}
                  style={{ width: '1.4rem', height: '1.4rem', flex: '0 0 auto', cursor: 'pointer', accentColor: 'var(--color-primary)' }}
                />
                {label}
              </label>
            )
          })}
          {error && <p style={{ color: '#b91c1c', fontSize: '0.8125rem', margin: '0.4rem 0 0', fontWeight: 600 }}>{error}</p>}
          <button
            type="button"
            disabled={busy || personIdsFor(h).every((id) => sel[id] === false)}
            onClick={checkIn}
            style={{ ...btn(true), width: '100%', padding: '0.75rem', marginTop: '0.6rem', minHeight: '2.75rem', opacity: busy ? 0.7 : 1 }}
          >
            {checkedIn ? 'Check in again' : 'Check in to Open Studio'}
          </button>
        </div>
      </div>
    )
  }

  // EXPIRED
  return (
    <div style={{ ...card, background: 'rgba(217,119,6,0.05)', borderLeft: '5px solid rgb(217,119,6)' }}>
      <h3 style={{ margin: 0, fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: '1.0625rem', color: 'var(--color-dark)' }}>
        EXPIRED — {h.firstName} {h.lastName}
      </h3>
      <p style={{ margin: '0.35rem 0 0', fontSize: '0.8125rem', color: 'var(--color-muted)' }}>
        Signed {formatMonthDayYear(h.signedAt)} · expired {formatMonthDayYear(h.validUntil)}
      </p>
      <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.8rem', flexWrap: 'wrap' }}>
        <button type="button" onClick={onShowQr} style={{ ...btn(), minHeight: '2.75rem', flex: '1 1 8rem' }}>Show QR</button>
        <button type="button" onClick={signOnIpad} style={{ ...btn(true), minHeight: '2.75rem', flex: '1 1 8rem' }}>Sign on this iPad</button>
      </div>
    </div>
  )
}

/**
 * The walk-in door check (HOM-208 §2–5): one input, debounced search against
 * `/api/staff/coverage.json?q=`, three result states in words not colors.
 */
export default function DoorSearch({ onCheckedIn }: { onCheckedIn: () => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<HouseholdMatch[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [qrOpen, setQrOpen] = useState(false)

  // Restore the last query on mount (e.g. returning from the kiosk after
  // "Sign on this iPad") so staff immediately see GOOD TO GO.
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY)
      if (saved) setQuery(saved)
    } catch {
      // sessionStorage unavailable — just start blank.
    }
  }, [])

  useEffect(() => {
    const q = query.trim()
    if (!q) { setResults(null); setError(null); setSelectedId(null); return }
    setLoading(true)
    const t = setTimeout(async () => {
      try { sessionStorage.setItem(STORAGE_KEY, q) } catch { /* ignore */ }
      try {
        const res = await fetch(`/api/staff/coverage.json?q=${encodeURIComponent(q)}`, { cache: 'no-store' })
        const json = await res.json().catch(() => null)
        if (!res.ok) { setError(json?.error ?? 'Couldn’t reach storage — check wifi and try again.'); setResults([]); return }
        setError(null)
        setResults(json.data.households)
      } catch {
        setError('Couldn’t reach storage — check wifi and try again.')
        setResults([])
      } finally {
        setLoading(false)
      }
    }, DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [query])

  // Auto-select the only match; clear selection when the result set changes.
  useEffect(() => {
    setSelectedId(results && results.length === 1 ? results[0].recordId : null)
  }, [results])

  const selected = results?.find((h) => h.recordId === selectedId) ?? null

  return (
    <div style={{ marginBottom: '1.2rem' }}>
      <input
        type="search"
        inputMode="search"
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Phone, email or last name"
        style={{ ...field, width: '100%', boxSizing: 'border-box', padding: '0.85rem 1rem', fontSize: '1rem', minHeight: '2.75rem' }}
      />

      {loading && results === null && (
        <p style={{ color: 'var(--color-muted)', fontSize: '0.8125rem', marginTop: '0.6rem' }}>Searching…</p>
      )}

      {error && results !== null && (
        <p style={{ color: '#b91c1c', fontSize: '0.875rem', fontWeight: 600, marginTop: '0.7rem' }}>{error}</p>
      )}

      {!error && results && !selected && (
        results.length === 0 ? (
          <div style={{ ...card, background: 'rgba(255,255,255,0.85)', marginTop: '0.8rem' }}>
            <h3 style={{ margin: 0, fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: '1.0625rem', color: 'var(--color-dark)' }}>
              NOT ON FILE for “{query.trim()}”
            </h3>
            <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.8rem', flexWrap: 'wrap' }}>
              <button type="button" onClick={() => setQrOpen(true)} style={{ ...btn(), minHeight: '2.75rem', flex: '1 1 8rem' }}>Show QR</button>
              <button type="button" onClick={signOnIpad} style={{ ...btn(true), minHeight: '2.75rem', flex: '1 1 8rem' }}>Sign on this iPad</button>
            </div>
            <p style={{ margin: '0.7rem 0 0', fontSize: '0.78125rem', color: 'var(--color-muted)' }}>
              Under 19? A parent signs from their phone — the QR works for that too.
            </p>
          </div>
        ) : (
          <div style={{ marginTop: '0.8rem' }}>
            <p style={{ fontSize: '0.8125rem', color: 'var(--color-muted)', margin: '0 0 0.5rem' }}>{results.length} matches — pick one:</p>
            {results.map((h) => (
              <button
                key={h.recordId}
                type="button"
                onClick={() => setSelectedId(h.recordId)}
                style={{ ...card, background: 'rgba(255,255,255,0.85)', width: '100%', textAlign: 'left', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', minHeight: '2.75rem' }}
              >
                <span style={{ fontWeight: 600, color: 'var(--color-dark)' }}>{h.firstName} {h.lastName}</span>
                <span style={{ fontSize: '0.75rem', color: h.covered ? 'rgb(21,128,61)' : 'rgb(180,120,20)', fontWeight: 700 }}>
                  {h.covered ? 'good to go' : 'expired'}
                </span>
              </button>
            ))}
          </div>
        )
      )}

      {selected && (
        <div style={{ marginTop: '0.8rem' }}>
          {results && results.length > 1 && (
            <button type="button" onClick={() => setSelectedId(null)} style={{ ...btn(), marginBottom: '0.6rem' }}>← Back to matches</button>
          )}
          <ResultCard h={selected} onCheckedIn={onCheckedIn} onShowQr={() => setQrOpen(true)} />
        </div>
      )}

      {qrOpen && <QrModal onClose={() => setQrOpen(false)} />}
    </div>
  )
}
