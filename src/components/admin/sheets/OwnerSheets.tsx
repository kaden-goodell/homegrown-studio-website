/**
 * More › Admin access (G4): who the owners are (the staff list's Owners) and
 * the /admin passcode.
 */
import { useEffect, useRef, useState } from 'react'
import { ADMIN_ACCESS, api } from '../classes/api'
import { Failed, Skeleton } from '../shell/items'
import { SheetFrame, useSheet, useSheetDirty } from '../shell/Sheet'
import { dayAndClock } from '../shell/time'
import { DIDNT_SAVE, useToast } from '../shell/Toast'

export interface AccessView {
  setInAdmin: boolean
  updatedAt: string | null
  by: string | null
  damaged: boolean
  /** A new passcode in the site setup took over (the forgot-it way back) until a new one is saved here. */
  settingTookOver: boolean
  readOnly: boolean
  min: number
  owners: { id: string | null; name: string; hasEmail: boolean; hasPhone: boolean }[]
  ownerSource: 'staff-list' | 'bootstrap'
}

/** "Catherine and Kaden", "Ann, Bea and Cy". */
export const andList = (list: string[]) => (list.length <= 1 ? list[0] ?? '' : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`)

export function AdminAccessSheet() {
  const sheet = useSheet()
  const toast = useToast()
  const [view, setView] = useState<AccessView | null>(null)
  const [error, setError] = useState('')
  const [tries, setTries] = useState(0)
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState('')
  const [code, setCode] = useState('')
  const [again, setAgain] = useState('')
  const [show, setShow] = useState(false)
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)
  const live = useRef(true)
  useEffect(() => () => { live.current = false }, [])
  useSheetDirty(open && (current !== '' || code !== '' || again !== ''))

  useEffect(() => {
    let on = true
    setError('')
    api<AccessView>(ADMIN_ACCESS).then((r) => {
      if (!on) return
      if (r.ok && r.data) setView(r.data)
      else setError(r.error ?? 'Couldn’t check admin access.')
    })
    return () => { on = false }
  }, [tries])

  function close() {
    setOpen(false)
    setCurrent('')
    setCode('')
    setAgain('')
    setFormError('')
  }

  async function save() {
    if (busy || !view) return
    if (!current) return setFormError('Type the passcode you use now first.')
    setBusy(true)
    const r = await api<{ updatedAt: string }>(ADMIN_ACCESS, { current, passcode: code, again, expectedUpdatedAt: view.updatedAt })
    if (!live.current) return
    setBusy(false)
    if (r.ok) {
      toast('The admin passcode is changed. Every other phone or iPad signed in to /admin is signed out and needs the new one. This one stays signed in.')
      close()
      setTries((n) => n + 1)
      return
    }
    setFormError(r.error ?? DIDNT_SAVE)
    if (r.status === 409) setTries((n) => n + 1)
  }

  const names = view ? view.owners.map((o) => o.name) : []
  return (
    <SheetFrame title="Admin access" subtitle="Who the owners are, and the /admin passcode">
      {error && <Failed message={error} onRetry={() => setTries((n) => n + 1)} />}
      {!error && !view && <Skeleton rows={3} label="Checking admin access" />}
      {view && (
        <>
          <section aria-label="Owners">
            <p className="adm-lbl">Owners</p>
            <ul className="adm-plain">
              {view.owners.map((o) => (
                <li key={o.name} className="adm-card">
                  <b className="adm-dark">{o.name}</b>
                  <span className="adm-small adm-muted">
                    {view.ownerSource === 'bootstrap'
                      ? 'Owner'
                      : [o.hasEmail ? 'email on file' : 'no email yet', o.hasPhone ? 'mobile on file' : 'no mobile yet'].join(' · ')}
                  </span>
                </li>
              ))}
            </ul>
            <p className="adm-small">
              {view.ownerSource === 'bootstrap'
                ? `The staff list isn’t started yet, so the owners are ${andList(names)}.`
                : `The owners are the people marked Owner in Staff › People. Each one can pick their name under “Who’s using this?”, and gets the alerts picked for them in Notifications.`}
            </p>
            <p className="adm-small adm-muted">To add an owner, open Staff › People and add them (or edit them) as Owner. To take someone off, edit them to Crew or mark them No longer working here. There’s always at least one owner. Anyone who knows the admin passcode can sign in, so change it when an owner leaves.</p>
            <button type="button" className="adm-btn is-ghost" onClick={() => sheet.open({ kind: 'more', page: 'staff' }, { part: 'people' })}>Change who’s an owner</button>
          </section>

          <section aria-label="Admin passcode" className="adm-gap-top">
            <p className="adm-lbl">Admin passcode</p>
            {view.damaged && (
              <p className="adm-panel is-warn" role="alert">The saved admin passcode couldn’t be read. Set a new one below to fix it.</p>
            )}
            {view.settingTookOver && !view.damaged && (
              <p className="adm-panel is-warn" role="alert">The passcode from the site setup is in use, because it was changed after the one saved here. Set a new admin passcode below, and this screen decides it again.</p>
            )}
            <p className="adm-small">
              {view.setInAdmin && view.updatedAt && !view.settingTookOver
                ? `Changed here${view.by ? ` by ${view.by}` : ''} ${dayAndClock(view.updatedAt)}. It’s never shown again after it’s saved.`
                : 'This is the passcode for /admin. Change it any time, for example after a phone is lost or someone else saw it.'}
            </p>
            {view.readOnly && <p className="adm-note">This test site can’t change the live admin passcode.</p>}
            {!open ? (
              <button type="button" className="adm-btn is-ghost" disabled={view.readOnly} onClick={() => setOpen(true)}>Change the admin passcode</button>
            ) : (
              <div className="adm-panel adm-gap-top" role="group" aria-label="Change the admin passcode">
                <b>Change the admin passcode</b>
                <span className="adm-small">Every other phone or iPad signed in to /admin is signed out and needs the new one. This one stays signed in.</span>
                <span className="adm-small">{`Use at least ${view.min} letters or numbers, and not the staff passcode. Write it somewhere safe: nobody can look it up later.`}</span>
                <label className="adm-fld"><span>Passcode you use now</span><input type={show ? 'text' : 'password'} value={current} autoComplete="current-password" maxLength={64} onChange={(e) => { setCurrent(e.target.value); setFormError('') }} /></label>
                <label className="adm-fld"><span>New passcode</span><input type={show ? 'text' : 'password'} value={code} autoComplete="new-password" maxLength={64} onChange={(e) => { setCode(e.target.value); setFormError('') }} /></label>
                <label className="adm-fld"><span>New passcode again</span><input type={show ? 'text' : 'password'} value={again} autoComplete="new-password" maxLength={64} onChange={(e) => { setAgain(e.target.value); setFormError('') }} /></label>
                <button type="button" className="adm-btn is-ghost is-sm" aria-pressed={show} onClick={() => setShow(!show)}>{show ? 'Hide passcodes' : 'Show passcodes'}</button>
                {formError && <p className="adm-error" role="alert">{formError}</p>}
                <div className="adm-two">
                  <button type="button" className="adm-btn is-ghost" onClick={close}>Cancel</button>
                  <button type="button" className="adm-btn is-pri" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save new admin passcode'}</button>
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </SheetFrame>
  )
}
