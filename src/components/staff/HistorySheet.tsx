import { useEffect, useState } from 'react'
import { btn } from '@components/staff/ui'
import { formatWhen } from '@lib/studio-time'
import type { Household } from '@components/staff/HouseholdCard'
import type { EventKind } from '@lib/events'
import type { CheckinEvent } from '@lib/checkin-store'

const ACTION_LABEL: Record<CheckinEvent['action'], string> = {
  checkin: 'Checked in',
  'undo-checkin': 'Check-in undone',
  pickup: 'Picked up',
  'pickup-denied': 'Pickup denied',
  'undo-pickup': 'Pickup undone',
  'reissue-code': 'Pickup code reissued',
  'set-pickup': 'Pickup list updated',
  'code-sent': 'Pickup code sent',
  'pickup-override': 'Pickup override',
  locked: 'Locked (5 wrong codes)',
  unlocked: 'Unlocked',
  incident: 'Incident logged',
}

/** Person id → display name, using the same `adult`/`child:N` scheme
 *  `HouseholdCard` builds — falls back to the bare id if it can't resolve
 *  (e.g. a household that's since dropped a child). */
function personName(h: Household, personId: string): string {
  if (personId === 'adult') return h.signer
  const m = personId.match(/^child:(\d+)$/)
  if (m) return h.children[Number(m[1])]?.name ?? personId
  return personId
}

/**
 * Read-only custody-log sheet for one household (HOM-217) — every
 * `CheckinEvent` ever recorded for them, newest first, including `by` and
 * override/denial reasons. Backed by `GET /api/staff/history.json`, the
 * only endpoint that returns raw events (`toPublicCheckin` strips them
 * everywhere else). Opened from a "History" button on `HouseholdCard`.
 */
export default function HistorySheet({
  h,
  kind,
  id,
  onClose,
}: {
  h: Household
  kind: EventKind
  id: string
  onClose: () => void
}) {
  const [events, setEvents] = useState<CheckinEvent[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setEvents(null)
    setError(null)
    fetch(`/api/staff/history.json?kind=${kind}&id=${encodeURIComponent(id)}&recordId=${encodeURIComponent(h.recordId)}`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((json) => { if (!cancelled) setEvents(json.data?.events ?? []) })
      .catch(() => { if (!cancelled) setError('Couldn’t load history — check wifi and try again.') })
    return () => { cancelled = true }
  }, [kind, id, h.recordId])

  const sorted = events ? [...events].sort((a, b) => b.at.localeCompare(a.at)) : []

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`History — ${h.signer}`}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, zIndex: 130, display: 'flex', justifyContent: 'flex-end', background: 'rgba(0, 0, 0, 0.4)' }}
    >
      <div
        style={{
          width: '100%', maxWidth: '30rem', height: '100vh', overflowY: 'auto',
          padding: '1.25rem 1.25rem 2rem', boxSizing: 'border-box',
          background: 'linear-gradient(180deg, rgba(255,255,255,0.99) 0%, rgba(255,255,255,0.96) 100%)',
          boxShadow: '-12px 0 40px rgba(0,0,0,0.25)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
          <h3 style={{ margin: 0, fontFamily: 'var(--font-heading)', fontWeight: 700, color: 'var(--color-dark)' }}>🕘 History — {h.signer}</h3>
          <button type="button" onClick={onClose} aria-label="Close" style={{ ...btn(), padding: '0.35rem 0.6rem' }}>✕</button>
        </div>
        <p style={{ margin: '0.3rem 0 0', fontSize: '0.78125rem', color: 'var(--color-muted)' }}>Read-only — every custody action recorded for this household, newest first.</p>

        {error && <p style={{ color: '#b91c1c', fontSize: '0.8125rem', marginTop: '1rem', fontWeight: 600 }}>{error}</p>}
        {!error && events === null && <p style={{ color: 'var(--color-muted)', fontSize: '0.875rem', marginTop: '1rem' }}>Loading…</p>}
        {!error && events !== null && events.length === 0 && (
          <p style={{ color: 'var(--color-muted)', fontSize: '0.875rem', marginTop: '1rem' }}>No custody events recorded yet.</p>
        )}

        <div style={{ marginTop: '0.7rem' }}>
          {sorted.map((e, i) => (
            <div key={i} style={{ borderTop: i === 0 ? 'none' : '1px solid rgba(150,112,91,0.12)', padding: '0.65rem 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700, color: 'var(--color-dark)', fontSize: '0.875rem' }}>{ACTION_LABEL[e.action] ?? e.action}</span>
                <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)', whiteSpace: 'nowrap' }}>{formatWhen(e.at)}</span>
              </div>
              {e.personIds.length > 0 && (
                <p style={{ margin: '0.25rem 0 0', fontSize: '0.8125rem', color: 'var(--color-dark)' }}>
                  {e.personIds.map((pid) => personName(h, pid)).join(', ')}
                </p>
              )}
              {(e.by?.name || e.collectedBy || e.reason) && (
                <p style={{ margin: '0.2rem 0 0', fontSize: '0.78125rem', color: 'var(--color-muted)' }}>
                  {e.by?.name ? `by ${e.by.name}` : 'by (unrecorded)'}
                  {e.collectedBy ? ` · collected by ${e.collectedBy}` : ''}
                  {e.reason ? ` · reason: ${e.reason}` : ''}
                </p>
              )}
              {e.note && <p style={{ margin: '0.2rem 0 0', fontSize: '0.78125rem', color: 'var(--color-muted)', fontStyle: 'italic' }}>{e.note}</p>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
