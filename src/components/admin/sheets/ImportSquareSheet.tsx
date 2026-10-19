/**
 * More › Bring in Square classes (Task 17a): what an import would add to the
 * library from the classes Square runs today (a dry run, read only), then
 * [Add N to the library]. Square is only read; nothing is scheduled.
 */
import { useEffect, useState } from 'react'
import type { ImportResult } from '@lib/classes/import-square'
import { formatMoney } from '@lib/money'
import { api, IMPORT_SQUARE } from '../classes/api'
import { NoPhoto } from '../ClassesTab'
import { useRefresh } from '../shell/data'
import { Failed, Skeleton } from '../shell/items'
import { SheetFrame, useSheet } from '../shell/Sheet'
import { DIDNT_SAVE, useToast } from '../shell/Toast'

type Row = ImportResult['create'][number]

function ClassRow({ r, onOpen }: { r: Row; onOpen?: () => void }) {
  const body = (
    <>
      <span className="adm-thumb">{r.imageUrl ? <img src={r.imageUrl} alt="" /> : <NoPhoto />}</span>
      <span className="adm-rm">
        <b>{r.name}</b>
        <small>{[formatMoney(r.priceCents), r.ages].filter(Boolean).join(' · ')}</small>
        {r.issues.map((x) => <small key={x} className="adm-warntext">{x}</small>)}
      </span>
    </>
  )
  return onOpen
    ? <button type="button" className="adm-libc" onClick={onOpen}>{body}<span className="adm-chev" aria-hidden="true">›</span></button>
    : <div className="adm-libc">{body}</div>
}

export function ImportSquareSheet() {
  const { open } = useSheet()
  const { bump } = useRefresh()
  const toast = useToast()
  const [plan, setPlan] = useState<ImportResult | null>(null)
  const [done, setDone] = useState<ImportResult | null>(null)
  const [error, setError] = useState('')
  const [tries, setTries] = useState(0)
  const [busy, setBusy] = useState(false)
  const [addError, setAddError] = useState('')

  useEffect(() => {
    let live = true
    setError('')
    setPlan(null)
    api<ImportResult>(IMPORT_SQUARE, { dryRun: true }).then((r) => {
      if (!live) return
      if (r.ok && r.data) setPlan(r.data)
      else setError(r.error ?? 'Square couldn’t be read. Try again.')
    })
    return () => { live = false }
  }, [tries])

  const n = plan?.create.length ?? 0
  const photos = plan?.addPhoto.length ?? 0
  async function add() {
    setBusy(true)
    setAddError('')
    const r = await api<ImportResult>(IMPORT_SQUARE, { dryRun: false })
    setBusy(false)
    if (!r.ok || !r.data) { setAddError(r.error ?? DIDNT_SAVE); toast(DIDNT_SAVE); return }
    setDone(r.data)
    bump()
    const added = r.data.create.length
    toast(added ? `Added ${added === 1 ? '1 class' : `${added} classes`} to your library.` : r.data.addPhoto.length ? 'Photos added.' : 'Nothing new to add.')
  }

  const addLabel = n ? `Add ${n} to the library` : photos ? `Add ${photos === 1 ? 'the photo' : `${photos} photos`}` : 'Nothing to add'
  const footer = plan ? <button type="button" className="adm-btn is-pri" disabled={busy || (!n && !photos)} onClick={add}>{busy ? 'Adding…' : addLabel}</button> : undefined

  return (
    <SheetFrame tall title="Bring in Square classes" subtitle="Into your library, to schedule here" footer={done ? <CloseButton /> : footer}>
      <p className="adm-note">This reads the classes Square has now and adds each one to your library once. Nothing is scheduled, and nothing changes in Square.</p>
      {error && <Failed message={error} onRetry={() => setTries((x) => x + 1)} />}
      {!error && !plan && <Skeleton rows={3} label="Looking at Square" />}
      {done && (
        <>
          <p className="adm-lbl">{done.create.length ? `Added (${done.create.length})` : 'Nothing new was added'}</p>
          {done.create.map((r) => <ClassRow key={r.id ?? r.name} r={r} onOpen={r.id ? () => open({ kind: 'lib', id: r.id! }) : undefined} />)}
          {done.addPhoto.length > 0 && <p className="adm-small adm-muted">{`Photos added: ${done.addPhoto.map((p) => p.name).join(', ')}.`}</p>}
          {done.create.some((r) => r.issues.length) && <p className="adm-note">Check the ones with a note, and the prices if they have adult and kid prices in Square.</p>}
        </>
      )}
      {plan && !done && (
        <>
          <p className="adm-lbl">{n ? `Will be added (${n})` : 'Nothing new to add'}</p>
          {!n && <p className="adm-empty">Everything Square has is already in your library.</p>}
          {plan.create.map((r) => <ClassRow key={r.name} r={r} />)}
          {photos > 0 && (
            <>
              <p className="adm-lbl">{`Gets its photo from Square (${photos})`}</p>
              {plan.addPhoto.map((p) => <p key={p.id} className="adm-small">{p.name}</p>)}
            </>
          )}
          {plan.skip.length > 0 && (
            <>
              <p className="adm-lbl">{`Left out (${plan.skip.length})`}</p>
              {plan.skip.map((s) => <div key={`${s.name}-${s.reason}`} className="adm-kv"><span>{s.name}</span><span>{s.reason}</span></div>)}
            </>
          )}
        </>
      )}
      {addError && <p className="adm-error" role="alert">{addError}</p>}
    </SheetFrame>
  )
}

function CloseButton() {
  const { close } = useSheet()
  return <button type="button" className="adm-btn is-ghost" onClick={close}>Done</button>
}
