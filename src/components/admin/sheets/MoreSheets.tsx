import { createContext, useContext, useEffect, useState } from 'react'
import type { MonthReport } from '@pages/api/admin/reports.json'
import { clock, clockRange } from '../shell/time'
import { partyConfig, partyDateOverrides, partyDays } from '@config/party.config'
import { OWNERS, type Owner } from '@lib/admin-who'
import { formatMoney } from '@lib/money'
import { api, REPORTS, SEED } from '../classes/api'
import { dayLabel, monthLabel, today } from '../classes/dates'
import { Failed, Seg, Skeleton } from '../shell/items'
import { SheetFrame, useSheet } from '../shell/Sheet'
import { useToast } from '../shell/Toast'

/** Who is using /admin, and how to change it (More › Using as). */
export const WhoContext = createContext<{ who: Owner | null; setWho: (o: Owner) => void }>({ who: null, setWho: () => {} })

const WEEKDAY_PLURAL = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays']

/** The party start times a day shape gives: every party-plus-cleanup from the first start until the last wrap. */
export function startsFor(cfg: { firstStart: string; lastWrap: string }): string[] {
  const mins = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m }
  const step = partyConfig.durationMinutes + partyConfig.cleanupBufferMinutes
  const out: string[] = []
  for (let t = mins(cfg.firstStart); t + step <= mins(cfg.lastWrap); t += step) {
    out.push(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`)
  }
  return out
}

interface Craft { id: string; name: string; perHeadCents: number; perHeadMaxCents: number }

const kv = (k: string, v: string, key?: string) => (
  <div key={key ?? k} className="adm-kv"><span>{k}</span><span>{v}</span></div>
)

/** Parties setup, read only in stage 1: when parties run, the package, and the party crafts from Square. */
export function PartiesSetupSheet() {
  const [crafts, setCrafts] = useState<Craft[] | null>(null)
  const [error, setError] = useState('')
  const [tries, setTries] = useState(0)
  useEffect(() => {
    let live = true
    setError('')
    api<{ crafts: Craft[] }>('/api/party/service-info.json').then((r) => {
      if (!live) return
      if (r.ok && r.data) setCrafts(r.data.crafts)
      else setError(r.ok ? 'The party crafts didn’t load.' : r.error ?? '')
    })
    return () => { live = false }
  }, [tries])
  const now = today()
  const weekly = [4, 5, 6, 0].filter((d) => partyDays[d]).map((d) => [WEEKDAY_PLURAL[d], startsFor(partyDays[d]).map(clock).join(', ')] as const)
  const oneOff = Object.entries(partyDateOverrides).filter(([d]) => d >= now).sort(([a], [b]) => a.localeCompare(b))
  const price = formatMoney(partyConfig.basePriceCents)
  return (
    <SheetFrame tall title="Parties setup" subtitle={`Whole studio · ${price} · ${partyConfig.minGuests}–${partyConfig.maxGuests} guests`}>
      <p className="adm-note">Editing party times comes with party booking.</p>
      <p className="adm-lbl">Party days and times</p>
      {weekly.map(([d, t]) => kv(d, t))}
      {oneOff.length > 0 && (
        <>
          <p className="adm-lbl">One-off days</p>
          {oneOff.map(([d, cfg]) => kv(dayLabel(d), startsFor(cfg).map(clock).join(', '), d))}
        </>
      )}
      <p className="adm-lbl">Whole-studio package</p>
      {kv('Price', price)}
      {kv('Length', `${partyConfig.durationMinutes} minutes, then ${partyConfig.cleanupBufferMinutes} to clean up`)}
      {kv('Guests', `${partyConfig.minGuests} to ${partyConfig.maxGuests}`)}
      {kv('Booking', `${partyConfig.minLeadDays} days ahead at the soonest, ${partyConfig.bookingWindowDays} at the most`)}
      <p className="adm-note" style={{ marginTop: '0.75rem' }}>Crafts are charged per guest on top of the package, at the studio.</p>
      <p className="adm-lbl">Party crafts</p>
      {error && <Failed message={error} onRetry={() => setTries((n) => n + 1)} />}
      {!error && !crafts && <Skeleton rows={3} label="Loading the party crafts" />}
      {crafts && crafts.length === 0 && <p className="adm-empty">No party crafts in Square yet.</p>}
      {crafts?.map((c) => kv(
        c.name,
        `${c.perHeadMaxCents > c.perHeadCents ? `${formatMoney(c.perHeadCents)}–${formatMoney(c.perHeadMaxCents)}` : formatMoney(c.perHeadCents)} a guest`,
        c.id,
      ))}
    </SheetFrame>
  )
}

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
            <div><b>{formatMoney(r.refundedCents)}</b><small>{`refunds (${r.refunds})`}</small></div>
            <div><b>{r.partiesBooked}</b><small>parties booked</small></div>
          </div>
          <p className="adm-note" style={{ marginTop: '0.75rem' }}>
            Covers our own classes (seats booked online, at the door and on the POS this month, with tax and extras; comps count as seats at $0) and parties booked on the website this month. Refunds are this month’s, whenever the seat was sold. Craft Café, party crafts and anything else rung up in Square are in Square’s reports.
          </p>
        </>
      )}
    </SheetFrame>
  )
}

/** Change who is using /admin on this device. */
export function WhoSheet() {
  const { who, setWho } = useContext(WhoContext)
  const toast = useToast()
  return (
    <SheetFrame title="Who’s using this?" subtitle="Changes you make are saved under this name.">
      <Seg
        label="Who’s using this?"
        value={who ?? ''}
        options={OWNERS.map((o) => [o, o] as [string, string])}
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

/** "Book a party" in stage 1: booking for someone happens on the party page, the one customers use. */
export function BookPartySheet({ day }: { day?: string }) {
  const href = `/book${day ? `?date=${day}` : ''}`
  return (
    <SheetFrame
      title="Book a party"
      subtitle={day ? `On ${dayLabel(day)}` : `Whole studio · ${formatMoney(partyConfig.basePriceCents)} + crafts`}
      footer={<a className="adm-btn is-pri" href={href} target="_blank" rel="noopener">Open the party booking page</a>}
    >
      <p className="adm-note">For now, booking a party for someone happens on the party booking page, the same one customers use. It opens in a new tab{day ? ' on this day' : ''}. Booking it right here comes with the next stage.</p>
    </SheetFrame>
  )
}
