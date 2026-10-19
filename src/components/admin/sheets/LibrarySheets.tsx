/**
 * The class library (direction D): one library class's sheet (photo, price,
 * seats, usual time, when it last ran; Schedule it, Edit details, Archive
 * with Undo, Earlier versions with Restore), and its Edit details form.
 * Library classes are only ever made by adding a class.
 */
import { useEffect, useRef, useState } from 'react'
import type { LibraryClass } from '@lib/classes/types'
import { api, LIBRARY } from '../classes/api'
import { build, fieldOf, fixLine, toForm, type Errors, type Form } from '../classes/class-form'
import { DetailsFields, focusFirstError, PreviewButton } from '../classes/ClassDetails'
import { dayLabel } from '../classes/dates'
import { latestOf, priceOf, ranText } from '../classes/labels'
import { useLibraryList } from '../classes/library-data'
import { localDate } from '@lib/party-slots'
import { useRefresh } from '../shell/data'
import { Failed, Skeleton } from '../shell/items'
import { SheetFrame, useSheet, useSheetDirty } from '../shell/Sheet'
import { timeSpan } from '../shell/time'
import { DIDNT_SAVE, useToast } from '../shell/Toast'

/** "$35 a seat", but "$20 adult · $15 kid" and "From $15" as they are. */
export function seatPrice(label: string): string {
  if (!label) return ''
  return /·|^From /.test(label) ? label : `${label} a seat`
}

/** One library class, found in the list (archived ones too). */
function useOne(id: string) {
  const lib = useLibraryList(true)
  const item = lib.list?.find((l) => l.id === id) ?? null
  return { ...lib, item }
}

