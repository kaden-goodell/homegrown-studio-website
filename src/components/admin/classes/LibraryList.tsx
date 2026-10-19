import { useEffect, useState } from 'react'
import { agesLabel } from '@lib/workshop-copy'
import type { ClassContent, LibraryClass, ScheduledClass } from '@lib/classes/types'
import { ownPriceLabel } from '@lib/classes/public-class'
import { api, LIBRARY } from './api'
import { dayLabel } from './dates'
import ScheduleDialog from './ScheduleDialog'
import { box, errorText, muted, row, warnText } from './ui'
import { localDate } from '@lib/party-slots'

const latest = (l: LibraryClass) => l.versions[l.versions.length - 1]
/** "$30", "$20 adult · $15 kid", "From $15": the label only reads pass ids and how many passes there are. */
const priceOf = (c: ClassContent) => ownPriceLabel(c as unknown as Parameters<typeof ownPriceLabel>[0])

/**
 * The class library: the classes the studio runs again and again. Schedule
 * one straight onto the calendar, change its details first, edit the library
 * copy, look back through its versions, or archive it.
 */
export default function LibraryList({ onEdit, onNew, onScheduleWithEdits, onScheduled, hideHeader, hideAdd }: {
  hideHeader?: boolean
  /** In the shell, + New class is the one way in (every class lands in the library in 11b-B). */
  hideAdd?: boolean
  onEdit: (lib: LibraryClass) => void
  onNew: () => void
  onScheduleWithEdits: (lib: LibraryClass) => void
  onScheduled: (cls: ScheduledClass, warning?: string) => void
}) {
  const [list, setList] = useState<LibraryClass[] | null>(null)
  const [error, setError] = useState('')
  const [archived, setArchived] = useState(false)

  async function load(showArchived = archived) {
    const r = await api<{ library: LibraryClass[] }>(`${LIBRARY}${showArchived ? '?archived=1' : ''}`)
    if (r.ok && r.data) { setList(r.data.library); setError('') } else setError(r.error ?? '')
  }
  useEffect(() => { load() }, [])

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <div style={{ ...row, justifyContent: hideHeader ? 'flex-end' : 'space-between' }}>
        {!hideHeader && <h1 className="font-heading" style={{ margin: 0, fontSize: '1.75rem', color: 'var(--color-dark)' }}>Class library</h1>}
        {!hideAdd && <button type="button" className="btn btn-primary" onClick={onNew}>Add a class to the library</button>}
      </div>
      <div style={row}>
        <button type="button" className="btn btn-secondary" aria-pressed={archived} onClick={() => { setArchived(!archived); load(!archived) }}>
          {archived ? 'Hide archived' : 'Show archived'}
        </button>
      </div>
      {error && <p role="alert" style={errorText}>{error} <button type="button" className="btn btn-secondary" onClick={() => load()}>Try again</button></p>}
      {!error && !list && <p style={muted}>Loading…</p>}
      {list && list.length === 0 && <p style={muted}>Nothing in the library yet. Add a class you’ll run more than once.</p>}
      {list?.map((l) => (
        <LibraryCard key={l.id} lib={l} onEdit={onEdit} onScheduleWithEdits={onScheduleWithEdits} onScheduled={onScheduled} onChanged={(next) => setList((cur) => (cur ?? []).map((x) => (x.id === next.id ? next : x)).filter((x) => archived || !x.archived))} />
      ))}
    </div>
  )
}

function LibraryCard({ lib, onEdit, onScheduleWithEdits, onScheduled, onChanged }: {
  lib: LibraryClass
  onEdit: (lib: LibraryClass) => void
  onScheduleWithEdits: (lib: LibraryClass) => void
  onScheduled: (cls: ScheduledClass, warning?: string) => void
  onChanged: (lib: LibraryClass) => void
}) {
  const [scheduling, setScheduling] = useState(false)
  const [versions, setVersions] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const v = latest(lib)
  const c = v.content

  async function post(body: Record<string, unknown>, ok: string) {
    setError('')
    setDone('')
    const r = await api<{ library: LibraryClass }>(LIBRARY, body)
    if (r.ok && r.data) { setDone(ok); onChanged(r.data.library) } else setError(r.error ?? '')
  }

  return (
    <article aria-label={c.name} style={{ ...box, opacity: lib.archived ? 0.7 : 1 }}>
      <div style={{ display: 'grid', gridTemplateColumns: c.imageUrl ? '5rem 1fr' : '1fr', gap: '0.75rem', alignItems: 'center' }}>
        {c.imageUrl && <img src={c.imageUrl} alt="" style={{ width: '5rem', aspectRatio: '4 / 3', objectFit: 'cover', borderRadius: '0.5rem' }} />}
        <div style={{ minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: '1.15rem', color: 'var(--color-dark)' }}>{c.name}{lib.archived ? ' (archived)' : ''}</h2>
          <p style={{ ...muted, fontSize: '0.9rem' }}>
            {[priceOf(c), `${c.defaultMinutes} minutes`, `${c.defaultCapacity} seats`, agesLabel(c.rules.ages), `version ${v.version}`].filter(Boolean).join(' · ')}
          </p>
        </div>
      </div>
      {error && <p role="alert" style={errorText}>{error}</p>}
      {done && <p role="status" style={warnText}>{done}</p>}
      {scheduling ? (
        <ScheduleDialog
          name={c.name}
          libraryId={lib.id}
          defaultMinutes={c.defaultMinutes}
          defaultCapacity={c.defaultCapacity}
          onCancel={() => setScheduling(false)}
          onDone={(cls, warning) => { setScheduling(false); onScheduled(cls, warning) }}
        />
      ) : (
        <div style={row}>
          {!lib.archived && <button type="button" className="btn btn-primary" onClick={() => setScheduling(true)}>Schedule</button>}
          {!lib.archived && <button type="button" className="btn btn-secondary" onClick={() => onScheduleWithEdits(lib)}>Change details, then schedule</button>}
          <button type="button" className="btn btn-secondary" onClick={() => onEdit(lib)}>Edit</button>
          <button type="button" className="btn btn-secondary" aria-expanded={versions} onClick={() => setVersions(!versions)}>Versions</button>
          <button type="button" className="btn btn-secondary" onClick={() => post({ action: 'archive', id: lib.id, archived: !lib.archived }, lib.archived ? 'Back in the library.' : 'Archived.')}>
            {lib.archived ? 'Bring back' : 'Archive'}
          </button>
        </div>
      )}
      {versions && (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: '0.4rem' }}>
          {[...lib.versions].reverse().map((x) => (
            <li key={x.version} style={{ ...row, justifyContent: 'space-between', borderTop: '1px solid var(--color-line)', paddingTop: '0.4rem' }}>
              <span>
                {`Version ${x.version} · ${dayLabel(localDate(x.at))}${x.note ? ` · ${x.note}` : ''} · ${priceOf(x.content)}`}
              </span>
              {x.version !== v.version && (
                <button type="button" className="btn btn-secondary" onClick={() => post({ action: 'restore', id: lib.id, version: x.version }, `Version ${x.version} is the current one again.`)}>
                  Restore version {x.version}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </article>
  )
}
