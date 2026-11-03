import { useEffect, useState } from 'react'
import type { MonthReport } from '@pages/api/admin/reports.json'
import type { TaxMonth, TaxSent } from '@lib/tax-report-store'
import { addTaxSummaries, BUCKET_LABEL, BUCKET_TAX, taxReportCsv, taxTotals, type Bucket, type TaxSummary } from '@lib/tax-report'
import { localDate } from '@lib/parties/party-times'
import { formatMoney } from '@lib/money'
import { api, REPORTS, TAX_REPORT } from '../classes/api'
import { monthLabel } from '../classes/dates'
import { Failed, Skeleton } from '../shell/items'
import { SheetFrame } from '../shell/Sheet'
import { useToast } from '../shell/Toast'

/** The first month the picker offers. */
/** The first month with sales: the first party was 12 Sep 2026 (the grand opening, 16 Oct). */
export const REPORTS_FIRST_MONTH = '2026-09'

/** Every month from the first to `now`'s, newest first, then each year (newest first). Pure. */
export function reportPeriods(now: Date = new Date(), first = REPORTS_FIRST_MONTH): { months: string[]; years: string[] } {
  const current = localDate(now.toISOString()).slice(0, 7)
  const months: string[] = []
  let [y, m] = current.split('-').map(Number)
  while (`${y}-${String(m).padStart(2, '0')}` >= first) {
    months.push(`${y}-${String(m).padStart(2, '0')}`)
    m -= 1
    if (m === 0) { m = 12; y -= 1 }
  }
  const years = [...new Set(months.map((x) => x.slice(0, 4)))]
  return { months, years }
}

/** "November 2026" or "All of 2026". */
export function periodLabel(period: string): string {
  return period.length === 4 ? `All of ${period}` : monthLabel(`${period}-01`)
}