export function LibraryItemSheet({ id }: { id: string }) {
  const { open, close } = useSheet()
  const { bump } = useRefresh()
  const toast = useToast()
  const { list, item, runs, error, retry } = useOne(id)
  const [asking, setAsking] = useState(false)
  const [versions, setVersions] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState('')

  if (error) return <SheetFrame title="Library"><Failed message={error} onRetry={retry} /></SheetFrame>
  if (!list) return <SheetFrame title="Library"><Skeleton rows={3} label="Loading the library" /></SheetFrame>
  if (!item) return <SheetFrame title="Library"><p className="adm-muted">That class isn’t in the library any more.</p></SheetFrame>

  const v = latestOf(item)
  const c = v.content
  const run = runs[item.id]

  async function post(body: Record<string, unknown>): Promise<LibraryClass | null> {
    setBusy(true)
    setFailed('')
    const r = await api<{ library: LibraryClass }>(LIBRARY, body)
    setBusy(false)
    if (!r.ok || !r.data) { setFailed(r.status === 0 ? r.error ?? DIDNT_SAVE : r.error ?? DIDNT_SAVE); return null }
    return r.data.library
  }

  async function archive(to: boolean) {
    if (!item) return
    const done = await post({ action: 'archive', id: item.id, archived: to })
    if (!done) return
    bump()
    if (to) {
      close()
      toast(`Archived ${c.name}.`, {
        undo: () => api(LIBRARY, { action: 'archive', id: item.id, archived: false }).then((r) => { bump(); if (!r.ok) toast(DIDNT_SAVE) }),
      })
    } else toast(`${c.name} is back in the library.`)
    setAsking(false)
  }

  async function restore(version: number) {
    if (!item) return
    const done = await post({ action: 'restore', id: item.id, version })
    if (!done) return
    bump()
    toast(`Version ${version} is the current one again.`)
  }

  const footer = asking
    ? (
      <div className="adm-panel is-warn" role="group" aria-label={`Archive ${c.name}?`}>
        <b>{`Archive ${c.name}?`}</b>
        <span className="adm-small">It leaves the library list. Classes already on the calendar stay as they are.</span>
        {failed && <p role="alert" className="adm-error">{failed}</p>}
        <div className="adm-two">
          <button type="button" className="adm-btn is-ghost" onClick={() => { setAsking(false); setFailed('') }}>Keep it</button>
          <button type="button" className="adm-btn is-danger" disabled={busy} onClick={() => archive(true)}>Archive</button>
        </div>
      </div>
    )
    : item.archived
      ? <button type="button" className="adm-btn is-pri" disabled={busy} onClick={() => archive(false)}>Bring it back</button>
      : (
        <div className="adm-stack">
          <button type="button" className="adm-btn is-pri" onClick={() => open({ kind: 'libsched', id: item.id })}>Schedule it</button>
          <div className="adm-two">
            <button type="button" className="adm-btn is-ghost" onClick={() => open({ kind: 'libedit', id: item.id }, item)}>Edit details</button>
            <button type="button" className="adm-btn is-ghost" onClick={() => setAsking(true)}>Archive</button>
          </div>
        </div>
      )

  return (
    <SheetFrame title={c.name} subtitle={item.archived ? 'Archived' : 'In your library'} footer={footer}>
      <div className="adm-libphoto">{c.imageUrl ? <img src={c.imageUrl} alt={c.name} /> : <span className="adm-muted adm-small">No photo yet</span>}</div>
      <div className="adm-card">
        <p>{[seatPrice(priceOf(c)), `${c.defaultCapacity} seats`].filter(Boolean).join(' · ')}</p>
        <p>{run ? `${timeSpan(run.startIso, run.endIso)} usually` : `${c.defaultMinutes} minutes usually`}</p>
        <p className="adm-muted adm-small">{ranText(run)}</p>
      </div>
      {failed && !asking && <p role="alert" className="adm-error">{failed}</p>}
      {item.versions.length > 1 && (
        <button type="button" className="adm-btn is-ghost adm-versionsbtn" aria-expanded={versions} onClick={() => setVersions(!versions)}>
          {`Earlier versions (${item.versions.length - 1})`}
        </button>
      )}
      {versions && (
        <ul className="adm-mlist" aria-label="Versions">
          {[...item.versions].reverse().map((x) => (
            <li key={x.version}>
              <div className="adm-mrow">
                <span className="adm-rm">
                  <b>{`Version ${x.version}${x.version === v.version ? ' · now' : ''}`}</b>
                  <small>{[dayLabel(localDate(x.at)), x.by?.name, x.changed?.length ? x.changed.join(', ') : x.version === 1 ? 'First version' : x.note].filter(Boolean).join(' · ')}</small>
                </span>
                {x.version !== v.version && (
                  <button type="button" className="adm-btn is-ghost is-sm" disabled={busy} onClick={() => restore(x.version)}>{`Restore version ${x.version}`}</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </SheetFrame>
  )
}

/** Edit a library class's details (with how long it usually runs and its usual seats). A save is a new version. */
export function LibraryEditSheet({ id }: { id: string }) {
  const { item, error, retry, list } = useOne(id)
  // Once the form is up, a failed reload never takes it away (N4): the error shows above the typing, with Try again.
  if (!list && error) return <SheetFrame tall title="Edit details"><Failed message={error} onRetry={retry} /></SheetFrame>
  if (!list) return <SheetFrame tall title="Edit details"><Skeleton rows={4} label="Loading the library" /></SheetFrame>
  if (!item) return <SheetFrame tall title="Edit details"><p className="adm-muted">That class isn’t in the library any more.</p></SheetFrame>
  return <LibraryForm item={item} onStale={retry} loadError={error} />
}

function LibraryForm({ item, onStale, loadError }: { item: LibraryClass; onStale: () => void; loadError: string }) {
  const { open, setDirty } = useSheet()
  const { bump } = useRefresh()
  const toast = useToast()
  const body = useRef<HTMLDivElement>(null)
  const [base] = useState<Form>(() => toForm(latestOf(item).content))
  const [f, setF] = useState<Form>(base)
  const [errors, setErrors] = useState<Errors>({})
  const [busy, setBusy] = useState(false)
  /** The version the form was opened on; a save over a newer one is refused, the typing kept (M7). */
  const [expected, setExpected] = useState(latestOf(item).version)
  const [stale, setStale] = useState('')
  /** After a stale refusal, Save waits until the fresh copy is here, so it goes over that one. */
  const [fetching, setFetching] = useState(false)
  const latestVersion = latestOf(item).version
  useEffect(() => {
    if (!fetching) return
    setExpected(latestVersion)
    setFetching(false)
  }, [item])
  const dirty = JSON.stringify(f) !== JSON.stringify(base)
  useSheetDirty(dirty)

  async function save() {
    const b = build(f, { usual: true })
    if (!b.ok) { setErrors(b.errors); requestAnimationFrame(() => focusFirstError(body.current, b.errors)); return }
    setErrors({})
    setBusy(true)
    const r = await api<{ library: LibraryClass }>(LIBRARY, { action: 'save', id: item.id, content: b.content, note: '', expectedVersion: expected })
    setBusy(false)
    if (!r.ok || !r.data) {
      if (r.status === 409 && r.extra.stale === true) { setStale(r.error ?? ''); setFetching(true); onStale(); return }
      const k = fieldOf(r.extra.field, f)
      const e = { [k]: r.error ?? DIDNT_SAVE } as Errors
      setErrors(e)
      if (k !== 'form') requestAnimationFrame(() => focusFirstError(body.current, e))
      return
    }
    bump()
    toast('Saved to the library. Classes already on the calendar keep their own details.')
    // Saved: moving on must not ask "Leave without saving?".
    setDirty(false)
    open({ kind: 'lib', id: item.id })
  }

  const line = errors.form || fixLine(errors, 'above')
  return (
    <SheetFrame
      tall
      title="Edit details"
      subtitle={latestOf(item).content.name}
      footer={(
        <div className="adm-stack">
          {line && <p className="adm-footline" role="alert">{line}</p>}
          <button type="button" className="adm-btn is-pri" disabled={!dirty || busy || fetching} onClick={save}>{busy ? 'Saving…' : 'Save to the library'}</button>
        </div>
      )}
    >
      <div ref={body}>
        <p className="adm-note">This changes the library copy, for classes you schedule from now on.</p>
        {stale && <p className="adm-panel is-warn" role="alert">{stale}</p>}
        {loadError && fetching && <Failed message={`${loadError} Your typing is kept; Save works again once the latest copy loads.`} onRetry={onStale} />}
        <PreviewButton f={f} sessions={[]} />
        <DetailsFields f={f} set={(fn) => setF((cur) => fn(cur))} errors={errors} sessions={[]} usual />
      </div>
    </SheetFrame>
  )
}
