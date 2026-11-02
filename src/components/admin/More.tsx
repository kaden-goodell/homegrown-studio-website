import { useContext, useEffect, useState } from 'react'
import { api, PREVIEW_MESSAGES, SEED } from './classes/api'
import type { MorePage, Sheet } from './shell/router'
import { WhoContext } from './sheets/MoreSheets'
import { useStudio } from './shell/studio'
import { closedComing } from './sheets/SettingsSheets'
import { usePartySettings } from './parties/api'
import { partiesSummary } from './parties/PartiesSetupSheet'

const ROWS: [MorePage, string, string][] = [
  ['parties', 'Parties setup', 'Party times, packages, extras, crafts'],
  ['hours', 'Hours & Craft Café', 'Café hours and special days'],
  ['closed', 'Closed days', ''],
  ['staff', 'Staff', 'Who’s on, who can work, calendar links'],
  ['promos', 'Promotions', 'Codes, early-bird'],
  ['register', 'Register setup', 'The class tax and Classes category on the register'],
  ['reports', 'Reports', 'This month: seats sold, sales, refunds'],
]

/** More: the setup pages, reports, who's using this, and sign out. */
export default function More({ onOpen, onSignOut }: { onOpen: (s: Sheet) => void; onSignOut: () => void }) {
  const { who } = useContext(WhoContext)
  const [sandbox, setSandbox] = useState(false)
  const [muted, setMuted] = useState(false)
  useEffect(() => {
    let live = true
    // Only the sandbox shows "Set up sandbox"; anything but a clear yes hides it.
    api<{ sandbox: boolean }>(SEED).then((r) => { if (live) setSandbox(r.ok && r.data?.sandbox === true) })
    // Only the sandbox preview (messages muted) shows "Messages".
    api<{ muted: boolean }>(PREVIEW_MESSAGES).then((r) => { if (live) setMuted(r.ok && r.data?.muted === true) })
    return () => { live = false }
  }, [])
  const coming = closedComing(useStudio().days.closures)
  const parties = usePartySettings().settings
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
          const text = page === 'closed' ? `${coming} coming up` : page === 'parties' && parties ? partiesSummary(parties) : sub
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
      <ul className="adm-mlist" aria-label="Help">
        <li>
          <button type="button" className="adm-mrow" onClick={() => onOpen({ kind: 'more', page: 'help' })}>
            <span className="adm-rm"><b>Help</b><small>How to do everything, and what each warning means</small></span>
            <span className="adm-chev" aria-hidden="true">›</span>
          </button>
        </li>
      </ul>
      <ul className="adm-mlist" aria-label="Classes from Square">
        <li>
          <button type="button" className="adm-mrow" onClick={() => onOpen({ kind: 'more', page: 'import' })}>
            <span className="adm-rm"><b>Bring in Square classes</b><small>Add the classes Square runs now to your library</small></span>
            <span className="adm-chev" aria-hidden="true">›</span>
          </button>
        </li>
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
        {muted && (
          <li>
            <button type="button" className="adm-mrow" onClick={() => onOpen({ kind: 'more', page: 'messages' })}>
              <span className="adm-rm"><b>Messages</b><small>Emails and texts this test site would have sent</small></span>
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
