/**
 * Owner-only screens under More › Owners and alerts:
 *   - Admin access (G4): who the owners are (the staff list's Owners) and the /admin passcode.
 *   - Notifications (G5): which owners get which alerts and reports.
 *   - Email, texts and Square (G2): is each getting through, a test for each, and what to do.
 */
import { useEffect, useRef, useState } from 'react'
import { boldParts, HELP_SECTIONS } from '@lib/admin-help'
import type { Service } from '@lib/outbound-health'
import { problemText, TestButton, useHealth } from '../HomeHealth'
import type { NotifyView, NotifyRow } from '@lib/notify-settings'
import { ADMIN_ACCESS, api, KEYS, NOTIFY } from '../classes/api'
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
  /** L1: wrong /admin passcodes typed today, across the whole site. */
  failedToday?: number
  manyFailed?: boolean
}

/** M1(c): what the passcode-changed toast ends with. */
export const PASSCODE_CHANGED_TOAST = 'The admin passcode is changed. Every other phone or iPad signed in to /admin is signed out and needs the new one. This one stays signed in. Check More › Admin access and Notifications for anything you didn’t change.'

/** "Catherine and Kaden", "Ann, Bea and Cy". */
export const andList = (list: string[]) => (list.length <= 1 ? list[0] ?? '' : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`)

/**
 * The change-the-admin-passcode form (Admin access, and Staff › People right
 * after an owner is taken off, M2). `expectedUpdatedAt`: what was loaded.
 */
export function AdminPasscodeForm({ expectedUpdatedAt, min, onDone, onCancel, onStale, onDirty }: {
  expectedUpdatedAt: string | null
  min: number
  onDone: () => void
  onCancel: () => void
  /** Someone else changed it first: reload what's shown. */
  onStale?: () => void
  onDirty?: (dirty: boolean) => void
}) {
  const toast = useToast()
  const [current, setCurrent] = useState('')
  const [code, setCode] = useState('')
  const [again, setAgain] = useState('')
  const [show, setShow] = useState(false)
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)
  const live = useRef(true)
  useEffect(() => () => { live.current = false }, [])
  const dirty = current !== '' || code !== '' || again !== ''
  useEffect(() => { onDirty?.(dirty) }, [dirty])

  async function save() {
    if (busy) return
    if (!current) return setFormError('Type the passcode you use now first.')
    setBusy(true)
    const r = await api<{ updatedAt: string }>(ADMIN_ACCESS, { current, passcode: code, again, expectedUpdatedAt })
    if (!live.current) return
    setBusy(false)
    if (r.ok) {
      toast(PASSCODE_CHANGED_TOAST)
      onDirty?.(false)
      onDone()
      return
    }
    setFormError(r.error ?? DIDNT_SAVE)
    if (r.status === 409) onStale?.()
  }

  return (
    <div className="adm-panel adm-gap-top" role="group" aria-label="Change the admin passcode">
      <b>Change the admin passcode</b>
      <span className="adm-small">Every other phone or iPad signed in to /admin is signed out and needs the new one. This one stays signed in.</span>
      <span className="adm-small">{`Use at least ${min} letters or numbers, with no space at the start or end, and not the staff passcode. Write it somewhere safe: nobody can look it up later.`}</span>
      <label className="adm-fld"><span>Passcode you use now</span><input type={show ? 'text' : 'password'} value={current} autoComplete="current-password" maxLength={64} onChange={(e) => { setCurrent(e.target.value); setFormError('') }} /></label>
      <label className="adm-fld"><span>New passcode</span><input type={show ? 'text' : 'password'} value={code} autoComplete="new-password" maxLength={64} onChange={(e) => { setCode(e.target.value); setFormError('') }} /></label>
      <label className="adm-fld"><span>New passcode again</span><input type={show ? 'text' : 'password'} value={again} autoComplete="new-password" maxLength={64} onChange={(e) => { setAgain(e.target.value); setFormError('') }} /></label>
      <button type="button" className="adm-btn is-ghost is-sm" aria-pressed={show} onClick={() => setShow(!show)}>{show ? 'Hide passcodes' : 'Show passcodes'}</button>
      {formError && <p className="adm-error" role="alert">{formError}</p>}
      <div className="adm-two">
        <button type="button" className="adm-btn is-ghost" onClick={() => { onDirty?.(false); onCancel() }}>Cancel</button>
        <button type="button" className="adm-btn is-pri" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save new admin passcode'}</button>
      </div>
    </div>
  )
}

/**
 * M2: shown in Staff › People right after an owner is taken off (made Crew or
 * No longer working here). Their phone may still be signed in to /admin, so
 * it offers the passcode change right there.
 */
export function OwnerRemovedPrompt({ name, onClose }: { name: string; onClose: () => void }) {
  const [form, setForm] = useState(false)
  const [view, setView] = useState<AccessView | null>(null)
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)
  useSheetDirty(dirty)
  async function openForm() {
    setError('')
    const r = await api<AccessView>(ADMIN_ACCESS)
    if (r.ok && r.data) { setView(r.data); setForm(true) }
    else setError(r.error ?? 'Couldn’t check admin access.')
  }
  return (
    <div className="adm-panel is-warn adm-gap-bottom" role="group" aria-label="Change the admin passcode now?">
      <b>Change the admin passcode now?</b>
      <span className="adm-small">{`${name}’s phone may still be signed in to /admin. Changing the admin passcode signs every other phone and iPad out.`}</span>
      {error && <p className="adm-error" role="alert">{error}</p>}
      {!form ? (
        <div className="adm-two">
          <button type="button" className="adm-btn is-ghost" onClick={onClose}>Not now</button>
          <button type="button" className="adm-btn is-pri" onClick={openForm}>Change it now</button>
        </div>
      ) : view && (
        view.readOnly
          ? <p className="adm-note">This test site can’t change the live admin passcode.</p>
          : <AdminPasscodeForm expectedUpdatedAt={view.updatedAt} min={view.min} onDirty={setDirty} onDone={onClose} onCancel={onClose} />
      )}
    </div>
  )
}

export function AdminAccessSheet() {
  const sheet = useSheet()
  const [view, setView] = useState<AccessView | null>(null)
  const [error, setError] = useState('')
  const [tries, setTries] = useState(0)
  const [open, setOpen] = useState(false)
  const [dirty, setDirty] = useState(false)
  useSheetDirty(open && dirty)

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
            {view.manyFailed && (
              <p className="adm-panel is-warn" role="alert">{`Someone typed a wrong /admin passcode ${view.failedToday} times today. If that wasn’t one of you, change the admin passcode now.`}</p>
            )}
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
              <AdminPasscodeForm expectedUpdatedAt={view.updatedAt} min={view.min} onDirty={setDirty} onDone={() => { setOpen(false); setTries((n) => n + 1) }} onStale={() => setTries((n) => n + 1)} onCancel={() => setOpen(false)} />
            )}
          </section>
        </>
      )}
    </SheetFrame>
  )
}

// ── More › Notifications (G5) ─────────────────────────────────────────────

const ROW_WHAT: Record<NotifyRow, string> = {
  'owner-texts': 'A text when something needs you: a payment problem, a request, a class short of its minimum.',
  'booking-alerts': 'A text and an email each time someone books and pays.',
  'warnings-email': 'The morning warnings email, incident reports, and emails about problems or forms sent in.',
  'tax-report': 'On the 1st, last month’s tax split for the tax return.',
  archive: 'Every Sunday, a copy of every waiver, check-in and incident record. Keep these emails.',
}

type Picks = Record<NotifyRow, string[]>
const picksOf = (v: NotifyView): Picks => Object.fromEntries(v.rows.map((r) => [r.row, r.picked])) as Picks
const samePicks = (a: Picks, b: Picks) => Object.keys(a).every((k) => [...a[k as NotifyRow]].sort().join() === [...(b[k as NotifyRow] ?? [])].sort().join())

export function NotifySheet() {
  const toast = useToast()
  const sheet = useSheet()
  const [view, setView] = useState<(NotifyView & { readOnly: boolean }) | null>(null)
  const [picks, setPicks] = useState<Picks | null>(null)
  const [error, setError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [tries, setTries] = useState(0)
  const [busy, setBusy] = useState(false)
  const live = useRef(true)
  useEffect(() => () => { live.current = false }, [])

  useEffect(() => {
    let on = true
    setError('')
    api<NotifyView & { readOnly: boolean }>(NOTIFY).then((r) => {
      if (!on) return
      if (r.ok && r.data) { setView(r.data); setPicks(picksOf(r.data)) }
      else setError(r.error ?? 'Couldn’t load the notifications.')
    })
    return () => { on = false }
  }, [tries])

  const dirty = !!view && !!picks && !samePicks(picks, picksOf(view))
  useSheetDirty(dirty)

  function toggle(row: NotifyRow, id: string) {
    setSaveError('')
    setPicks((p) => (p ? { ...p, [row]: p[row].includes(id) ? p[row].filter((x) => x !== id) : [...p[row], id] } : p))
  }

  async function save() {
    if (!view || !picks || busy) return
    setBusy(true)
    const r = await api<{ updatedAt: string; changed: string[] }>(NOTIFY, { rows: picks, expectedUpdatedAt: view.updatedAt })
    if (!live.current) return
    setBusy(false)
    if (r.ok && r.data) {
      toast(r.data.changed.length ? `Saved. Changed: ${r.data.changed.join(', ')}. Everything else stays as it was.` : 'Saved. Nothing changed.')
      setTries((n) => n + 1)
      return
    }
    setSaveError(r.error ?? DIDNT_SAVE)
    if (r.status === 409) setTries((n) => n + 1)
  }

  const goes = (list: string[] | undefined) => (list && list.length ? list.join(', ') : 'nobody yet')
  return (
    <SheetFrame
      title="Notifications"
      subtitle="Which owners get which alerts and reports"
      footer={view && !view.noList && !view.readOnly
        ? <button type="button" className="adm-btn is-pri" disabled={!dirty || busy} onClick={save}>{busy ? 'Saving…' : 'Save notifications'}</button>
        : undefined}
    >
      {error && <Failed message={error} onRetry={() => setTries((n) => n + 1)} />}
      {!error && !view && <Skeleton rows={4} label="Loading the notifications" />}
      {view && picks && (
        <>
          <p className="adm-note">
            {view.noList
              ? 'Start the staff list in Staff › People first, so there are owners to pick. Until then everything goes where it always has, shown below.'
              : view.saved && view.updatedAt
              ? `Changed here${view.by ? ` by ${view.by}` : ''} ${dayAndClock(view.updatedAt)}. Emails and texts go to each owner’s email and mobile in Staff › People.`
              : 'Nothing is set here yet, so everything goes where the site was set up to send it (shown under each). Tick who should get each one, then save.'}
          </p>
          {view.readOnly && <p className="adm-note">This test site can’t change the live notifications.</p>}
          {view.rows.map((r) => (
            <fieldset key={r.row} className="adm-card adm-gap-top" aria-label={r.label}>
              <legend className="adm-dark"><b>{r.label}</b></legend>
              <span className="adm-small adm-muted">{ROW_WHAT[r.row]}</span>
              {!view.noList && view.owners.map((o) => {
                const missing = r.channels.includes('email') && !o.email ? 'no email in Staff › People' : r.channels.includes('text') && !o.phone ? 'no mobile in Staff › People' : ''
                return (
                  <label key={o.id} className="adm-check">
                    <input type="checkbox" checked={picks[r.row].includes(o.id)} disabled={view.readOnly} onChange={() => toggle(r.row, o.id)} />
                    <span>{o.name}{missing && <small className="adm-muted">{` · ${missing}`}</small>}</span>
                  </label>
                )
              })}
              {r.channels.includes('email') && (
                <span className="adm-small">{`Emails go to ${goes(r.goesTo.email)}${r.from.email === 'setup' ? ' (from the site setup)' : ''}.`}</span>
              )}
              {(r.held ?? []).map((h) => (
                <span key={h.name} className="adm-small">{`${h.name} starts getting this ${dayAndClock(h.until)}. A new owner or a new email waits a day, so nobody can quietly send the records somewhere new.`}</span>
              ))}
              {r.channels.includes('text') && (
                <span className="adm-small">{`Texts go to ${r.goesTo.text?.length ? r.goesTo.text.map((t) => `the phone ending ${t.replace('…', '')}`).join(', ') : 'nobody yet: add a mobile in Staff › People'}${r.goesTo.text?.length && r.from.text === 'setup' ? ' (from the site setup)' : ''}.`}</span>
              )}
            </fieldset>
          ))}
          {saveError && <p className="adm-error" role="alert">{saveError}</p>}
          <p className="adm-small adm-muted adm-gap-top">What’s shown is what’s saved. Changes count from the next message.</p>
          <div className="adm-two">
            <button type="button" className="adm-btn is-ghost" onClick={() => sheet.open({ kind: 'more', page: 'staff' }, { part: 'people' })}>Edit emails and mobiles</button>
            <button type="button" className="adm-btn is-ghost" onClick={() => sheet.open({ kind: 'more', page: 'connections' })}>Check emails and texts</button>
          </div>
        </>
      )}
    </SheetFrame>
  )
}

// ── More › Email, texts and Square (G2) ───────────────────────────────────

const SERVICE_TITLE: Record<Service, string> = { email: 'Emails', text: 'Texts', square: 'Square' }
const SERVICE_WHAT: Record<Service, string> = {
  email: 'Sent from the studio’s Google account: confirmations, payment links, refund emails, the morning email.',
  text: 'Sent from the studio number through Quo: owner alerts, pickup codes, payment links by text.',
  square: 'Online payments, refunds, and reading bookings and the register.',
}
const SERVICE_HELP: Record<Service, string> = { email: 'email-broken', text: 'texts-broken', square: 'square-broken' }

function HelpText({ text }: { text: string }) {
  return <>{boldParts(text).map((part, i) => (i % 2 ? <b key={i} className="adm-dark">{part}</b> : <span key={i}>{part}</span>))}</>
}

interface KeyState { setInAdmin: boolean; updatedAt: string | null; by: string | null; broken: boolean }
interface KeysView { gmail: KeyState; quo: KeyState; canStore: boolean; gmailUser: string | null; quoFromLast4: string | null; readOnly: boolean; muted: boolean }

const KEY_TITLE: Record<'gmail' | 'quo', string> = { gmail: 'Paste a new Gmail app password', quo: 'Paste a new Quo key' }

/**
 * Paste a new Gmail app password or Quo key (never the Square token): Test it
 * (a real login and a test message to your own email or mobile), then the
 * admin passcode and Save it. Never shown back after saving.
 */
export function KeyPaste({ service, keys, onSaved }: { service: 'gmail' | 'quo'; keys: KeysView; onSaved: () => void }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [current, setCurrent] = useState('')
  const [tested, setTested] = useState<{ ok: boolean; text: string } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [removing, setRemoving] = useState(false)
  useSheetDirty((open || removing) && (value !== '' || current !== ''))
  const st = keys[service]
  const label = service === 'gmail' ? 'Gmail app password' : 'Quo key'

  function close() { setOpen(false); setRemoving(false); setValue(''); setCurrent(''); setTested(null); setError('') }

  async function test() {
    if (busy) return
    setBusy('test'); setError(''); setTested(null)
    const r = await api<{ ok: boolean; message: string }>(KEYS, { action: 'test', service, value })
    setBusy('')
    if (r.ok && r.data) setTested({ ok: r.data.ok, text: r.data.message })
    else setError(r.error ?? DIDNT_SAVE)
  }
  async function save() {
    if (busy) return
    if (!current) return setError('Type the admin passcode you use now first.')
    setBusy('save'); setError('')
    const r = await api<{ updatedAt: string }>(KEYS, { action: 'save', service, value, current })
    setBusy('')
    if (r.ok) {
      toast(`Saved. ${service === 'gmail' ? 'Emails' : 'Texts'} now go out with the new ${label}. Every owner got an email and a text saying so.`)
      close()
      onSaved()
      return
    }
    setError(r.error ?? DIDNT_SAVE)
  }
  async function remove() {
    if (busy) return
    if (!current) return setError('Type the admin passcode you use now first.')
    setBusy('remove'); setError('')
    const r = await api<{ removed: boolean }>(KEYS, { action: 'remove', service, current })
    setBusy('')
    if (r.ok) {
      toast(`Done. ${service === 'gmail' ? 'Emails' : 'Texts'} now use the ${label} in the hosting settings. Every owner got an email and a text saying so.`)
      close()
      onSaved()
      return
    }
    setError(r.error ?? DIDNT_SAVE)
  }

  return (
    <div className="adm-gap-top">
      {st.setInAdmin && !st.broken && st.updatedAt && <span className="adm-small adm-muted">{`The ${label} was pasted here${st.by ? ` by ${st.by}` : ''} ${dayAndClock(st.updatedAt)}. It’s never shown again.`}</span>}
      {st.broken && <p className="adm-panel is-warn" role="alert">{`The ${label} saved here can’t be read, so the one from the site setup is in use. Paste a new one below.`}</p>}
      {st.setInAdmin && keys.canStore && !keys.readOnly && !open && (
        !removing ? (
          <button type="button" className="adm-btn is-ghost" onClick={() => { setRemoving(true); setError('') }}>Use the hosting setting instead</button>
        ) : (
          <div className="adm-panel" role="group" aria-label="Use the hosting setting instead">
            <b>Use the hosting setting instead</b>
            <span className="adm-small">{`This forgets the ${label} pasted here, so the one in the hosting settings is used again. Every owner gets an email and a text saying so.`}</span>
            <label className="adm-fld"><span>Admin passcode you use now</span><input type="password" value={current} autoComplete="current-password" maxLength={64} onChange={(e) => { setCurrent(e.target.value); setError('') }} /></label>
            {error && <p className="adm-error" role="alert">{error}</p>}
            <div className="adm-two">
              <button type="button" className="adm-btn is-ghost" onClick={close}>Cancel</button>
              <button type="button" className="adm-btn is-pri" disabled={!current || !!busy} onClick={remove}>{busy === 'remove' ? 'Switching…' : 'Use the hosting setting'}</button>
            </div>
          </div>
        )
      )}
      {!keys.canStore ? (
        <span className="adm-small adm-muted">{`This site can’t keep a ${label} safely (a setting is missing), so use the steps under What to do.`}</span>
      ) : keys.readOnly ? (
        <span className="adm-small adm-muted">This test site can’t change the live site’s keys.</span>
      ) : removing ? null : !open ? (
        <button type="button" className="adm-btn is-ghost" onClick={() => setOpen(true)}>{KEY_TITLE[service]}</button>
      ) : (
        <div className="adm-panel" role="group" aria-label={KEY_TITLE[service]}>
          <b>{KEY_TITLE[service]}</b>
          <span className="adm-small">
            {service === 'gmail'
              ? `For the studio’s Google account${keys.gmailUser ? ` (${keys.gmailUser})` : ''}. Make it under What to do, then paste the 16 letters here.`
              : `From the studio’s Quo account (the number ending ${keys.quoFromLast4 ?? '…'}). Make it under What to do, then paste it here.`}
          </span>
          <label className="adm-fld"><span>{`New ${label}`}</span><input type="password" value={value} autoComplete="off" spellCheck={false} maxLength={200} onChange={(e) => { setValue(e.target.value); setTested(null); setError('') }} /></label>
          <button type="button" className="adm-btn is-ghost" disabled={!value || !!busy} onClick={test}>{busy === 'test' ? 'Testing…' : 'Test it'}</button>
          <span className="adm-small adm-muted">{service === 'gmail' ? 'Test it signs in to Google with it and sends a test email to your own email in Staff › People.' : 'Test it checks the key belongs to the studio’s number and sends a test text to your own mobile in Staff › People.'}</span>
          {tested && <p role={tested.ok ? 'status' : 'alert'} className={tested.ok ? 'adm-small' : 'adm-error'}>{tested.text}</p>}
          {tested?.ok && (
            <label className="adm-fld"><span>Admin passcode you use now</span><input type="password" value={current} autoComplete="current-password" maxLength={64} onChange={(e) => { setCurrent(e.target.value); setError('') }} /></label>
          )}
          {error && <p className="adm-error" role="alert">{error}</p>}
          <div className="adm-two">
            <button type="button" className="adm-btn is-ghost" onClick={close}>Cancel</button>
            <button type="button" className="adm-btn is-pri" disabled={!tested?.ok || !!busy} onClick={save}>{busy === 'save' ? 'Saving…' : 'Save it'}</button>
          </div>
        </div>
      )}
    </div>
  )
}

export function ConnectionsSheet() {
  const { data } = useSheet()
  const focus = data && typeof data === 'object' ? (data as { focus?: Service }).focus : undefined
  const { view, reload } = useHealth()
  const [keys, setKeys] = useState<KeysView | null>(null)
  const [keyTries, setKeyTries] = useState(0)
  useEffect(() => {
    let on = true
    api<KeysView>(KEYS).then((r) => { if (on && r.ok && r.data) setKeys(r.data) })
    return () => { on = false }
  }, [keyTries])
  const focused = useRef<HTMLElement | null>(null)
  useEffect(() => { if (view && focus) focused.current?.scrollIntoView?.({ block: 'start' }) }, [view, focus])
  return (
    <SheetFrame tall title="Email, texts and Square" subtitle="Is each one getting through, and what to do if not">
      {!view && <Skeleton rows={3} label="Checking emails, texts and Square" />}
      {view && (
        <>
          <p className="adm-note">Tests go to your own email and mobile in Staff › People.{view.muted ? ' This is a test site, so no emails or texts go out here (they’re listed in More › Messages).' : view.testSite ? ' This is a test site, so they go to the test inbox and phone instead.' : ''} A test that goes through clears the warning.</p>
          {(['email', 'text', 'square'] as Service[]).map((s) => {
            const h = view[s]
            const help = HELP_SECTIONS.find((x) => x.id === SERVICE_HELP[s])
            const broken = h.state === 'failing' || h.state === 'not-set'
            return (
              <section key={s} ref={focus === s ? (el) => { focused.current = el } : undefined} className={`adm-card adm-gap-top${broken ? ' is-warn' : ''}`} aria-label={SERVICE_TITLE[s]}>
                <b className="adm-dark">{SERVICE_TITLE[s]}</b>
                <span className="adm-small adm-muted">{SERVICE_WHAT[s]}</span>
                <span role={broken ? 'alert' : undefined}>
                  {broken ? problemText(s, h) : h.state === 'unknown' ? 'Couldn’t check just now.' : h.lastOkAt ? `Working. Last trouble cleared ${dayAndClock(h.lastOkAt)}.` : 'Working: nothing has failed lately.'}
                </span>
                {h.state !== 'not-set' && <TestButton service={s} primary={broken} onDone={reload} />}
                {s !== 'square' && keys && <KeyPaste service={s === 'email' ? 'gmail' : 'quo'} keys={keys} onSaved={() => { setKeyTries((n) => n + 1); reload() }} />}
                {help && (
                  <details className="adm-fold-group adm-help-fold" open={focus === s || broken}>
                    <summary><span>What to do if it stops</span><i className="adm-chevron" aria-hidden="true" /></summary>
                    {help.intro && <p className="adm-small adm-muted">{help.intro}</p>}
                    <ol className="adm-help-list">{help.points.map((p, i) => <li key={i}><HelpText text={p} /></li>)}</ol>
                  </details>
                )}
              </section>
            )
          })}
        </>
      )}
    </SheetFrame>
  )
}
