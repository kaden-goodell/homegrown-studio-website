/**
 * Home › Staffing (stage 3 Task 10): the same lines the owners' daily email
 * has, each with its button, so nobody needs the email to act.
 *   - nobody (or too few) on → Open (the class or party, on Staff)
 *   - on at a time they marked Can't → Call / Text, Open
 *   - still on something cancelled or gone → Call / Text, Take off
 *   - staffing couldn't be checked → Try again
 */
import { useState } from 'react'
import { useRefresh } from '../shell/data'
import { Failed } from '../shell/items'
import type { Sheet } from '../shell/router'
import { DIDNT_SAVE, useToast } from '../shell/Toast'
import { warningLineText } from './lines'
import { postAssign, sheetOfHref, useStaffLines, type StaffLine } from './api'
import { ContactRow } from './StaffRow'

/** Lines shown on Home before "See them all". */
const SHOW = 5

export function HomeStaffing({ onOpen }: { onOpen: (s: Sheet, data?: unknown) => void }) {
  const { lines, contacts, error, retry } = useStaffLines()
  const [all, setAll] = useState(false)
  if (error) return <div><p className="adm-lbl">Staffing</p><Failed message={error} onRetry={retry} /></div>
  if (!lines) return null
  const unreadable = lines.find((l) => l.code === 'staffing-unreadable')
  if (unreadable) return <div><p className="adm-lbl">Staffing</p><Failed message="Couldn’t check staffing." onRetry={retry} /></div>
  // Can't and cancelled first: someone has to be told.
  const order = (l: StaffLine) => (l.code === 'assigned-cancelled' ? 0 : l.code === 'assigned-cant' ? 1 : 2)
  const sorted = [...lines].sort((a, b) => order(a) - order(b) || a.when.localeCompare(b.when))
  if (sorted.length === 0) return null
  const shown = all ? sorted : sorted.slice(0, SHOW)
  return (
    <div>
      <p className="adm-lbl">{`Staffing (${sorted.length})`}</p>
      <ul className="adm-plain adm-stafflines" aria-label="Staffing">
        {shown.map((l, i) => <LineRow key={`${l.code}-${l.staff?.key ?? i}-${l.staff?.people[0]?.staffId ?? ''}`} line={l} contacts={contacts} onOpen={onOpen} />)}
      </ul>
      {sorted.length > SHOW && (
        <button type="button" className="adm-quiet" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `See all ${sorted.length}`}</button>
      )}
      <button type="button" className="adm-quiet" onClick={() => onOpen({ kind: 'more', page: 'staff' })}>Open Staff</button>
    </div>
  )
}

function LineRow({ line, contacts, onOpen }: { line: StaffLine; contacts: Record<string, { phone: string | null; left?: boolean }>; onOpen: (s: Sheet, data?: unknown) => void }) {
  const toast = useToast()
  const { bump } = useRefresh()
  const [busy, setBusy] = useState('')
  const target = sheetOfHref(line.staff?.openHref)
  const key = line.staff?.key
  async function takeOff(staffId: string, name: string) {
    if (!key || busy) return
    setBusy(staffId)
    const r = await postAssign({ action: 'unassign', staffId, tell: false, key })
    setBusy('')
    if (!r.ok) { toast(r.error ?? DIDNT_SAVE); return }
    toast(`${name} is off it.`)
    bump()
  }
  return (
    <li className={`adm-staffline${line.code === 'unstaffed' ? '' : ' is-warn'}`}>
      <p>{warningLineText(line)}</p>
      {(line.code === 'assigned-cant' || line.code === 'assigned-cancelled') && (line.staff?.people ?? []).map((p) => (
        <div key={p.staffId} className="adm-stack">
          <ContactRow name={p.name} phone={contacts[p.staffId]?.phone ?? null} left={contacts[p.staffId]?.left} />
          {line.code === 'assigned-cancelled' && (
            <button type="button" className="adm-btn is-ghost is-sm" disabled={!!busy} onClick={() => takeOff(p.staffId, p.name)}>{busy === p.staffId ? 'Saving…' : `Take ${p.name} off`}</button>
          )}
        </div>
      ))}
      {target && key && (
        <button type="button" className={`adm-btn ${line.code === 'unstaffed' ? 'is-pri' : 'is-ghost'} is-sm`} onClick={() => onOpen(target, { staffKey: key })}>
          {line.code === 'unstaffed' ? 'Put someone on' : 'Open'}
        </button>
      )}
    </li>
  )
}
