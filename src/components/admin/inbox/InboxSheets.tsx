import { useEffect, useState } from 'react'
import type { ArtistApplication } from '@lib/artist-applications'
import type { ContactMessage } from '@lib/contact-options'
import type { EventRequest } from '@lib/event-request-options'
import { chipClass, chipText, draftQuote, loadQuote, type QuoteView } from '../quotes/api'
import { MakeAnyway } from '../quotes/QuoteSheet'
import { SheetFrame, useSheet } from '../shell/Sheet'
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

/** A request's quote, read when its sheet opens (and again when its status moves). */
function useRequestQuote(requestId: string | null, status: string) {
  const [view, setView] = useState<QuoteView | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [tries, setTries] = useState(0)
  useEffect(() => {
    if (!requestId) return
    let live = true
    setError('')
    loadQuote(requestId).then((r) => {
      if (!live) return
      if (r.ok && r.data) { setView(r.data.view); setLoaded(true) }
      else setError(r.error ?? 'That didn’t load.')
    })
    return () => { live = false }
  }, [requestId, status, tries])
  return { view, loaded, error, retry: () => setTries((n) => n + 1) }
}

/** Make a quote / Open quote beside the status, with the quote's chip under it. Making one on a Quoted or Booked request asks first. */
function QuoteEntry({ request, quote }: { request: EventRequest; quote: ReturnType<typeof useRequestQuote> }) {
  const sheet = useSheet()
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const open = () => sheet.open({ kind: 'quote', id: request.id })

  async function make() {
    setAsking(false)
    setBusy(true)
    setError('')
    const r = await draftQuote(request.id, request.status === 'booked' ? { force: true } : {})
    setBusy(false)
    if (r.ok) open()
    else setError(r.error ?? 'That didn’t work. Try again.')
  }

  if (quote.error && !quote.loaded) {
    return (
      <div className="adm-quoteentry">
        <span className="adm-small adm-muted">Couldn’t check for a quote.</span>
        <button type="button" className="adm-btn is-ghost is-sm" onClick={quote.retry}>Try again</button>
      </div>
    )
  }
  if (!quote.loaded) return <div className="adm-quoteentry"><span className="adm-small adm-muted">Checking for a quote…</span></div>
  const v = quote.view
  return (
    <>
      <div className="adm-quoteentry">
        {v ? (
          <button type="button" className="adm-btn is-pri" onClick={open}>Open quote</button>
        ) : (
          <button type="button" className="adm-btn is-pri" disabled={busy}
            onClick={() => (request.status === 'quoted' || request.status === 'booked' ? setAsking(true) : make())}>
            {busy ? 'Making it…' : 'Make a quote'}
          </button>
        )}
        {v && <span className={chipClass(v.status)} aria-label="Quote status">{chipText(v.status, v.views)}</span>}
      </div>
      {asking && <MakeAnyway status={request.status} busy={busy} onNo={() => setAsking(false)} onYes={make} />}
      {error && <p className="adm-error" role="alert">{error}</p>}
    </>
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
  return <ItemSheet kind={kind} id={id} item={item} />
}

function ItemSheet({ kind, id, item }: { kind: InboxKind; id: string; item: InboxItem }) {
  const inbox = useInbox()
  const quote = useRequestQuote(kind === 'request' ? id : null, item.status)
  const d = describeItem(kind, item, quote.view ? { status: quote.view.status, sentAt: quote.view.sentAt } : null)
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
      {kind === 'request' && <QuoteEntry request={item as EventRequest} quote={quote} />}
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
