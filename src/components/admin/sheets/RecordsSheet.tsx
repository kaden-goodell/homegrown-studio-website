import { useEffect, useState } from 'react'
import { RECORD_SECTIONS } from '@lib/records-sections'
import { localDate } from '@lib/parties/party-times'
import { adminHeaders, adminSignedOut, api, OFFLINE, RECORDS } from '../classes/api'
import { Seg } from '../shell/items'
import { SheetFrame } from '../shell/Sheet'

type Pick = 'year' | 'last' | 'days' | 'all'

/** "Jan 1, 2026" */
const dayLabel = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' })

/** The first and last day for a quick pick, in studio days. Pure. */
export function rangeFor(pick: Pick, now: Date = new Date()): { from: string; to: string } | null {
  const today = localDate(now.toISOString())
  const y = Number(today.slice(0, 4))
  if (pick === 'year') return { from: `${y}-01-01`, to: today }
  if (pick === 'last') return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` }
  return null
}

/** Save the zip the site sent to this device. */
function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

/** More › Records: the legal records for the days she picks, as one file on this device. */
export function RecordsSheet() {
  const today = localDate(new Date().toISOString())
  const [pick, setPick] = useState<Pick>('year')
  const [from, setFrom] = useState(`${today.slice(0, 4)}-01-01`)
  const [to, setTo] = useState(today)
  const [passcode, setPasscode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ text: string; field?: string } | null>(null)
  const [done, setDone] = useState('')
  const [lastArchive, setLastArchive] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    let live = true
    api<{ lastArchive: string | null }>(RECORDS).then((r) => { if (live) setLastArchive(r.ok ? r.data?.lastArchive ?? null : null) })
    return () => { live = false }
  }, [])

  const range = pick === 'days' ? { from, to } : rangeFor(pick)
  async function download() {
    setError(null)
    setDone('')
    if (!passcode) { setError({ text: 'Type your admin passcode first.', field: 'passcode' }); return }
    setBusy(true)
    try {
      const res = await fetch(RECORDS, {
        method: 'POST',
        headers: adminHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(pick === 'all' ? { everything: true, passcode } : { ...range, passcode }),
      })
      if (res.status === 401) { adminSignedOut(); return }
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError({ text: j?.error || 'That didn’t work. Try again.', field: j?.field })
        return
      }
      const name = res.headers.get('X-Records-Filename') || 'hometown-records.zip'
      saveBlob(await res.blob(), name)
      setPasscode('')
      setDone(`Downloaded ${name}. Open it from Files › Downloads. Keep it somewhere safe and private.`)
    } catch {
      setError({ text: OFFLINE })
    } finally {
      setBusy(false)
    }
  }

  return (
    <SheetFrame
      title="Records"
      subtitle="Waivers, check-ins, pickups, incidents and who did what"
      tall
      footer={<button type="button" className="adm-btn is-pri" disabled={busy} onClick={download}>{busy ? 'Gathering the records…' : 'Download records'}</button>}
    >
      <p className="adm-note">Download the studio’s legal records for the days you pick, as one file (a .zip) saved to this device. Nothing on the site changes, and nothing is deleted.</p>
      <Seg<Pick>
        label="Which days"
        value={pick}
        options={[['year', 'This year'], ['last', 'Last year'], ['days', 'Pick the days'], ['all', 'Everything']]}
        onChange={(v) => { setPick(v); setError(null) }}
      />
      {pick === 'days' && (
        <div className="adm-two adm-gap-top" data-field="range">
          <label className="adm-fld"><span>First day</span><input type="date" value={from} max={today} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="adm-fld"><span>Last day</span><input type="date" value={to} max={today} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
      )}
      <p className="adm-small adm-muted adm-gap-top">
        {pick === 'all'
          ? 'Everything the site keeps, whatever its date: the records below plus classes, seats sold, parties and their payments, settings and staff. The same as the weekly copy.'
          : range ? `From ${dayLabel(range.from)} to ${dayLabel(range.to)}, both days included.` : ''}
      </p>
      {error?.field === 'range' && <p className="adm-error" role="alert">{error.text}</p>}

      <p className="adm-lbl adm-gap-top">What’s in the file</p>
      <ul className="adm-help-list">
        {RECORD_SECTIONS.map((s) => <li key={s.file}><b>{s.file}</b>{` ${s.what}`}</li>)}
        <li><b>README.txt</b> says all of this again, inside the file.</li>
      </ul>
      <p className="adm-small adm-muted">A record dated in those days is included. Each event’s door settings have no date, so they always come along. The .csv files open in Numbers or Excel.</p>

      <label className="adm-fld adm-gap-top" data-field="passcode">
        <span>Your admin passcode</span>
        <input type="password" autoComplete="current-password" value={passcode} aria-invalid={error?.field === 'passcode' || undefined} onChange={(e) => setPasscode(e.target.value)} />
      </label>
      <small className="adm-hint">Asked again because the file holds families’ names, phone numbers, children’s details and signatures.</small>
      {error && error.field !== 'range' && <p className="adm-error" role="alert">{error.text}</p>}
      {done && <p className="adm-done" role="status">{done}</p>}

      <p className="adm-small adm-muted adm-gap-top">
        {lastArchive === undefined ? '' : lastArchive
          ? `The site also keeps a full copy every Sunday morning and emails it. Last copy: ${dayLabel(lastArchive)}.`
          : 'The site also keeps a full copy every Sunday morning and emails it. No copy has been made on this site yet.'}
      </p>
    </SheetFrame>
  )
}
