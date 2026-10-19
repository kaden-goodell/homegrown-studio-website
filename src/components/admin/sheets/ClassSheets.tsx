/**
 * The class screens from before the rebuild, each inside one sheet. 11b-B
 * replaces these with the tabbed class sheet and the 4-step New class.
 */
import { useEffect, useState } from 'react'
import type { BlockedTime } from '@lib/classes/blocked-time'
import type { Busy } from '@lib/classes/studio-schedule'
import type { LibraryClass, ScheduledClass } from '@lib/classes/types'
import { formatTimeSpan } from '@lib/studio-time'
import { localDate } from '@lib/party-slots'
import { api, BLOCKED, BOOKINGS, LIBRARY } from '../classes/api'
import BlockTimeForm from '../classes/BlockTimeForm'
import ClassBookings from '../classes/ClassBookings'
import ClassEditor, { type EditorMode, type EditorSaved } from '../classes/ClassEditor'
import { dayLabel } from '../classes/dates'
import PrintDay from '../classes/PrintDay'
import { useRefresh } from '../shell/data'
import { Failed, Skeleton } from '../shell/items'
import { SheetFrame, useSheet } from '../shell/Sheet'
import { DIDNT_SAVE, useToast } from '../shell/Toast'

/** One of our classes: who's booked, refunds, Edit, Run it again, Cancel. */
export function ClassSheet({ id }: { id: string }) {
  const { open, close } = useSheet()
  const { bump } = useRefresh()
  const toast = useToast()
  const [cls, setCls] = useState<ScheduledClass | null>(null)
  return (
    <SheetFrame tall title={cls?.content.name ?? 'Class'} subtitle={cls ? 'Bookings' : undefined}>
      <ClassBookings
        id={id}
        hideHeader
        onLoaded={setCls}
        onBack={close}
        onEdit={(c) => open({ kind: 'edit', id: c.id }, c)}
        onDuplicated={(c) => { bump(); toast('Added.'); open({ kind: 'class', id: c.id }) }}
      />
    </SheetFrame>
  )
}

/** The class form, wired to the sheet: unsaved changes ask before leaving, saves say so in a toast. */
function Editor({ mode, onSaved }: { mode: EditorMode; onSaved: (s: EditorSaved) => void }) {
  const { setDirty, close } = useSheet()
  useEffect(() => () => setDirty(false), [])
  // A save makes the form clean before the sheet moves on, so moving on never asks "Leave without saving?".
  return <ClassEditor mode={mode} hideHeader onCancel={close} onDirtyChange={setDirty} onSaved={(s) => { setDirty(false); onSaved(s) }} />
}

/** Load a class for the form (handed over by the class sheet, or read again after a refresh). */
function useClass(id: string): { cls: ScheduledClass | null; error: string; retry: () => void } {
  const { data } = useSheet()
  const given = data && typeof data === 'object' && (data as ScheduledClass).id === id && 'content' in (data as object) ? (data as ScheduledClass) : null
  const [cls, setCls] = useState<ScheduledClass | null>(given)
  const [error, setError] = useState('')
  const [tries, setTries] = useState(0)
  useEffect(() => {
    if (given) return
    let live = true
    setError('')
    api<{ class: ScheduledClass }>(`${BOOKINGS}?id=${encodeURIComponent(id)}`).then((r) => {
      if (!live) return
      if (r.ok && r.data) setCls(r.data.class)
      else setError(r.error ?? '')
    })
    return () => { live = false }
  }, [id, tries])
  return { cls, error, retry: () => setTries((n) => n + 1) }
}

export function EditClassSheet({ id }: { id: string }) {
  const { open } = useSheet()
  const { bump } = useRefresh()
  const toast = useToast()
  const { cls, error, retry } = useClass(id)
  return (
    <SheetFrame tall title={cls ? `Edit ${cls.content.name}` : 'Edit class'} subtitle={<button type="button" className="btn-quiet" style={{ minHeight: '2.75rem' }} onClick={() => open({ kind: 'class', id })}>Back to bookings</button>}>
      {error && <Failed message={error} onRetry={retry} />}
      {!error && !cls && <Skeleton rows={4} />}
      {cls && (
        <Editor
          mode={{ kind: 'edit', cls }}
          onSaved={(s) => { bump(); toast(s.warning ?? 'Saved.') }}
        />
      )}
    </SheetFrame>
  )
}

