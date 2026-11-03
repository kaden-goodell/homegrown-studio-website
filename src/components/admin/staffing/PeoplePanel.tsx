/**
 * More › Staff › People (D5): our own staff list. Add someone, Edit (name,
 * Owner or Crew, phone, email), No longer working here (kept for the record:
 * they leave every list, their calendar link stops, nothing is deleted) and
 * Working here again. Each person's calendar link: whether they have one,
 * when a phone last checked it, and Stop their calendar link. Every
 * are-you-sure is asked here, never in a browser pop-up.
 *
 * Staff passcode (bus factor): an owner sets a new /staff passcode here. It
 * is never shown back, and saving it signs everyone out of /staff. It shows
 * even while the staff list is loading or can't be read (S2): that is when
 * the passcode is the only lock left.
 *
 * On a test site that shares the live stores (R41) every change button is
 * off, with a sentence saying why (m6).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { api } from '../classes/api'
import { dayAndClock } from '../shell/time'
import { Failed, Seg, Skeleton } from '../shell/items'
import { useSheetDirty } from '../shell/Sheet'
import { DIDNT_SAVE, useToast } from '../shell/Toast'
import { useRefresh } from '../shell/data'
import { OWNER_FEED, PEOPLE, PASSCODE, phoneWords } from './api'
import { ContactRow } from './StaffRow'
import { OwnerRemovedPrompt } from '../sheets/OwnerSheets'

export interface PersonView {
  id: string
  name: string
  givenName: string
  familyName: string
  role: 'owner' | 'crew'
  phone: string | null
  email: string | null
  active: boolean
  leftAt: string | null
  updatedAt: string
  feed: { has: boolean; createdAt: string | null; lastUsedAt: string | null } | null
}

interface Form { givenName: string; familyName: string; role: 'owner' | 'crew'; phone: string; email: string }
const EMPTY: Form = { givenName: '', familyName: '', role: 'crew', phone: '', email: '' }
const formOf = (p: PersonView): Form => ({ givenName: p.givenName, familyName: p.familyName, role: p.role, phone: phoneWords(p.phone), email: p.email ?? '' })
const full = (p: { givenName: string; familyName: string }) => `${p.givenName} ${p.familyName}`.trim()

type Confirm = null | { kind: 'leave' | 'stop-link'; id: string }

/** `focusPasscode`: opened from Home's "Change the staff passcode": scroll to it with the form open. */
export function PeoplePanel({ focusPasscode = false }: { focusPasscode?: boolean } = {}) {
  const toast = useToast()
  const { bump } = useRefresh()
  const [people, setPeople] = useState<PersonView[] | null>(null)
  const [saved, setSaved] = useState(true)
  const [readOnly, setReadOnly] = useState(false)
  const [error, setError] = useState('')
  const [canStartFresh, setCanStartFresh] = useState(false)
  const [tries, setTries] = useState(0)
  const [editing, setEditing] = useState<null | 'new' | string>(null)
  const [form, setForm] = useState<Form>(EMPTY)
  const [base, setBase] = useState<Form>(EMPTY)
  const [formError, setFormError] = useState<{ text: string; field: string | null } | null>(null)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [freshAsk, setFreshAsk] = useState(false)
  const [busy, setBusy] = useState('')
  /** M2: an owner was just taken off; offer to change the admin passcode. */
  const [ownerGone, setOwnerGone] = useState<string | null>(null)
  const live = useRef(true)
  useEffect(() => () => { live.current = false }, [])
  const [passDirty, setPassDirty] = useState(false)
  useSheetDirty((editing !== null && JSON.stringify(form) !== JSON.stringify(base)) || passDirty)

  useEffect(() => {
    let current = true
    setError('')
    api<{ people: PersonView[]; saved: boolean; readOnly?: boolean }>(PEOPLE).then((r) => {
      if (!current) return
      if (r.ok && r.data) { setPeople(r.data.people); setSaved(r.data.saved); setReadOnly(r.data.readOnly === true); setCanStartFresh(false) }
      else { setError(r.error ?? 'Couldn’t read the staff list.'); setCanStartFresh(r.extra.canStartFresh === true) }
    })
    return () => { current = false }
  }, [tries])

  const reload = () => setTries((n) => n + 1)

  function startEdit(target: 'new' | PersonView) {
    const f = target === 'new' ? EMPTY : formOf(target)
    setEditing(target === 'new' ? 'new' : target.id)
    setForm(f)
    setBase(f)
    setFormError(null)
    setConfirm(null)
  }

  async function save() {
    if (busy) return
    setBusy('save')
    const person = editing && editing !== 'new' ? people?.find((p) => p.id === editing) : null
    const body = editing === 'new' ? { action: 'add', ...form } : { action: 'edit', id: editing, ...form, expectedUpdatedAt: person?.updatedAt }
    const r = await api<{ person: PersonView }>(PEOPLE, body)
    if (!live.current) return
    setBusy('')
    if (r.ok && r.data) {
      toast(editing === 'new' ? `${full(form)} is on the staff list.` : 'Saved.')
      if (person && person.role === 'owner' && form.role !== 'owner') setOwnerGone(person.name)
      setEditing(null)
      bump()
      reload()
      return
    }
    if (r.status === 409 && r.extra.current) {
      const cur = r.extra.current as PersonView
      setPeople((list) => list && list.map((p) => (p.id === cur.id ? { ...p, ...cur } : p)))
      const f = formOf({ ...person!, ...cur })
      setForm(f)
      setBase(f)
    }
    setFormError({ text: r.error ?? DIDNT_SAVE, field: typeof r.extra.field === 'string' ? r.extra.field : null })
  }

  async function setWorking(p: PersonView, active: boolean) {
    if (busy) return
    setBusy(`work-${p.id}`)
    const r = await api<{ person: PersonView }>(PEOPLE, { action: active ? 'return' : 'leave', id: p.id })
    if (!live.current) return
    setBusy('')
    setConfirm(null)
    if (!r.ok) { toast(r.error ?? DIDNT_SAVE); return }
    const done = active ? `${p.name} is working here again.` : `${p.name} is no longer on the staff list.`
    toast(r.warning ? `${done} ${r.warning}` : done)
    if (!active && p.role === 'owner') setOwnerGone(p.name)
    bump()
    reload()
  }

  async function stopLink(p: PersonView) {
    if (busy) return
    setBusy(`link-${p.id}`)
    const r = await api(OWNER_FEED, { staffId: p.id }, 'DELETE')
    if (!live.current) return
    setBusy('')
    setConfirm(null)
    if (!r.ok) { toast(r.error ?? DIDNT_SAVE); return }
    toast(`${p.name}’s calendar link is stopped. ${p.name} can make a new one in /staff, My shifts.`)
    reload()
  }

  async function startListFresh() {
    if (busy) return
    setBusy('fresh')
    const r = await api(PEOPLE, { action: 'start-fresh' })
    if (!live.current) return
    setBusy('')
    setFreshAsk(false)
    if (!r.ok) { toast(r.error ?? DIDNT_SAVE); return }
    toast('The staff list is started. Add everyone else with Add someone.')
    bump()
    reload()
  }

  const passcode = <PasscodePanel onDirty={setPassDirty} focus={focusPasscode} />

  // The passcode panel sits at the same place in every state (loading, failed, loaded), so it never reloads or loses typing.
  const frame = (body: ReactNode) => <section aria-label="People"><div>{body}</div>{passcode}</section>

  if (error) {
    return frame(
      <>
        <Failed message={error} onRetry={reload} />
        {canStartFresh && (
          <div className="adm-panel adm-gap-top">
            <b>Still not working?</b>
            <span className="adm-small">You can start the staff list with just the owners, then add everyone else by hand. Anything already saved for your team, like who’s on a shift or a calendar link, won’t carry over to the new list.</span>
            {!freshAsk
              ? <button type="button" className="adm-btn is-ghost" onClick={() => setFreshAsk(true)}>Start the list with just the owners</button>
              : (
                <div className="adm-two">
                  <button type="button" className="adm-btn is-ghost" onClick={() => setFreshAsk(false)}>Not now</button>
                  <button type="button" className="adm-btn is-pri" disabled={busy === 'fresh'} onClick={startListFresh}>{busy === 'fresh' ? 'Starting…' : 'Yes, start it'}</button>
                </div>
              )}
          </div>
        )}
      </>,
    )
  }
  if (!people) return frame(<Skeleton rows={3} label="Loading the staff list" />)

  /** Nothing on the list can be changed here (a test site). */
  const locked = !saved || readOnly

  const working = people.filter((p) => p.active)
  const left = people.filter((p) => !p.active)
  const editForm = (
    <PersonForm
      form={form}
      error={formError}
      busy={busy === 'save'}
      title={editing === 'new' ? 'Add someone' : `Edit ${full(base)}`}
      onChange={(f) => { setForm(f); setFormError(null) }}
      onSave={save}
      onCancel={() => { setEditing(null); setFormError(null) }}
    />
  )

  return frame(
    <>
      {ownerGone && <OwnerRemovedPrompt name={ownerGone} onClose={() => setOwnerGone(null)} />}
      {readOnly
        ? <p className="adm-note">This is a test site, and it shares the live staff list. So nothing on the list can be changed here. Make changes on the live site.</p>
        : !saved && <p className="adm-note">This test site shows the team read only. Changes are made on the live site.</p>}
      {editing === 'new' ? editForm : (
        <button type="button" className="adm-btn is-pri adm-gap-bottom" disabled={locked} onClick={() => startEdit('new')}>+ Add someone</button>
      )}
      <p className="adm-lbl">{`Working here (${working.length})`}</p>
      <ul className="adm-plain" aria-label="Working here">
        {working.map((p) => (
          <li key={p.id} className="adm-person">
            {editing === p.id ? editForm : (
              <>
                <div className="adm-person-top">
                  <div className="adm-rm">
                    <b>{full(p)}<span className="adm-tag is-grey">{p.role === 'owner' ? 'Owner' : 'Crew'}</span></b>
                    <small>{[phoneWords(p.phone) || 'No phone saved', p.email || 'No email saved'].join(' · ')}</small>
                    <small>{linkWords(p)}</small>
                  </div>
                  <button type="button" className="adm-btn is-ghost is-sm" disabled={locked || !!busy} onClick={() => startEdit(p)}>Edit</button>
                </div>
                {p.phone && <ContactRow name={p.givenName} phone={p.phone} />}
                {confirm?.id === p.id && confirm.kind === 'leave' && (
                  <div className="adm-panel is-warn adm-gap-top" role="group" aria-label={`${p.name} no longer works here?`}>
                    <b>{`${p.name} no longer works here?`}</b>
                    <span className="adm-small">{`${p.givenName} is signed out of /staff, leaves the sign-in list and every staff list, and ${p.givenName}’s calendar link stops. Shifts already worked stay on record. You can bring ${p.givenName} back any time.`}</span>
                    <span className="adm-small">{`If ${p.givenName} knows the staff passcode, change it below too.`}</span>
                    <div className="adm-two">
                      <button type="button" className="adm-btn is-ghost" onClick={() => setConfirm(null)}>Keep</button>
                      <button type="button" className="adm-btn is-danger" disabled={!!busy} onClick={() => setWorking(p, false)}>{busy === `work-${p.id}` ? 'Saving…' : 'Yes, no longer here'}</button>
                    </div>
                  </div>
                )}
                {confirm?.id === p.id && confirm.kind === 'stop-link' && (
                  <div className="adm-panel is-warn adm-gap-top" role="group" aria-label={`Stop ${p.name}’s calendar link?`}>
                    <b>{`Stop ${p.name}’s calendar link?`}</b>
                    <span className="adm-small">{`Any phone using it stops getting updates. ${p.givenName} can make a new one in /staff, My shifts.`}</span>
                    <div className="adm-two">
                      <button type="button" className="adm-btn is-ghost" onClick={() => setConfirm(null)}>Keep it</button>
                      <button type="button" className="adm-btn is-danger" disabled={!!busy} onClick={() => stopLink(p)}>{busy === `link-${p.id}` ? 'Stopping…' : 'Yes, stop it'}</button>
                    </div>
                  </div>
                )}
                {!confirm || confirm.id !== p.id ? (
                  <div className="adm-person-actions">
                    {p.feed?.has && <button type="button" className="adm-quiet" disabled={readOnly || !!busy} onClick={() => setConfirm({ kind: 'stop-link', id: p.id })}>Stop their calendar link</button>}
                    <button type="button" className="adm-quiet" disabled={locked || !!busy} onClick={() => setConfirm({ kind: 'leave', id: p.id })}>No longer working here</button>
                  </div>
                ) : null}
              </>
            )}
          </li>
        ))}
      </ul>
      {left.length > 0 && (
        <details className="adm-fold adm-gap-top">
          <summary className="adm-fold-sum">{`No longer working here (${left.length})`}</summary>
          <ul className="adm-plain" aria-label="No longer working here">
            {left.map((p) => (
              <li key={p.id} className="adm-person">
                <div className="adm-person-top">
                  <div className="adm-rm">
                    <b>{full(p)}</b>
                    <small>{p.leftAt ? `Left ${dayAndClock(p.leftAt)}` : 'Left'}</small>
                  </div>
                  <button type="button" className="adm-btn is-ghost is-sm" disabled={locked || !!busy} onClick={() => setWorking(p, true)}>{busy === `work-${p.id}` ? 'Saving…' : 'Working here again'}</button>
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>,
  )
}

interface PasscodeView { setInAdmin: boolean; updatedAt: string | null; by: string | null; damaged?: boolean; readOnly: boolean }

/** Staff passcode: change it here; never shown back. Saving signs everyone out of /staff. `focus`: scroll here with the form open. */
export function PasscodePanel({ onDirty, focus = false }: { onDirty?: (dirty: boolean) => void; focus?: boolean }) {
  const toast = useToast()
  const [view, setView] = useState<PasscodeView | null>(null)
  const [error, setError] = useState('')
  const [tries, setTries] = useState(0)
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLElement>(null)
  const focused = useRef(false)
  const [code, setCode] = useState('')
  const [again, setAgain] = useState('')
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)
  const live = useRef(true)
  useEffect(() => () => { live.current = false }, [])
  const dirty = open && (code !== '' || again !== '')
  useEffect(() => { onDirty?.(dirty) }, [dirty])

  useEffect(() => {
    let current = true
    setError('')
    api<PasscodeView>(PASSCODE).then((r) => {
      if (!current) return
      if (r.ok && r.data) setView(r.data)
      else setError(r.error ?? 'Couldn’t check the staff passcode.')
    })
    return () => { current = false }
  }, [tries])

  useEffect(() => {
    if (!focus || !view || focused.current) return
    focused.current = true
    if (!view.readOnly) setOpen(true)
    box.current?.scrollIntoView?.({ block: 'start' })
  }, [focus, view])

  function close() {
    setOpen(false)
    setCode('')
    setAgain('')
    setFormError('')
  }

  async function save() {
    if (busy || !view) return
    setBusy(true)
    const r = await api<{ updatedAt: string }>(PASSCODE, { passcode: code, again, expectedUpdatedAt: view.updatedAt })
    if (!live.current) return
    setBusy(false)
    if (r.ok && r.data) {
      toast('The staff passcode is changed. Everyone on the iPad will need the new passcode.')
      close()
      setTries((n) => n + 1)
      return
    }
    setFormError(r.error ?? DIDNT_SAVE)
    if (r.status === 409) setTries((n) => n + 1)
  }

  return (
    <section ref={box} aria-label="Staff passcode" className="adm-gap-top">
      <p className="adm-lbl">Staff passcode</p>
      {error && <Failed message={error} onRetry={() => setTries((n) => n + 1)} />}
      {!error && !view && <Skeleton rows={1} label="Checking the staff passcode" />}
      {view && (
        <>
          {view.damaged && (
            <p className="adm-panel is-warn" role="alert">The saved staff passcode can’t be read, so nobody can sign in to /staff. Set a new one below to fix it.</p>
          )}
          <p className="adm-small">
            {view.damaged
              ? 'This is the passcode everyone types to sign in to /staff on the iPad.'
              : view.setInAdmin && view.updatedAt
              ? `Changed here${view.by ? ` by ${view.by}` : ''} ${dayAndClock(view.updatedAt)}. It’s never shown again after it’s saved.`
              : 'This is the passcode everyone types to sign in to /staff on the iPad. You can change it any time, for example when someone stops working here.'}
          </p>
          {view.readOnly && <p className="adm-note">This test site can’t change the live staff passcode.</p>}
          {!open ? (
            <button type="button" className="adm-btn is-ghost" disabled={view.readOnly} onClick={() => setOpen(true)}>Change the staff passcode</button>
          ) : (
            <div className="adm-panel adm-gap-top" role="group" aria-label="Change the staff passcode">
              <b>Change the staff passcode</b>
              <span className="adm-small">Everyone on the iPad will need the new passcode. Anyone signed in to /staff now is signed out.</span>
              <span className="adm-small">Use at least 6 letters or numbers.</span>
              <label className="adm-fld"><span>New passcode</span><input type="password" value={code} autoComplete="new-password" maxLength={40} onChange={(e) => { setCode(e.target.value); setFormError('') }} /></label>
              <label className="adm-fld"><span>Type it again</span><input type="password" value={again} autoComplete="new-password" maxLength={40} onChange={(e) => { setAgain(e.target.value); setFormError('') }} /></label>
              {formError && <p className="adm-error" role="alert">{formError}</p>}
              <div className="adm-two">
                <button type="button" className="adm-btn is-ghost" onClick={close}>Cancel</button>
                <button type="button" className="adm-btn is-pri" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save new passcode'}</button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}

function linkWords(p: PersonView): string {
  if (!p.feed) return 'Calendar link: couldn’t check'
  if (!p.feed.has) return 'No calendar link'
  return p.feed.lastUsedAt ? `Has a calendar link · a phone last checked it ${dayAndClock(p.feed.lastUsedAt)}` : 'Has a calendar link · no phone has used it yet'
}

function PersonForm({ form, error, busy, title, onChange, onSave, onCancel }: {
  form: Form
  error: { text: string; field: string | null } | null
  busy: boolean
  title: string
  onChange: (f: Form) => void
  onSave: () => void
  onCancel: () => void
}) {
  const first = useRef<HTMLInputElement>(null)
  useEffect(() => { first.current?.focus() }, [])
  const bad = (f: string) => (error?.field === f ? true : undefined)
  return (
    <div className="adm-panel adm-gap-bottom" role="group" aria-label={title}>
      <b>{title}</b>
      <div className="adm-two">
        <label className="adm-fld"><span>First name</span><input ref={first} value={form.givenName} maxLength={40} autoComplete="off" aria-invalid={bad('givenName')} onChange={(e) => onChange({ ...form, givenName: e.target.value })} /></label>
        <label className="adm-fld"><span>Last name</span><input value={form.familyName} maxLength={40} autoComplete="off" aria-invalid={bad('familyName')} onChange={(e) => onChange({ ...form, familyName: e.target.value })} /></label>
      </div>
      <Seg label="Owner or crew" value={form.role} options={[['crew', 'Crew'], ['owner', 'Owner']]} onChange={(role) => onChange({ ...form, role })} />
      <p className="adm-small adm-muted" style={{ margin: '0.25rem 0 0.75rem' }}>Owners can use /admin and get the alerts picked for them in More › Notifications. Everyone else is Crew.</p>
      <label className="adm-fld"><span>Mobile phone (for shift texts)</span><input type="tel" inputMode="tel" value={form.phone} autoComplete="off" aria-invalid={bad('phone')} onChange={(e) => onChange({ ...form, phone: e.target.value })} /></label>
      <label className="adm-fld"><span>Email (for shift emails)</span><input type="email" inputMode="email" value={form.email} autoComplete="off" aria-invalid={bad('email')} onChange={(e) => onChange({ ...form, email: e.target.value })} /></label>
      {error && <p className="adm-error" role="alert">{error.text}</p>}
      <div className="adm-two">
        <button type="button" className="adm-btn is-ghost" onClick={onCancel}>Cancel</button>
        <button type="button" className="adm-btn is-pri" disabled={busy} onClick={onSave}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  )
}
