import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import '../../styles/booking-panel.css'
import type { ArtistApplication, ApplicationStatus } from '@lib/artist-applications'
import type { EventRequest } from '@lib/event-request-options'
import { STATUS_LABEL as REQUEST_LABEL, STATUSES as REQUEST_STATUSES, type RequestStatus } from '@lib/event-request-options'
import { EventRequestCard } from './EventRequestCard'
import { StatusPills } from './StatusPills'
import { MessageCard } from './MessageCard'
import { STATUSES as MESSAGE_STATUSES, STATUS_LABEL as MESSAGE_LABEL, type ContactMessage, type MessageStatus } from '@lib/contact-options'
import CalendarView from './classes/CalendarView'
import ClassList from './classes/ClassList'
import LibraryList from './classes/LibraryList'
import BlockTimeForm from './classes/BlockTimeForm'
import ClassEditor, { type EditorMode } from './classes/ClassEditor'
import ClassBookings from './classes/ClassBookings'
import PrintDay from './classes/PrintDay'

const STATUSES: [ApplicationStatus, string][] = [['new', 'New'], ['talking', 'Talking'], ['booked', 'Booked'], ['not-now', 'Not now']]
const AUDIENCE: Record<string, string> = { kids: 'Kids & teens', adults: 'Adults', both: 'Both' }
const OFTEN: Record<string, string> = { 'one-time': 'One-time', monthly: 'Monthly', series: 'A series' }

type Tab = 'calendar' | 'classes' | 'library' | 'block' | 'events' | 'messages' | 'teachers'

/** What covers the tab's list while open: a class form, a class's bookings, or a day to print. */
type Panel =
  | { kind: 'editor'; mode: EditorMode; back: Panel | null }
  | { kind: 'bookings'; id: string }
  | { kind: 'print'; day: string }

/**
 * /admin: owner-only tools. Classes (the calendar of everything holding the
 * room, our classes, the class library, blocked time, a day's sheet to
 * print), private event requests from /private-events
 * (New → Quoted → Booked → Not this time), messages from /contact (New →
 * Replied), and teacher applications from /teach (New → Talking → Booked →
 * Not now).
 */
