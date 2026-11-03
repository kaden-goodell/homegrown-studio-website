/**
 * More › Online booking (G1): open or pause online booking for parties,
 * classes & workshops and (while kits exist) take-home kits, the short note
 * customers read while it's paused, and a test link to try booking on this
 * device while it's paused. GET/POST /api/admin/online-booking.json; every
 * save sends what was loaded (compare-and-set). Takes effect on the website
 * within about 30 seconds, no redeploy. Nothing already booked changes.
 */
import { useEffect, useState } from 'react'
import type { By } from '@lib/staff-auth'
import { api } from '../classes/api'
import { Failed, Seg, Skeleton } from '../shell/items'
import { SheetFrame, useSheetDirty } from '../shell/Sheet'
import type { Sheet } from '../shell/router'
import { DIDNT_SAVE, useToast } from '../shell/Toast'

export const ONLINE_BOOKING = '/api/admin/online-booking.json'

type Kind = 'parties' | 'workshops' | 'kits'
export interface OnlineBookingView {
  open: Record<Kind, boolean>
  pauseNote: string
  pauseNoteWritten: string
  previewToken: string
  source: 'saved' | 'setup' | 'unreadable'
  updatedAt: string | null
  by: By | null
  history: { at: string; by: By; changed: string[] }[]
  defaultNote: string
  noteMax: number
  kitsExist: boolean
  readOnly: boolean
}

const NAME: Record<Kind, string> = { parties: 'Parties', workshops: 'Classes & workshops', kits: 'Take-home kits' }
const LOWER: Record<Kind, string> = { parties: 'parties', workshops: 'classes and workshops', kits: 'take-home kits' }
/** The confirm buttons, spelled out (Help names them). */
const PAUSE_LABEL: Record<Kind, string> = { parties: 'Pause parties', workshops: 'Pause classes and workshops', kits: 'Pause take-home kits' }
const OPEN_LABEL: Record<Kind, string> = { parties: 'Open parties', workshops: 'Open classes and workshops', kits: 'Open take-home kits' }
const PAGE: Record<Kind, string> = { parties: '/book', workshops: '/workshops', kits: '/kits' }
const STALE = 'Someone else changed online booking. Check it and save again.'

