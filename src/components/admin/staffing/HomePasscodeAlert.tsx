/**
 * Home › a line about the staff passcode, only when it needs an owner (S1, S3):
 *   - lots of wrong staff passcodes were typed today (someone may be guessing)
 *   - the saved passcode can't be read, so nobody can sign in to /staff
 * Each comes with the button that fixes it (More › Staff › People › Staff
 * passcode, form open). Says nothing when all is well or it can't check.
 */
import { useEffect, useState } from 'react'
import { api } from '../classes/api'
import type { Sheet } from '../shell/router'
import { PASSCODE, PASSCODE_OPEN } from './api'

interface Status { damaged?: boolean; manyFailed?: boolean; readOnly?: boolean }

export function HomePasscodeAlert({ onOpen }: { onOpen: (s: Sheet, data?: unknown) => void }) {
  const [status, setStatus] = useState<Status | null>(null)
  useEffect(() => {
    let live = true
    api<Status>(PASSCODE).then((r) => { if (live && r.ok && r.data) setStatus(r.data) })
    return () => { live = false }
  }, [])
  if (!status || status.readOnly || (!status.damaged && !status.manyFailed)) return null
  const text = status.damaged
    ? 'The staff passcode can’t be read, so nobody can sign in to /staff. Set a new one in More › Staff › People.'
    : 'Lots of wrong staff passcodes today — change it in More › Staff › People'
  return (
    <div className="adm-panel is-warn adm-gap-top" role="group" aria-label="Staff passcode">
      <span>{text}</span>
      <button type="button" className="adm-btn is-pri is-sm" onClick={() => onOpen({ kind: 'more', page: 'staff' }, PASSCODE_OPEN)}>
        {status.damaged ? 'Set a new staff passcode' : 'Change the staff passcode'}
      </button>
    </div>
  )
}
