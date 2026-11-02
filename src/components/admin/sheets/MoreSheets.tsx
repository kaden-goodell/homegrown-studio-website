import { createContext, useContext, useEffect, useState } from 'react'
import type { MonthReport } from '@pages/api/admin/reports.json'
import { OWNERS, type Owner } from '@lib/admin-who'
import { formatMoney } from '@lib/money'
import { api, PREVIEW_MESSAGES, REPORTS, SEED } from '../classes/api'
import type { MutedMessage } from '@lib/preview-outbound'
import { monthLabel } from '../classes/dates'
import { Failed, Seg, Skeleton } from '../shell/items'
import { SheetFrame, useSheet } from '../shell/Sheet'
import { useToast } from '../shell/Toast'

/** Who is using /admin, and how to change it (More › Using as). */
export const WhoContext = createContext<{ who: Owner | null; setWho: (o: Owner) => void; owners?: Owner[] }>({ who: null, setWho: () => {}, owners: [...OWNERS] })

export function ComingSheet({ title, stage, what }: { title: string; stage: number; what: string }) {
  return (
    <SheetFrame title={title} subtitle={<span className="adm-tag" style={{ margin: 0 }}>Coming in stage {stage}</span>}>
      <p className="adm-note">Coming soon: {what}</p>
    </SheetFrame>
  )
}

/** This month, from our own records only. */
export function ReportsSheet() {
  const [r, setR] = useState<MonthReport | null>(null)
  const [error, setError] = useState('')
  const [tries, setTries] = useState(0)
  useEffect(() => {
    let live = true
    setError('')
    api<MonthReport>(REPORTS).then((x) => {
      if (!live) return
      if (x.ok && x.data) setR(x.data)
      else setError(x.error ?? '')
    })
    return () => { live = false }
  }, [tries])
  return (
    <SheetFrame title="Reports" subtitle={r ? `${monthLabel(`${r.month}-01`)} so far` : 'This month so far'}>
      {error && <Failed message={error} onRetry={() => setTries((n) => n + 1)} />}
      {!error && !r && <Skeleton rows={2} label="Loading the numbers" />}
      {r && (
        <>
          <div className="adm-sum">
            <div><b>{r.seatsSold}</b><small>class seats sold</small></div>
            <div><b>{formatMoney(r.classSalesCents)}</b><small>class sales, before refunds</small></div>
          </div>
          <div className="adm-sum">
            <div><b>{formatMoney(r.refundedCents)}</b><small>{`class refunds (${r.refunds})`}</small></div>
            <div><b>{r.partiesBooked}</b><small>parties booked</small></div>
          </div>
          {typeof r.partyFeesCents === 'number' && (
            <div className="adm-sum">
              <div><b>{formatMoney(r.partyFeesCents)}</b><small>party fees taken, less refunds</small></div>
            </div>
          )}
          <p className="adm-note" style={{ marginTop: '0.75rem' }}>
            Covers our own classes (seats booked online, at the door and on the POS this month, with tax and extras; comps count as seats at $0) and parties booked this month (cancelled ones left out). Party fees are the studio fees and extras paid this month, less party refunds made this month. Refunds are this month’s, whenever the seat was sold. Craft Café, party crafts and anything else rung up in Square are in Square’s reports.
          </p>
        </>
      )}
    </SheetFrame>
  )
}

/** Change who is using /admin on this device. */
export function WhoSheet() {
  const { who, setWho, owners = [...OWNERS] } = useContext(WhoContext)
  const toast = useToast()
  return (
    <SheetFrame title="Who’s using this?" subtitle="Changes you make are saved under this name.">
      <Seg
        label="Who’s using this?"
        value={who ?? ''}
        options={owners.map((o) => [o, o] as [string, string])}
        onChange={(o) => { setWho(o as Owner); toast(`Now using as ${o}.`) }}
      />
    </SheetFrame>
  )
}

interface Seeded { classesCategoryId: string; classTaxId: string; commands: string[] }

