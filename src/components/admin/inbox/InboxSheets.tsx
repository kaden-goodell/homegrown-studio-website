import type { ArtistApplication } from '@lib/artist-applications'
import type { ContactMessage } from '@lib/contact-options'
import type { EventRequest } from '@lib/event-request-options'
import { SheetFrame } from '../shell/Sheet'
import { Failed, Seg, Skeleton } from '../shell/items'
import type { InboxKind } from '../shell/router'
import { MessageAnswers, RequestAnswers, TeacherAnswers } from './answers'
import { describeItem, telHref } from './describe'
import { useInbox, type InboxItem } from './InboxData'

const TITLE: Record<InboxKind, string> = { request: 'Request', message: 'Message', teacher: 'Teacher' }

/** Call and Email as links, with the number and address showing too. */
export function ContactFooter({ phone, email }: { phone: string; email: string }) {
  if (!phone && !email) return null
  return (
    <div className="adm-two">
      {phone
        ? <a className="adm-btn is-ghost adm-contact" href={telHref(phone)}>Call<small>{phone}</small></a>
        : <span />}
      {email
        ? <a className="adm-btn is-pri adm-contact" href={`mailto:${email}`}>Email<small>{email}</small></a>
        : <span />}
    </div>
  )
}

/** One request, message or teacher: every answer, its status, and how to reach them. */
export function InboxItemSheet({ kind, id }: { kind: InboxKind; id: string }) {
  const inbox = useInbox()
  const source = inbox[kind]
  if (source.error && !source.items) {
    return <SheetFrame title={TITLE[kind]}><Failed message={source.error} onRetry={source.retry} /></SheetFrame>
  }
  if (!source.items) return <SheetFrame title={TITLE[kind]}><Skeleton rows={4} /></SheetFrame>
  const item = (source.items as InboxItem[]).find((x) => x.id === id)
  if (!item) return <SheetFrame title={TITLE[kind]}><p className="adm-muted">This isn’t in the list any more.</p></SheetFrame>
  const d = describeItem(kind, item)
  return (
    <SheetFrame tall title={d.title} subtitle={d.sheetLabel} footer={<ContactFooter phone={d.phone} email={d.email} />}>
      {d.next && <p className="adm-note"><b style={{ color: 'var(--color-dark)' }}>Next:</b> {d.next}</p>}
      <h3 className="adm-lbl" style={{ marginTop: 0 }}>Status</h3>
      <Seg
        label={`Status for ${d.title}`}
        value={item.status}
        className={d.statuses.length > 3 ? 'is-wrap' : undefined}
        options={d.statuses as [string, string][]}
        onChange={(s) => inbox.setStatus(kind, id, s, d.statuses.find(([v]) => v === s)?.[1] ?? s)}
      />
      {kind === 'request' && <RequestAnswers r={item as EventRequest} />}
      {kind === 'message' && <MessageAnswers m={item as ContactMessage} />}
      {kind === 'teacher' && <TeacherAnswers a={item as ArtistApplication} />}
    </SheetFrame>
  )
}

/** A To decide item, read only until the next update gives it its buttons. */
export function ToDecideSheet({ id }: { id: string }) {
  const { todo } = useInbox()
  if (todo.error && !todo.items) return <SheetFrame title="To decide"><Failed message={todo.error} onRetry={todo.retry} /></SheetFrame>
  if (!todo.items) return <SheetFrame title="To decide"><Skeleton rows={2} /></SheetFrame>
  const t = todo.items.find((x) => x.id === id)
  if (!t) return <SheetFrame title="To decide"><p className="adm-muted">This isn’t in the list any more.</p></SheetFrame>
  return (
    <SheetFrame title={t.title} subtitle="To decide">
      <div className="adm-card"><p><b style={{ color: 'var(--color-dark)' }}>{t.head}</b></p></div>
      <p className="adm-note" style={{ marginTop: '0.75rem' }}>{t.done ? t.done : `Next: ${t.hint}`}</p>
    </SheetFrame>
  )
}
