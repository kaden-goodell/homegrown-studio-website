import { useContext, useEffect, useState } from 'react'
import { closures } from '@config/closures'
import { api, SEED } from './classes/api'
import { today } from './classes/dates'
import type { MorePage, Sheet } from './shell/router'
import { WhoContext } from './sheets/MoreSheets'

const ROWS: [MorePage, string, string][] = [
  ['parties', 'Parties setup', 'Party times, the $300 package, guests, crafts'],
  ['hours', 'Hours & Craft Café', 'Saturday hours and special days'],
  ['closed', 'Closed days', ''],
  ['staff', 'Staff', 'Coming in stage 3'],
  ['promos', 'Promotions', 'Coming in stage 4'],
  ['reports', 'Reports', 'This month: seats sold, sales, refunds'],
]

/** More: the setup pages, reports, who's using this, and sign out. */
export default function More({ onOpen, onSignOut }: { onOpen: (s: Sheet) => void; onSignOut: () => void }) {
  const { who } = useContext(WhoContext)
  const [sandbox, setSandbox] = useState(false)
  useEffect(() => {
    let live = true
    // Only the sandbox shows "Set up sandbox"; anything but a clear yes hides it.
    api<{ sandbox: boolean }>(SEED).then((r) => { if (live) setSandbox(r.ok && r.data?.sandbox === true) })
    return () => { live = false }
  }, [])
  const now = today()
  const coming = closures.filter((c) => c.to >= now).length
  return (
    <>
      <div className="adm-top">
        <div className="adm-grow">
          <p className="adm-brand">Hometown Studio</p>
          <h1>More</h1>
        </div>
      </div>
      <ul className="adm-mlist" aria-label="Setup">
        {ROWS.map(([page, title, sub]) => {
          const text = page === 'closed' ? `${coming} coming up` : sub
          const soon = /^Coming/.test(text)
          return (
            <li key={page}>
              <button type="button" className="adm-mrow" onClick={() => onOpen({ kind: 'more', page })}>
                <span className="adm-rm">
                  <b>{title}</b>
                  <small>{soon ? <span className="adm-tag" style={{ margin: 0 }}>{text}</span> : text}</small>
                </span>
                <span className="adm-chev" aria-hidden="true">›</span>
              </button>
            </li>
          )
        })}
      </ul>
      <ul className="adm-mlist" aria-label="You">
        <li>
          <button type="button" className="adm-mrow" onClick={() => onOpen({ kind: 'more', page: 'who' })}>
            <span className="adm-rm"><b>Using as {who ?? '…'}</b><small>Change who’s using this device</small></span>
            <span className="adm-chev" aria-hidden="true">›</span>
          </button>
        </li>
        {sandbox && (
          <li>
            <button type="button" className="adm-mrow" onClick={() => onOpen({ kind: 'more', page: 'sandbox' })}>
              <span className="adm-rm"><b>Set up sandbox</b><small>For the test site only</small></span>
              <span className="adm-chev" aria-hidden="true">›</span>
            </button>
          </li>
        )}
        <li>
          <button type="button" className="adm-mrow" onClick={onSignOut}>
            <span className="adm-rm"><b>Sign out</b><small>Next time, the passcode is asked again</small></span>
          </button>
        </li>
      </ul>
    </>
  )
}