/** The test site only: make the Classes category and the 9% sales tax in the Square sandbox. */
export function SandboxSheet() {
  const { close } = useSheet()
  /** Only the sandbox may run it: the sheet asks first, so an address typed on the live site shows nothing to press. */
  const [sandbox, setSandbox] = useState<boolean | null>(null)
  useEffect(() => {
    let live = true
    api<{ sandbox: boolean }>(SEED).then((r) => { if (live) setSandbox(r.ok && r.data?.sandbox === true) })
    return () => { live = false }
  }, [])
  const [seed, setSeed] = useState<Seeded | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function run() {
    setBusy(true)
    setError('')
    const r = await api<Seeded>(SEED, {})
    setBusy(false)
    if (r.ok && r.data) setSeed(r.data)
    else setError(r.error ?? '')
  }
  if (sandbox !== true) {
    return (
      <SheetFrame title="Set up sandbox" subtitle="For the test site only">
        {sandbox === null ? <Skeleton rows={1} /> : <p className="adm-note">Only on the test site. This site uses the live Square account, so there is nothing to set up here.</p>}
      </SheetFrame>
    )
  }
  return (
    <SheetFrame
      title="Set up sandbox"
      subtitle="For the test site only"
      footer={seed
        ? <button type="button" className="adm-btn is-ghost" onClick={close}>Done</button>
        : <button type="button" className="adm-btn is-pri" disabled={busy} onClick={run}>{busy ? 'Setting up…' : 'Set up sandbox'}</button>}
    >
      <p className="adm-note">Makes the Classes category and the 9% sales tax in the Square sandbox.</p>
      {error && <p className="adm-error" role="alert">{error}</p>}
      {seed && (
        <div className="adm-card">
          <p>{`Category ${seed.classesCategoryId} · Tax ${seed.classTaxId}`}</p>
          <p>Run these, then redeploy the branch.</p>
          {seed.commands.map((cmd) => <code key={cmd} style={{ display: 'block', overflowWrap: 'anywhere', userSelect: 'all', fontSize: '0.85rem' }}>{cmd}</code>)}
        </div>
      )}
    </SheetFrame>
  )
}

/** The sandbox preview only: the emails and texts it would have sent (none are sent there). */
export function PreviewMessagesSheet() {
  const [r, setR] = useState<{ muted: boolean; messages: MutedMessage[] } | null>(null)
  const [error, setError] = useState('')
  const [tries, setTries] = useState(0)
  useEffect(() => {
    let live = true
    setError('')
    api<{ muted: boolean; messages: MutedMessage[] }>(PREVIEW_MESSAGES).then((x) => {
      if (!live) return
      if (x.ok && x.data) setR(x.data)
      else setError(x.error ?? '')
    })
    return () => { live = false }
  }, [tries])
  const when = (iso: string) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  return (
    <SheetFrame title="Messages this site would have sent" subtitle="Test site only: nothing here was sent">
      {error ? <Failed message={error} onRetry={() => setTries((t) => t + 1)} />
        : !r ? <Skeleton rows={3} />
        : !r.muted ? <p className="adm-note">Only on the test site. This site sends its emails and texts for real.</p>
        : !r.messages.length ? <p className="adm-note">Nothing yet. Emails and texts this test site would have sent show here, newest first.</p>
        : (
          <ul className="adm-mlist" aria-label="Messages not sent">
            {r.messages.map((m) => (
              <li key={m.id} className="adm-card" style={{ margin: '0 0 8px' }}>
                <p style={{ margin: 0 }}><b>{m.kind === 'email' ? 'Email' : 'Text'} to {m.to}</b> <small>{when(m.at)}</small></p>
                {m.subject && <p style={{ margin: '2px 0 0' }}>{m.subject}</p>}
                {m.firstLine && <p className="adm-note" style={{ margin: '2px 0 0', overflowWrap: 'anywhere' }}>{m.firstLine}</p>}
              </li>
            ))}
          </ul>
        )}
    </SheetFrame>
  )
}