export default function AdminApp() {
  const [state, setState] = useState<'loading' | 'signed-out' | 'ready' | 'error'>('loading')
  const [apps, setApps] = useState<ArtistApplication[]>([])
  const [requests, setRequests] = useState<EventRequest[]>([])
  const [messages, setMessages] = useState<ContactMessage[]>([])
  const [tab, setTab] = useState<Tab>('events')
  const [panel, setPanel] = useState<Panel | null>(null)
  const [flash, setFlash] = useState('')
  const [passcode, setPasscode] = useState('')
  const [loginError, setLoginError] = useState('')

  async function load() {
    setState('loading')
    try {
      const [a, r, m] = await Promise.all([
        fetch('/api/admin/applications.json', { cache: 'no-store' }),
        fetch('/api/admin/event-requests.json', { cache: 'no-store' }),
        fetch('/api/admin/messages.json', { cache: 'no-store' }),
      ])
      if ([a, r, m].some((x) => x.status === 401)) return setState('signed-out')
      if (![a, r, m].every((x) => x.ok)) throw new Error(`${a.status}/${r.status}/${m.status}`)
      setApps((await a.json()).data.applications)
      setRequests((await r.json()).data.requests)
      setMessages((await m.json()).data.messages)
      setState('ready')
    } catch {
      setState('error')
    }
  }
  useEffect(() => { load() }, [])

  async function signIn(e: FormEvent) {
    e.preventDefault()
    setLoginError('')
    const res = await fetch('/api/admin/login.json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passcode }) })
    if (!res.ok) return setLoginError((await res.json().catch(() => null))?.error ?? 'That didn’t work.')
    setPasscode('')
    load()
  }

  async function moveApp(id: string, status: ApplicationStatus) {
    const res = await fetch('/api/admin/applications.json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }) })
    if (res.ok) {
      const { application } = (await res.json()).data
      setApps((list) => list.map((a) => (a.id === id ? application : a)))
    }
  }

  async function moveRequest(id: string, status: RequestStatus) {
    const res = await fetch('/api/admin/event-requests.json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }) })
    if (res.ok) {
      const { request } = (await res.json()).data
      setRequests((list) => list.map((r) => (r.id === id ? request : r)))
    }
  }

  async function moveMessage(id: string, status: MessageStatus) {
    const res = await fetch('/api/admin/messages.json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }) })
    if (res.ok) {
      const { message } = (await res.json()).data
      setMessages((list) => list.map((m) => (m.id === id ? message : m)))
    }
  }

  if (state === 'loading') return <p style={{ color: 'var(--color-muted)' }}>Loading…</p>
  if (state === 'error') return <p role="alert">Couldn’t load just now. <button type="button" className="btn btn-secondary" onClick={load}>Try again</button></p>
  if (state === 'signed-out') {
    return (
      <form onSubmit={signIn} className="glass rounded-2xl" style={{ padding: '1.5rem', display: 'grid', gap: '0.75rem', maxWidth: '22rem' }}>
        <h1 className="font-heading" style={{ margin: 0, fontSize: '1.5rem', color: 'var(--color-dark)' }}>Admin</h1>
        <label className="field-label" htmlFor="admin-passcode">Passcode</label>
        <input id="admin-passcode" className="field-input" type="password" autoComplete="current-password" value={passcode} onChange={(e) => setPasscode(e.target.value)} />
        {loginError && <p role="alert" className="field-error">{loginError}</p>}
        <button type="submit" className="btn btn-primary">Sign in</button>
      </form>
    )
  }

  const newCount = (list: { status: string }[]) => list.filter((x) => x.status === 'new').length
  const tabLabel = (label: string, list: { status: string }[]) => (newCount(list) ? `${label} (${newCount(list)} new)` : label)
  return (
    <div style={{ display: 'grid', gap: '1.25rem' }}>
      <div role="tablist" aria-label="Admin" style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
        {([['calendar', 'Calendar'], ['classes', 'Classes'], ['library', 'Library'], ['block', 'Block time'], ['events', tabLabel('Private events', requests)], ['messages', tabLabel('Messages', messages)], ['teachers', tabLabel('Teachers', apps)]] as [Tab, string][]).map(([t, l]) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => { setTab(t); setPanel(null); setFlash('') }} className={tab === t ? 'btn btn-primary' : 'btn btn-secondary'}>{l}</button>
        ))}
      </div>
      {flash && <p role="status" style={{ margin: 0, fontWeight: 600 }}>{flash}</p>}
      {panel?.kind === 'editor' && (
        <ClassEditor
          key={JSON.stringify(panel.mode.kind) + ('cls' in panel.mode ? panel.mode.cls.id : 'lib' in panel.mode ? panel.mode.lib?.id ?? '' : '')}
          mode={panel.mode}
          onCancel={() => setPanel(panel.back)}
          onSaved={(s) => {
            // A new class or a library save goes back to its list; an edit stays open to keep working.
            if (panel.mode.kind === 'edit') return
            setFlash(s.warning ?? (s.lib ? 'Saved to the library.' : 'Added.'))
            setPanel(s.cls ? { kind: 'bookings', id: s.cls.id } : null)
          }}
        />
      )}
      {panel?.kind === 'bookings' && (
        <ClassBookings
          key={panel.id}
          id={panel.id}
          onBack={() => { setPanel(null); setFlash('') }}
          onEdit={(cls) => setPanel({ kind: 'editor', mode: { kind: 'edit', cls }, back: { kind: 'bookings', id: cls.id } })}
          onDuplicated={(cls) => { setFlash('Added.'); setPanel({ kind: 'bookings', id: cls.id }) }}
        />
      )}
      {panel?.kind === 'print' && <PrintDay day={panel.day} onBack={() => setPanel(null)} />}
      {!panel && tab === 'calendar' && (
        <CalendarView onOpenClass={(id) => setPanel({ kind: 'bookings', id })} onPrintDay={(day) => setPanel({ kind: 'print', day })} />
      )}
      {!panel && tab === 'classes' && (
        <ClassList onOpen={(id) => setPanel({ kind: 'bookings', id })} onNew={() => setPanel({ kind: 'editor', mode: { kind: 'new' }, back: null })} />
      )}
      {!panel && tab === 'library' && (
        <LibraryList
          onNew={() => setPanel({ kind: 'editor', mode: { kind: 'library' }, back: null })}
          onEdit={(lib) => setPanel({ kind: 'editor', mode: { kind: 'library', lib }, back: null })}
          onScheduleWithEdits={(lib) => setPanel({ kind: 'editor', mode: { kind: 'from-library', lib }, back: null })}
          onScheduled={(cls, warning) => { setFlash(warning ?? 'Added.'); setPanel({ kind: 'bookings', id: cls.id }) }}
        />
      )}
      {!panel && tab === 'block' && <BlockTimeForm />}
      {!panel && tab === 'events' && (
        <StatusList
          title="Private event requests"
          items={requests}
          statuses={REQUEST_STATUSES.map((s) => [s, REQUEST_LABEL[s]] as [RequestStatus, string])}
          empty="No requests yet. They’ll show up here when people use ourhometownstudio.com/private-events."
          render={(r) => <EventRequestCard key={r.id} request={r} onMove={moveRequest} />}
        />
      )}
      {!panel && tab === 'messages' && (
        <StatusList
          title="Messages"
          items={messages}
          statuses={MESSAGE_STATUSES.map((s) => [s, MESSAGE_LABEL[s]] as [MessageStatus, string])}
          empty="No messages yet. They’ll show up here when people use ourhometownstudio.com/contact."
          render={(m) => <MessageCard key={m.id} message={m} onMove={moveMessage} />}
        />
      )}
      {!panel && tab === 'teachers' && (
        <StatusList
          title="Teacher applications"
          items={apps}
          statuses={STATUSES}
          empty="No applications yet. They’ll show up here when artists use ourhometownstudio.com/teach."
          render={(a) => <Application key={a.id} app={a} onMove={moveApp} />}
        />
      )}
    </div>
  )
}

/** A heading, "All / New / …" filters with counts, then the matching cards. */
function StatusList<S extends string, T extends { id: string; status: S }>({ title, items, statuses, empty, render }: {
  title: string
  items: T[]
  statuses: [S, string][]
  empty: string
  render: (item: T) => ReactNode
}) {
  const [show, setShow] = useState<S | 'all'>('all')
  const shown = items.filter((x) => show === 'all' || x.status === show)
  const count = (s: S) => items.filter((x) => x.status === s).length
  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <h1 className="font-heading" style={{ margin: 0, fontSize: '1.75rem', color: 'var(--color-dark)' }}>{title}</h1>
      <div role="group" aria-label="Show" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
        {([['all', `All (${items.length})`], ...statuses.map(([s, l]) => [s, `${l} (${count(s)})`])] as [S | 'all', string][]).map(([s, l]) => (
          <button key={s} type="button" aria-pressed={show === s} onClick={() => setShow(s)} className={show === s ? 'btn btn-primary' : 'btn btn-secondary'} style={{ padding: '0.4rem 0.9rem', fontSize: '0.85rem' }}>{l}</button>
        ))}
      </div>
      {shown.length === 0 && <p style={{ color: 'var(--color-muted)' }}>{items.length === 0 ? empty : 'None here.'}</p>}
      {shown.map(render)}
    </div>
  )
}

function Application({ app, onMove }: { app: ArtistApplication; onMove: (id: string, s: ApplicationStatus) => void }) {
  const c = app.classIdea
  const row = (k: string, v: string) => (v ? <p style={{ margin: 0 }}><strong style={{ color: 'var(--color-dark)' }}>{k}</strong> {v}</p> : null)
  const link = (label: string, href: string) => {
    if (!href) return null
    const url = /^https?:\/\//.test(href) ? href : href.startsWith('@') && label === 'Instagram' ? `https://instagram.com/${href.slice(1)}` : href.startsWith('@') && label === 'TikTok' ? `https://www.tiktok.com/${href}` : `https://${href}`
    return <a key={label} href={url} target="_blank" rel="noreferrer noopener" style={{ color: 'var(--color-primary)', textDecoration: 'underline' }}>{label}</a>
  }
  return (
    <article className="glass rounded-2xl" style={{ padding: '1.25rem', display: 'grid', gap: '0.6rem', fontSize: '0.95rem', color: 'var(--color-text)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h2 className="font-heading" style={{ margin: 0, fontSize: '1.2rem', color: 'var(--color-dark)' }}>{app.about.name}{app.about.business ? ` · ${app.about.business}` : ''}</h2>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-muted)' }}>{new Date(app.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' })}{app.about.city ? ` · ${app.about.city}` : ''}</p>
        </div>
        <StatusPills name={app.about.name} current={app.status} statuses={STATUSES} onMove={(s) => onMove(app.id, s)} />
      </div>
      <p style={{ margin: 0, display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <a href={`mailto:${app.about.email}`} style={{ color: 'var(--color-primary)' }}>{app.about.email}</a>
        <a href={`tel:${app.about.phone.replace(/[^\d+]/g, '')}`} style={{ color: 'var(--color-primary)' }}>{app.about.phone}</a>
        {link('Instagram', app.links.instagram)}{link('Website', app.links.website)}{link('TikTok', app.links.tiktok)}{link('Etsy', app.links.etsy)}{link('Video', app.links.video)}
      </p>
      {row('Class:', c.what)}
      {row('Takes home:', c.takeHome)}
      {row('For:', [AUDIENCE[c.audience], c.dropOffOk === 'yes' ? 'drop-off OK' : c.dropOffOk === 'no' ? 'no drop-off' : ''].filter(Boolean).join(', '))}
      {row('Length:', c.length)}
      {row('Group:', [c.groupMin, c.groupMax].filter(Boolean).join(' to '))}
      {row('Price per person:', c.price)}
      {row('Supplies per person:', c.suppliesCost)}
      {row('Needs from us:', c.needs)}
      {row('Experience:', app.experience)}
      {row('When:', [app.when.days, OFTEN[app.when.howOften]].filter(Boolean).join(' · '))}
      {app.photos > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(7rem, 1fr))', gap: '0.5rem' }}>
          {Array.from({ length: app.photos }, (_, n) => {
            const src = `/api/admin/application-photo?id=${encodeURIComponent(app.id)}&n=${n}`
            return <a key={n} href={src} target="_blank" rel="noreferrer"><img src={src} alt={`${app.about.name}, photo ${n + 1}`} loading="lazy" style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: '0.5rem', display: 'block' }} /></a>
          })}
        </div>
      )}
    </article>
  )
}
