import { useEffect, useState, type CSSProperties } from 'react'
import { btn } from '@components/staff/ui'
import type { EventKind } from '@lib/events'

interface PanelWarning {
  code: string
  eventKind: 'workshop' | 'party'
  eventId: string
  when: string
  title: string
  line: string
}

const box: CSSProperties = {
  border: '2px solid #b91c1c',
  background: 'rgba(185,28,28,0.07)',
  borderRadius: '0.8rem',
  padding: '0.8rem 1rem',
  marginBottom: '1rem',
}

/**
 * "Needs attention" (spec G): red, at the top of Today, fetched on every load.
 * Nothing is dismissible and nothing here fixes anything: each line says what
 * a person does, in Square. A scan that couldn't run says so, in red, rather
 * than showing nothing (which would read as all clear).
 */
export default function WarningsPanel({ onOpenEvent }: { onOpenEvent: (e: { kind: EventKind; id: string; title: string }) => void }) {
  const [warnings, setWarnings] = useState<PanelWarning[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(false)

  // `failed` is only cleared once an answer arrives, so a retry in flight keeps
  // the red box up instead of flashing to nothing (which reads as all clear).
  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/staff/warnings.json', { cache: 'no-store' })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.data) {
        setFailed(true)
        return
      }
      setWarnings(Array.isArray(json.data.warnings) ? json.data.warnings : [])
      setFailed(false)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  if (failed) {
    return (
      <div role="alert" style={box}>
        <p style={{ margin: 0, fontWeight: 700, color: '#b91c1c' }}>⚠ Couldn’t check the schedule for conflicts.</p>
        <button type="button" onClick={load} disabled={loading} style={{ ...btn(), minHeight: 44, marginTop: '0.5rem' }}>
          {loading ? 'Checking…' : 'Try again'}
        </button>
      </div>
    )
  }
  if (!warnings || warnings.length === 0) return null

  return (
    <section role="alert" aria-label="Needs attention" style={box}>
      <p style={{ margin: '0 0 0.4rem', fontWeight: 700, color: '#b91c1c' }}>⚠ Needs attention ({warnings.length})</p>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
        {warnings.map((w, i) => (
          <li
            key={`${w.code}:${w.eventId}:${w.when}:${i}`}
            style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.35rem 0', borderTop: i === 0 ? 'none' : '1px solid rgba(185,28,28,0.15)' }}
          >
            <span style={{ flex: 1, fontSize: '0.875rem', color: 'var(--color-dark)' }}>{w.line}</span>
            <button
              type="button"
              onClick={() => onOpenEvent({ kind: w.eventKind, id: w.eventId, title: w.title })}
              style={{ ...btn(), minHeight: 44, minWidth: 44 }}
            >
              Open
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
