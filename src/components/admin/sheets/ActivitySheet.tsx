import { useEffect, useState } from 'react'
import { api, ACTIVITY } from '../classes/api'
import { Failed, Seg, Skeleton } from '../shell/items'
import { SheetFrame } from '../shell/Sheet'
import { ACTIVITY_AREAS, AREA_LABEL, type ActivityArea, type ActivityRow } from '@lib/activity'

interface ActivityReply {
  rows: ActivityRow[]
  people: { id: string; name: string; role: 'owner' | 'crew' }[]
  truncated: boolean
  days: number
}

const DAYS: ['1' | '7' | '30' | '90', string][] = [['1', 'Today'], ['7', '7 days'], ['30', '30 days'], ['90', '90 days']]

const when = (iso: string) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

/**
 * More › Activity (owners only, DV19): who did what on /staff and /admin,
 * newest first: refunds, comps and gift cards, check-ins, sign-ins, setup.
 * Filter by person, by area, and how far back. Read only.
 */
export function ActivitySheet() {
  const [days, setDays] = useState<'1' | '7' | '30' | '90'>('7')
  const [area, setArea] = useState<ActivityArea | ''>('')
  const [by, setBy] = useState('')
  const [r, setR] = useState<ActivityReply | null>(null)
  const [error, setError] = useState('')
  const [tries, setTries] = useState(0)
  useEffect(() => {
    let live = true
    setError('')
    setR(null)
    const qs = new URLSearchParams({ days, ...(area ? { area } : {}), ...(by ? { by } : {}) })
    api<ActivityReply>(`${ACTIVITY}?${qs}`).then((x) => {
      if (!live) return
      if (x.ok && x.data) setR(x.data)
      else setError(x.error ?? 'The activity log couldn’t be reached. Try again in a minute.')
    })
    return () => { live = false }
  }, [days, area, by, tries])
  return (
    <SheetFrame title="Activity" subtitle="Who did what, newest first" tall>
      <Seg label="How far back" value={days} options={DAYS} onChange={setDays} tight />
      <label className="adm-fld adm-gap-bottom" style={{ marginTop: 12 }}>
        <span>What</span>
        <select value={area} onChange={(e) => setArea(e.target.value as ActivityArea | '')}>
          <option value="">Everything</option>
          {ACTIVITY_AREAS.map((a) => <option key={a} value={a}>{AREA_LABEL[a]}</option>)}
        </select>
      </label>
      <label className="adm-fld adm-gap-bottom">
        <span>Who</span>
        <select value={by} onChange={(e) => setBy(e.target.value)}>
          <option value="">Everyone</option>
          {(r?.people ?? []).map((p) => <option key={p.id} value={p.id}>{p.role === 'owner' ? `${p.name} (owner)` : p.name}</option>)}
        </select>
      </label>
      {error ? <Failed message={error} onRetry={() => setTries((t) => t + 1)} />
        : !r ? <Skeleton rows={4} label="Loading the activity" />
        : !r.rows.length ? <p className="adm-note">Nothing in this period.</p>
        : (
          <>
            <ul className="adm-mlist" aria-label="Activity">
              {r.rows.map((row) => (
                <li key={row.id} className="adm-card" style={{ margin: '0 0 8px' }}>
                  <p style={{ margin: 0 }}><b>{row.who}</b>{row.role === 'crew' ? ' · crew' : ''} <small>{when(row.at)}</small></p>
                  <p style={{ margin: '2px 0 0', overflowWrap: 'anywhere' }}>{row.what}</p>
                </li>
              ))}
            </ul>
            {r.truncated && <p className="adm-note">Showing the newest {r.rows.length}. Pick a shorter time or one person to see the rest.</p>}
          </>
        )}
    </SheetFrame>
  )
}