export function NewClassSheet({ day }: { day?: string }) {
  const { open } = useSheet()
  const { bump } = useRefresh()
  const toast = useToast()
  return (
    <SheetFrame tall title="New class" subtitle={day ? `On ${dayLabel(day)}` : undefined}>
      <Editor
        mode={{ kind: 'new', ...(day ? { day } : {}) }}
        onSaved={(s) => {
          bump()
          toast(s.warning ?? 'Added. It’s on the calendar.')
          if (s.cls) open({ kind: 'class', id: s.cls.id })
        }}
      />
    </SheetFrame>
  )
}

/** A library class, for Edit or "Change details, then schedule". */
function useLibrary(id: string): { lib: LibraryClass | null; error: string; retry: () => void } {
  const { data } = useSheet()
  const given = data && typeof data === 'object' && (data as LibraryClass).id === id && 'versions' in (data as object) ? (data as LibraryClass) : null
  const [lib, setLib] = useState<LibraryClass | null>(given)
  const [error, setError] = useState('')
  const [tries, setTries] = useState(0)
  useEffect(() => {
    if (given) return
    let live = true
    setError('')
    api<{ library: LibraryClass[] }>(`${LIBRARY}?archived=1`).then((r) => {
      if (!live) return
      const found = r.ok ? r.data?.library.find((l) => l.id === id) : undefined
      if (found) setLib(found)
      else setError(r.ok ? 'That class isn’t in the library any more.' : r.error ?? '')
    })
    return () => { live = false }
  }, [id, tries])
  return { lib, error, retry: () => setTries((n) => n + 1) }
}

export function LibraryEditSheet({ id }: { id?: string }) {
  const { close } = useSheet()
  const { bump } = useRefresh()
  const toast = useToast()
  const { lib, error, retry } = useLibrary(id ?? '')
  const done = () => { bump(); toast('Saved to the library.'); close() }
  if (!id) {
    return <SheetFrame tall title="New library class"><Editor mode={{ kind: 'library' }} onSaved={done} /></SheetFrame>
  }
  return (
    <SheetFrame tall title="Edit library class" subtitle={lib?.versions[lib.versions.length - 1].content.name}>
      {error && <Failed message={error} onRetry={retry} />}
      {!error && !lib && <Skeleton rows={4} />}
      {lib && <Editor mode={{ kind: 'library', lib }} onSaved={done} />}
    </SheetFrame>
  )
}

export function LibraryScheduleSheet({ id }: { id: string }) {
  const { open } = useSheet()
  const { bump } = useRefresh()
  const toast = useToast()
  const { lib, error, retry } = useLibrary(id)
  return (
    <SheetFrame tall title="Schedule from the library" subtitle={lib?.versions[lib.versions.length - 1].content.name}>
      {error && <Failed message={error} onRetry={retry} />}
      {!error && !lib && <Skeleton rows={4} />}
      {lib && (
        <Editor
          mode={{ kind: 'from-library', lib }}
          onSaved={(s) => { bump(); toast(s.warning ?? 'Added. It’s on the calendar.'); if (s.cls) open({ kind: 'class', id: s.cls.id }) }}
        />
      )}
    </SheetFrame>
  )
}

/** Block time: the form, then the sheet closes with a toast that can undo it. */
export function BlockSheet({ day }: { day?: string }) {
  const { setDirty, close } = useSheet()
  const { bump } = useRefresh()
  const toast = useToast()
  useEffect(() => () => setDirty(false), [])
  function blocked(b: BlockedTime, clashes: Busy[]) {
    bump()
    close()
    const when = `${dayLabel(localDate(b.startIso))}, ${formatTimeSpan(b.startIso, b.endIso)}`
    const over = clashes.length ? ` It sits on ${clashes.map((c) => c.label).join(', ')}; nothing booked was changed.` : ''
    toast(`Blocked ${when}.${over}`, {
      undo: () => api(BLOCKED, { action: 'remove', id: b.id }).then((r) => { bump(); if (!r.ok) toast(DIDNT_SAVE) }),
    })
  }
  return (
    <SheetFrame tall title="Block time" subtitle={day ? dayLabel(day) : undefined}>
      <p className="adm-note">Customers can’t book anything in this window.</p>
      <BlockTimeForm initialDay={day} onDirtyChange={setDirty} onBlocked={blocked} />
    </SheetFrame>
  )
}

/** A day on paper: rosters, waivers and what to prepare. */
export function PrintSheet({ day }: { day: string }) {
  const { close } = useSheet()
  return (
    <SheetFrame tall title="Print a day" subtitle={dayLabel(day)}>
      <PrintDay day={day} hideBack onBack={close} />
    </SheetFrame>
  )
}
