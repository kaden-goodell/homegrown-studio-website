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

/** A contact button with what it dials or writes to underneath, as text you can select and copy. */
export function ContactButton({ label, href, text, primary }: { label: string; href: string; text: string; primary?: boolean }) {
  return (
    <div className="adm-contactcol">
      <a className={`adm-btn ${primary ? 'is-pri' : 'is-ghost'}`} href={href}>{label}</a>
      <span className="adm-addr">{text}</span>
    </div>
  )
}

/** Call and Email as links, with the number and address showing underneath. */
export function ContactFooter({ phone, email }: { phone: string; email: string }) {
  if (!phone && !email) return null
  return (
    <div className="adm-two">
      {phone ? <ContactButton label="Call" href={telHref(phone)} text={phone} /> : <span />}
      {email ? <ContactButton label="Email" href={`mailto:${email}`} text={email} primary /> : <span />}
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
      <h3 className="adm-lbl">Status</h3>
      <Seg
        label={`Status for ${d.title}`}
        value={item.status}
        className={d.statuses.length > 3 ? 'is-wrap' : undefined}
        options={d.statuses as [string, string][]}
        onChange={(s) => inbox.setStatus(kind, id, s, d.statuses.find(([v]) => v === s)?.[1] ?? s)}
      />
      {(d.phone || d.email) && (
        <section aria-label="How to reach them">
          <h3 className="adm-group-h">How to reach them</h3>
          <dl className="adm-ans">
            {d.phone && <div><dt>Phone</dt><dd className="adm-selectable">{d.phone}</dd></div>}
            {d.email && <div><dt>Email</dt><dd className="adm-selectable">{d.email}</dd></div>}
          </dl>
        </section>
      )}
      {kind === 'request' && <RequestAnswers r={item as EventRequest} />}
      {kind === 'message' && <MessageAnswers m={item as ContactMessage} />}
      {kind === 'teacher' && <TeacherAnswers a={item as ArtistApplication} />}
    </SheetFrame>
  )
}

export { ToDecideSheet } from './ToDecideSheet'