const sentLine = (s: TaxSent) => {
  const day = new Date(s.at).toLocaleDateString('en-US', { timeZone: 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric' })
  return `Emailed ${day} to ${s.to}.`
}

function TaxTable({ summary }: { summary: TaxSummary }) {
  const t = taxTotals(summary)
  const rows = (Object.keys(BUCKET_LABEL) as Bucket[]).filter((b) => summary[b] && (summary[b].lines > 0 || summary[b].taxCents !== 0))
  return (
    <>
      <div className="adm-sum">
        <div><b>{formatMoney(t.useCents)}</b><small>use tax (classes, Craft Café and party crafts; party studio fees carry none)</small></div>
        <div><b>{formatMoney(t.salesCents)}</b><small>sales tax (take-home kits)</small></div>
      </div>
      {t.unsureCents !== 0 && <p className="adm-warntext">{`${formatMoney(t.unsureCents)} of tax is on custom amounts (not linked to an item). Ask the accountant where it goes.`}</p>}
      {rows.length === 0 && <p className="adm-empty">No sales in Square for this time.</p>}
      {rows.map((b) => (
        <div key={b} className="adm-kv">
          <span>{BUCKET_LABEL[b]}</span>
          <span>{b === 'parties' && summary[b].taxCents === 0
            ? `${formatMoney(summary[b].salesCents)} sales · untaxed`
            : `${formatMoney(summary[b].salesCents)} sales · ${formatMoney(summary[b].taxCents)} tax · ${BUCKET_TAX[b] === 'use' ? 'use tax' : BUCKET_TAX[b] === 'sales' ? 'sales tax' : 'ask the accountant'}`}</span>
        </div>
      ))}
    </>
  )
}

/** Save a file the page made (a year's tax split) to the device. */
function saveFile(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** One month's tax split from Square: Download, Send it now / again, Send to…, Ask Square again. */
function MonthTax({ month }: { month: string }) {
  const toast = useToast()
  const [r, setR] = useState<(TaxMonth & { lastSent: TaxSent | null }) | null>(null)
  const [error, setError] = useState('')
  const [tries, setTries] = useState(0)
  const [fresh, setFresh] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  /** "Send to…" (I7): one address typed here, like the accountant's. */
  const [askTo, setAskTo] = useState(false)
  const [toEmail, setToEmail] = useState('')
  useEffect(() => {
    let live = true
    setR(null)
    setError('')
    setSendError('')
    api<TaxMonth & { lastSent: TaxSent | null }>(`${TAX_REPORT}?month=${month}${fresh ? '&fresh=1' : ''}`).then((x) => {
      if (!live) return
      setFresh(false)
      if (x.ok && x.data) setR(x.data)
      else setError(x.error ?? '')
    })
    return () => { live = false }
  }, [month, tries])
  async function send(to?: string) {
    setSending(true)
    setSendError('')
    const x = await api<{ sent: boolean; to: string; at: string }>(TAX_REPORT, { action: 'send', month, ...(to ? { to } : {}) })
    setSending(false)
    if (x.ok && x.data) {
      toast(`Sent to ${x.data.to}.`)
      setAskTo(false)
      setR((cur) => (cur ? { ...cur, lastSent: { at: x.data!.at, to: x.data!.to, by: '' } } : cur))
    } else setSendError(x.error ?? '')
  }
  const name = monthLabel(`${month}-01`)
  return (
    <section aria-label="Tax split">
      <p className="adm-lbl adm-gap-top">{`Tax split, ${name}${r?.partial ? ' so far' : ''}`}</p>
      {error && <Failed message={error} onRetry={() => setTries((n) => n + 1)} />}
      {!error && !r && <Skeleton rows={2} label="Asking Square for the month’s sales" />}
      {r && (
        <>
          <TaxTable summary={r.summary} />
          <p className="adm-note">{`From Square: ${r.orders} completed ${r.orders === 1 ? 'sale' : 'sales'} in ${name}, refunds taken off. Sales are before tax.${r.partial ? ' The month isn’t over, so these are the numbers so far.' : ''} Use tax and sales tax are the two totals your accountant files.`}</p>
          {r.classesCategoryMissing && <p className="adm-note">Classes may be counted under Craft Café here. Both are use tax, so the use-tax total is right.</p>}
          {r.lastSent && <p className="adm-small adm-muted">{sentLine(r.lastSent)}</p>}
          {sendError && <p className="adm-error" role="alert">{sendError}</p>}
          <div className="adm-two adm-gap-top">
            <a className="adm-btn is-ghost" href={`${TAX_REPORT}?month=${month}&format=csv`} download={`hometown-tax-${month}.csv`}>Download</a>
            <button type="button" className="adm-btn is-pri" disabled={sending} onClick={() => send()}>{sending && !askTo ? 'Sending…' : r.lastSent ? 'Send it again' : 'Send it now'}</button>
          </div>
          <p className="adm-small adm-muted adm-gap-top">{`${r.lastSent ? 'Send it again' : 'Send it now'} emails this month’s tax split to the owners picked for it in Notifications (and the accountant, if you added one there). Download saves it as a spreadsheet.`}</p>
          {askTo
            ? (
              <div className="adm-panel adm-gap-top" role="group" aria-label="Send to someone else">
                <label className="adm-fld">
                  <span>Their email</span>
                  <input type="email" inputMode="email" autoCapitalize="off" autoCorrect="off" value={toEmail} placeholder="Like: your accountant’s email" onChange={(e) => { setToEmail(e.target.value); setSendError('') }} />
                </label>
                <span className="adm-small">Only this month’s totals go: no customer names.</span>
                <div className="adm-two">
                  <button type="button" className="adm-btn is-ghost" onClick={() => { setAskTo(false); setSendError('') }}>Never mind</button>
                  <button type="button" className="adm-btn is-pri" disabled={sending || !toEmail.trim()} onClick={() => send(toEmail.trim())}>{sending ? 'Sending…' : 'Send'}</button>
                </div>
              </div>
            )
            : <button type="button" className="adm-btn is-ghost is-sm adm-gap-top" onClick={() => setAskTo(true)}>Send to…</button>}
          {!r.partial && (
            <button type="button" className="adm-btn is-ghost is-sm adm-gap-top" onClick={() => { setFresh(true); setTries((n) => n + 1) }}>Ask Square again</button>
          )}
        </>
      )}
    </section>
  )
}

/** A year's tax split: each month asked in turn (ended months are remembered, so it's quick after the first time). */
function YearTax({ year, months }: { year: string; months: string[] }) {
  const [got, setGot] = useState<TaxMonth[]>([])
  const [error, setError] = useState('')
  const [tries, setTries] = useState(0)
  const wanted = [...months].filter((m) => m.startsWith(year)).sort()
  useEffect(() => {
    let live = true
    setGot([])
    setError('')
    ;(async () => {
      const out: TaxMonth[] = []
      for (const m of wanted) {
        const x = await api<TaxMonth>(`${TAX_REPORT}?month=${m}`)
        if (!live) return
        if (!x.ok || !x.data) { setError(x.error ?? ''); return }
        out.push(x.data)
        setGot([...out])
      }
    })()
    return () => { live = false }
  }, [year, tries])
  const done = got.length === wanted.length && !error
  return (
    <section aria-label="Tax split">
      <p className="adm-lbl adm-gap-top">{`Tax split, all of ${year}`}</p>
      {error && <Failed message={error} onRetry={() => setTries((n) => n + 1)} />}
      {!error && !done && <Skeleton rows={2} label={`Adding up the months: ${got.length} of ${wanted.length}`} />}
      {done && (
        <>
          <TaxTable summary={addTaxSummaries(got.map((g) => g.summary))} />
          <p className="adm-note">{`From Square: every month of ${year} so far, refunds taken off. Sales are before tax. The download has each month and the year’s totals.`}</p>
          <button type="button" className="adm-btn is-ghost adm-gap-top" onClick={() => saveFile(`hometown-tax-${year}.csv`, taxReportCsv(got))}>Download</button>
        </>
      )}
    </section>
  )
}

/** More › Reports: any month or year from our own records, and the tax split from Square. */
export function ReportsSheet() {
  const { months, years } = reportPeriods()
  const [period, setPeriod] = useState(months[0])
  const [r, setR] = useState<MonthReport | null>(null)
  const [error, setError] = useState('')
  const [tries, setTries] = useState(0)
  const thisMonth = period === months[0]
  useEffect(() => {
    let live = true
    setR(null)
    setError('')
    api<MonthReport>(thisMonth ? REPORTS : `${REPORTS}?period=${period}`).then((x) => {
      if (!live) return
      if (x.ok && x.data) setR(x.data)
      else setError(x.error ?? '')
    })
    return () => { live = false }
  }, [period, tries])
  const label = periodLabel(period)
  const year = period.length === 4
  return (
    <SheetFrame title="Reports" subtitle={thisMonth ? `${label} so far` : label} tall>
      <label className="adm-fld adm-gap-bottom">
        <span>Show</span>
        <select value={period} onChange={(e) => setPeriod(e.target.value)}>
          <optgroup label="A month">
            {months.map((m, i) => <option key={m} value={m}>{i === 0 ? `This month (${monthLabel(`${m}-01`)})` : monthLabel(`${m}-01`)}</option>)}
          </optgroup>
          <optgroup label="A whole year">
            {years.map((y) => <option key={y} value={y}>{`All of ${y}`}</option>)}
          </optgroup>
        </select>
      </label>
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
          {(r.discountCents ?? 0) > 0 && (
            <div className="adm-kv">
              <span>Money off (early-bird and codes)</span>
              <span>{`${formatMoney(r.discountCents)}${r.codeDiscountCents ? `, ${formatMoney(r.codeDiscountCents)} from codes` : ''}`}</span>
            </div>
          )}
          <p className="adm-note" style={{ marginTop: '0.75rem' }}>
            {`Covers our own classes (seats booked online, at the door and at the register ${year ? 'that year' : thisMonth ? 'this month' : 'that month'}, with tax and extras; comps count as seats at $0) and parties booked then (cancelled ones left out). Party fees are the studio fees and extras paid then, less party refunds made then. Refunds are the ones made then, whenever the seat was sold. Craft Café, party crafts and anything else rung up in Square are in the tax split below and in Square’s own reports.`}
          </p>
        </>
      )}
      {year ? <YearTax key={period} year={period} months={months} /> : <MonthTax key={period} month={period} />}
    </SheetFrame>
  )
}
