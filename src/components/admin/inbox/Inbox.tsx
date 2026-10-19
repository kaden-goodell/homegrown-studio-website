import { useEffect, useState } from 'react'
import type { ToDecideItem } from '@pages/api/admin/to-decide.json'
import { Failed, Seg, Skeleton } from '../shell/items'
import { SafeRow } from '../shell/Boundary'
import type { InboxKind, Sheet } from '../shell/router'
import { describeItem } from './describe'
import { useInbox, type InboxItem } from './InboxData'

export type InboxSegment = InboxKind | 'todo'

const EMPTY: Record<InboxKind, string> = {
  request: 'No requests yet. They show up here when people use ourhometownstudio.com/private-events.',
  message: 'No messages yet. They show up here when people use ourhometownstudio.com/contact.',
  teacher: 'No applications yet. They show up here when artists use ourhometownstudio.com/teach.',
}

/**
 * Inbox: Requests · Messages · Teachers · To decide. Each list loads on its
 * own. Rows fold to one headline with a status badge and what to do next;
 * tap one for every answer and its status.
 */
export default function Inbox({ segment, onSegment, onOpen }: {
  segment: InboxSegment
  onSegment: (s: InboxSegment) => void
  onOpen: (s: Sheet) => void
}) {
  const inbox = useInbox()
  const { counts } = inbox
  return (
    <>
      <div className="adm-top">
        <div className="adm-grow">
          <p className="adm-brand">Hometown Studio</p>
          <h1>Inbox</h1>
        </div>
        <span className="adm-small adm-muted">{inbox.loaded ? `${inbox.total} waiting` : ''}</span>
      </div>
      <Seg
        tight
        label="Show"
        value={segment}
        onChange={onSegment}
        options={[
          ['request', `Requests ${counts.request}`],
          ['message', `Messages ${counts.message}`],
          ['teacher', `Teachers ${counts.teacher}`],
          ['todo', `To decide ${counts.todo}`],
        ]}
      />
      {segment === 'todo'
        ? <ToDecide onOpen={onOpen} />
        : <KindList key={segment} kind={segment} onOpen={onOpen} />}
    </>
  )
}

function KindList({ kind, onOpen }: { kind: InboxKind; onOpen: (s: Sheet) => void }) {
  const source = useInbox()[kind]
  const [onlyNew, setOnlyNew] = useState(false)
  /** Rows shown under "New only" stay put until you leave, even after their status changes. */
  const [kept, setKept] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (onlyNew) setKept(new Set((source.items as InboxItem[] | null ?? []).filter((x) => x.status === 'new').map((x) => x.id)))
  }, [onlyNew, source.items === null])

  if (source.error && !source.items) return <Failed message={source.error} onRetry={source.retry} />
  if (!source.items) return <Skeleton rows={3} label="Loading the inbox" />
  const items = source.items as InboxItem[]
  const shown = onlyNew ? items.filter((x) => x.status === 'new' || kept.has(x.id)) : items
  return (
    <>
      {items.length > 0 && (
        <div className="adm-filter">
          <button type="button" aria-pressed={onlyNew} onClick={() => setOnlyNew(!onlyNew)}>New only</button>
        </div>
      )}
      {items.length === 0 && <p className="adm-empty">{EMPTY[kind]}</p>}
      {items.length > 0 && shown.length === 0 && <p className="adm-empty">Nothing new. Tap New only to see everything.</p>}
      {shown.map((x) => (
        <SafeRow key={x.id}><InboxRow kind={kind} item={x} onOpen={onOpen} /></SafeRow>
      ))}
    </>
  )
}

/** One folded row: name, status, what it is and when, and what to do next. */
function InboxRow({ kind, item: x, onOpen }: { kind: InboxKind; item: InboxItem; onOpen: (s: Sheet) => void }) {
  const d = describeItem(kind, x)
  return (
    <button type="button" className="adm-ibx" onClick={() => onOpen({ kind, id: x.id })}>
      <span className="adm-tp">
        <b>{d.name}</b>
        <span className={`adm-badge ${x.status === 'new' ? 'is-new' : 'is-done'}`}>{d.statusLabel}</span>
      </span>
      <small>{d.kind} · {d.head}</small>
      {d.next && <span className="adm-nx">Next: {d.next}</span>}
    </button>
  )
}

function ToDecide({ onOpen }: { onOpen: (s: Sheet) => void }) {
  const { todo } = useInbox()
  if (todo.error && !todo.items) return <Failed message={todo.error} onRetry={todo.retry} />
  if (!todo.items) return <Skeleton rows={2} label="Loading To decide" />
  if (!todo.items.length) return <p className="adm-empty">Nothing to decide. Things that happen in Square without you land here.</p>
  const list = [...todo.items.filter((t) => !t.done), ...todo.items.filter((t) => t.done)]
  return (
    <>
      <p className="adm-note">Things that happened in Square without you. Nothing changes until you pick.</p>
      {list.map((t: ToDecideItem) => (
        <button key={t.id} type="button" className="adm-ibx" onClick={() => onOpen({ kind: 'todo', id: t.id })}>
          <span className="adm-tp">
            <b>{t.title}</b>
            <span className={`adm-badge ${t.done ? 'is-done' : 'is-new'}`}>{t.done ? 'Done' : 'To decide'}</span>
          </span>
          <small>{t.head}</small>
          <span className="adm-nx">{t.done ? t.done : `Next: ${t.hint}`}</span>
        </button>
      ))}
    </>
  )
}
