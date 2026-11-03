/**
 * Home › Warnings (final review C1): everything on the schedule that needs an
 * owner, the same scan as /staff › Warnings and the morning email, so nothing
 * depends on the email arriving. Each line has its button: the screen that
 * fixes it, or Open for the class or party it's about. To decide items and
 * staffing lines are left out: Home shows them already (the To decide count
 * and Home › Staffing).
 */
import { useEffect, useState } from 'react'
import type { HomeWarning } from '@pages/api/admin/warnings.json'
import { api } from './classes/api'
import { Failed } from './shell/items'
import type { Sheet } from './shell/router'
import type { InboxSegment } from './inbox/Inbox'

export const WARNINGS = '/api/admin/warnings.json'

/** Lines shown before "See all". */
const SHOW = 5

export function HomeWarnings({ onOpen, onInbox }: { onOpen: (s: Sheet) => void; onInbox: (s: InboxSegment) => void }) {
  const [list, setList] = useState<HomeWarning[] | null>(null)
  const [error, setError] = useState('')
  const [tries, setTries] = useState(0)
  const [all, setAll] = useState(false)
  useEffect(() => {
    let live = true
    setError('')
    api<{ warnings: HomeWarning[] }>(WARNINGS).then((r) => {
      if (!live) return
      if (r.ok && r.data) setList(r.data.warnings)
      else setError(r.error ?? 'Couldn’t check the schedule for warnings.')
    })
    return () => { live = false }
  }, [tries])
  const retry = () => setTries((n) => n + 1)
  if (error) return <div><p className="adm-lbl">Warnings</p><Failed message={error} onRetry={retry} /></div>
  if (!list || list.length === 0) return null
  const shown = all ? list : list.slice(0, SHOW)
  function go(w: HomeWarning) {
    const o = w.open
    if (!o) return
    if (o.kind === 'retry') return retry()
    if (o.kind === 'todo-list') return onInbox('todo')
    onOpen(o as Sheet)
  }
  return (
    <div>
      <p className="adm-lbl">{`Warnings (${list.length})`}</p>
      <ul className="adm-plain adm-stafflines" aria-label="Warnings">
        {shown.map((w, i) => (
          <li key={`${w.code}-${i}`} className="adm-staffline is-warn">
            <p>{w.line}</p>
            {w.open && w.button && <button type="button" className="adm-btn is-ghost is-sm" onClick={() => go(w)}>{w.button}</button>}
          </li>
        ))}
      </ul>
      {list.length > SHOW && <button type="button" className="adm-quiet" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `See all ${list.length}`}</button>}
    </div>
  )
}