/** "Tue Nov 3, 3:10 PM" by the studio's clock (the date too, so last week's pause isn't mistaken for today's). */
export function whenLabel(iso: string): string {
  const d = new Date(iso)
  const day = d.toLocaleString('en-US', { timeZone: 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '')
  const time = d.toLocaleString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' })
  return `${day}, ${time}`
}

/** The kinds paused right now (kits only while kits exist). */
export function pausedKinds(v: OnlineBookingView): Kind[] {
  return (['parties', 'workshops', 'kits'] as Kind[]).filter((k) => !v.open[k] && (k !== 'kits' || v.kitsExist))
}

/** When and by whom a kind was last paused, from the history. */
export function pausedSince(v: OnlineBookingView, k: Kind): { at: string; by: string } | null {
  const h = v.history.find((x) => x.changed.includes(`Paused ${NAME[k].toLowerCase()}`))
  return h ? { at: h.at, by: h.by.name } : null
}

export function OnlineBookingSheet() {
  const [v, setV] = useState<OnlineBookingView | null>(null)
  const [error, setError] = useState('')
  const [tries, setTries] = useState(0)
  useEffect(() => {
    let live = true
    setError('')
    api<OnlineBookingView>(ONLINE_BOOKING).then((r) => {
      if (!live) return
      if (r.ok && r.data) setV(r.data)
      else setError(r.error ?? '')
    })
    return () => { live = false }
  }, [tries])
  const subtitle = v ? summary(v) : undefined
  return (
    <SheetFrame tall title="Online booking" subtitle={subtitle}>
      {error && <Failed message={error} onRetry={() => setTries((n) => n + 1)} />}
      {!error && !v && <Skeleton rows={3} label="Loading online booking" />}
      {v && <OnlineBookingForm v={v} setV={setV} />}
    </SheetFrame>
  )
}

function summary(v: OnlineBookingView): string {
  const kinds: Kind[] = v.kitsExist ? ['parties', 'workshops', 'kits'] : ['parties', 'workshops']
  return kinds.map((k) => `${NAME[k]} ${v.open[k] ? 'open' : 'paused'}`).join(' · ')
}

function OnlineBookingForm({ v, setV }: { v: OnlineBookingView; setV: (v: OnlineBookingView) => void }) {
  const toast = useToast()
  const [asking, setAsking] = useState<{ kind: Kind; open: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(v.pauseNoteWritten)
  const [noteError, setNoteError] = useState('')
  const [stale, setStale] = useState('')
  const [shown, setShown] = useState<string>('')
  const [askNewLink, setAskNewLink] = useState(false)
  const noteDirty = note.trim().replace(/\s+/g, ' ') !== v.pauseNoteWritten
  useSheetDirty(noteDirty)
  useEffect(() => { if (!noteDirty) setNote(v.pauseNoteWritten) }, [v.updatedAt])

  async function save(change: { open?: Partial<Record<Kind, boolean>>; pauseNote?: string; newTestLink?: boolean }): Promise<OnlineBookingView | null> {
    setBusy(true)
    setStale('')
    const r = await api<OnlineBookingView & { changed: string[] }>(ONLINE_BOOKING, {
      open: { ...v.open, ...(change.open ?? {}) },
      pauseNote: change.pauseNote ?? v.pauseNoteWritten,
      newTestLink: change.newTestLink === true,
      expectedUpdatedAt: v.updatedAt,
    })
    setBusy(false)
    if (r.ok && r.data) { setV(r.data); return r.data }
    if (r.status === 409 && r.extra.current) { setV(r.extra.current); setStale(STALE); return null }
    if (r.extra.field === 'pauseNote') setNoteError(r.error ?? DIDNT_SAVE)
    else toast(r.error ?? DIDNT_SAVE)
    return null
  }

  async function flip(kind: Kind, open: boolean) {
    setAsking(null)
    const saved = await save({ open: { [kind]: open } })
    if (!saved) return
    toast(open
      ? `${NAME[kind]} are open online again.`
      : `${NAME[kind]} are paused online. People already booked keep their booking.`)
  }

  async function saveNote() {
    setNoteError('')
    const clean = note.trim().replace(/\s+/g, ' ')
    if (clean.length > v.noteMax) return setNoteError(`Keep the note to ${v.noteMax} characters.`)
    const saved = await save({ pauseNote: clean })
    if (saved) toast(clean ? 'Note saved. Customers see it while booking is paused.' : 'Back to the usual note.')
  }

  async function copyLink(kind: Kind, fresh = false) {
    let token = v.previewToken
    if (!token || fresh) {
      const saved = await save({ newTestLink: true })
      if (!saved) return
      token = saved.previewToken
      if (fresh) toast('New test link made. Old test links stop working.')
    }
    const link = `${window.location.origin}${PAGE[kind]}?preview=${token}`
    setShown(link)
    const clip = navigator.clipboard
    if (!clip) return
    clip.writeText(link).then(
      () => { if (!fresh) toast('Test link copied. Open it on the device you want to try it on.') },
      () => toast('Couldn’t copy. Press and hold the link below to copy it.'),
    )
  }

  const kinds: Kind[] = v.kitsExist ? ['parties', 'workshops', 'kits'] : ['parties', 'workshops']
  const locked = v.readOnly || busy
  return (
    <>
      {v.readOnly && <p className="adm-note">This is a test site, so online booking for the live website can’t be changed here.</p>}
      {stale && <p className="adm-error" role="alert">{stale}</p>}
      <p className="adm-small adm-muted adm-gap-bottom">
        {v.source === 'setup'
          ? 'From the site setup. The first change you make here takes over.'
          : v.source === 'unreadable'
            ? 'The saved setting couldn’t be read, so the website is treating everything as paused. Choose Open or Paused below to set it again.'
            : `Set on this screen${v.by && v.updatedAt ? ` · last change by ${v.by.name}, ${whenLabel(v.updatedAt)}` : ''}.`}
      </p>

      {kinds.map((k) => {
        const since = !v.open[k] ? pausedSince(v, k) : null
        return (
          <fieldset key={k} className="adm-date">
            <legend>{NAME[k]}</legend>
            <Seg
              label={`${NAME[k]} online`}
              value={v.open[k] ? 'open' : 'paused'}
              options={[['open', 'Open'], ['paused', 'Paused']]}
              onChange={(next) => {
                if (locked) return
                const open = next === 'open'
                if (open !== v.open[k]) setAsking({ kind: k, open })
              }}
            />
            <p className="adm-small adm-muted">
              {v.open[k]
                ? 'People can book on the website.'
                : `The website says booking is paused and shows your note.${since ? ` Paused ${whenLabel(since.at)} (${since.by}).` : ''}`}
            </p>
            {asking?.kind === k && (
              <div className="adm-panel" role="group" aria-label={asking.open ? `Open ${LOWER[k]}?` : `Pause ${LOWER[k]}?`}>
                <b>{asking.open ? (k === 'kits' ? 'Kits have been hidden for a while. Open them online?' : `Open ${LOWER[k]} online?`) : `Pause ${LOWER[k]}?`}</b>
                <span className="adm-small">
                  {asking.open
                    ? 'People can book on the website again within a minute.'
                    : 'People already booked keep their booking. Payment links already sent still work. The website shows your note instead.'}
                </span>
                <div className="adm-two">
                  <button type="button" className="adm-btn is-ghost" onClick={() => setAsking(null)}>{asking.open ? 'Keep it paused' : 'Keep it open'}</button>
                  <button type="button" className={asking.open ? 'adm-btn is-pri' : 'adm-btn is-danger'} disabled={locked} onClick={() => flip(k, asking.open)}>
                    {asking.open ? OPEN_LABEL[k] : PAUSE_LABEL[k]}
                  </button>
                </div>
              </div>
            )}
          </fieldset>
        )
      })}

      <p className="adm-lbl">Note while paused</p>
      <label className="adm-fld">
        <span>What customers read <span className="adm-muted">(optional)</span></span>
        <textarea
          rows={3}
          value={note}
          maxLength={v.noteMax}
          placeholder={v.defaultNote}
          aria-invalid={!!noteError || undefined}
          onChange={(e) => { setNote(e.target.value); setNoteError('') }}
        />
      </label>
      <p className="adm-small adm-muted">{`${note.trim().length} of ${v.noteMax}. Left blank, it says: “${v.defaultNote}”`}</p>
      {noteError && <p className="adm-error adm-fielderr" role="alert">{noteError}</p>}
      <button type="button" className="adm-btn is-ghost" disabled={!noteDirty || locked} onClick={saveNote}>Save note</button>

      <p className="adm-lbl">Try it while it’s paused</p>
      <p className="adm-small adm-muted">A test link opens online booking on the device you open it on, for 30 days, even while it’s paused. Bookings made with it are real ones.</p>
      <div className="adm-two adm-gap-top">
        <button type="button" className="adm-btn is-ghost" disabled={locked} onClick={() => copyLink('parties')}>Copy party test link</button>
        <button type="button" className="adm-btn is-ghost" disabled={locked} onClick={() => copyLink('workshops')}>Copy class test link</button>
      </div>
      {shown && <p className="adm-small adm-gap-top" style={{ overflowWrap: 'anywhere', userSelect: 'all' }}>{shown}</p>}
      {v.previewToken && (askNewLink ? (
        <div className="adm-panel adm-gap-top" role="group" aria-label="Make a new test link?">
          <b>Make a new test link?</b>
          <span className="adm-small">Every test link you gave out before stops working.</span>
          <div className="adm-two">
            <button type="button" className="adm-btn is-ghost" onClick={() => setAskNewLink(false)}>Keep the old one</button>
            <button type="button" className="adm-btn is-pri" disabled={locked} onClick={() => { setAskNewLink(false); void copyLink('parties', true) }}>Make a new link</button>
          </div>
        </div>
      ) : (
        <button type="button" className="adm-btn is-ghost is-sm adm-gap-top" disabled={locked} onClick={() => setAskNewLink(true)}>Make a new test link</button>
      ))}

      {v.history.length > 0 && (
        <>
          <p className="adm-lbl">Recent changes</p>
          {v.history.slice(0, 5).map((h) => (
            <div key={h.at} className="adm-kv">
              <span>{h.changed.join(', ') || 'Saved, nothing changed'}</span>
              <span className="adm-small adm-muted">{`${h.by.name}, ${whenLabel(h.at)}`}</span>
            </div>
          ))}
        </>
      )}
    </>
  )
}

/**
 * Home › a line while anything is paused online, with the button that opens
 * it again. Says nothing when all is open or it can't check.
 */
export function HomeBookingPaused({ onOpen }: { onOpen: (s: Sheet) => void }) {
  const [v, setV] = useState<OnlineBookingView | null>(null)
  useEffect(() => {
    let live = true
    api<OnlineBookingView>(ONLINE_BOOKING).then((r) => { if (live && r.ok && r.data) setV(r.data) })
    return () => { live = false }
  }, [])
  if (!v) return null
  const paused = pausedKinds(v)
  if (!paused.length) return null
  const first = pausedSince(v, paused[0])
  const names = paused.map((k) => NAME[k])
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1].toLowerCase()}`
  return (
    <div className="adm-panel is-warn adm-gap-top" role="group" aria-label="Online booking">
      <span>{`${list} are paused online${first ? ` since ${whenLabel(first.at)} (${first.by})` : ''}.`}</span>
      <button type="button" className="adm-btn is-pri is-sm" onClick={() => onOpen({ kind: 'more', page: 'booking' })}>Open online booking</button>
    </div>
  )
}
