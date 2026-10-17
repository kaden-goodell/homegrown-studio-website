import type { ReactNode } from 'react'
import {
  PLACES, SETTINGS, YES_NO, CRAFT_PICKS, BUDGETS, CONTACT_BY, STATUSES, STATUS_LABEL,
  label, kindLabel, whenLabel, crafterLabel, extrasLines, type EventRequest, type RequestStatus,
} from '@lib/event-request-options'
import { formatCalendarDay } from '@lib/studio-time'
import { StatusPills } from './StatusPills'

const PILLS = STATUSES.map((s) => [s, STATUS_LABEL[s]] as [RequestStatus, string])

/** One private event request on /admin: the headline, how to reach them, then every answer, grouped like the form. */
export function EventRequestCard({ request: r, onMove }: { request: EventRequest; onMove: (id: string, s: RequestStatus) => void }) {
  const e = r.event
  const w = r.where
  const c = r.craft
  const row = (k: string, v: ReactNode) => (v ? <p style={{ margin: 0 }}><strong style={{ color: 'var(--color-dark)' }}>{k}</strong> {v}</p> : null)
  const group = (title: string, rows: ReactNode[]) =>
    rows.some(Boolean) ? (
      <div style={{ display: 'grid', gap: '0.25rem' }}>
        <p style={{ margin: 0, fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-primary)' }}>{title}</p>
        {rows}
      </div>
    ) : null
  const kind = kindLabel(r)
  const extras = extrasLines(r)
  return (
    <article className="glass rounded-2xl" style={{ padding: '1.25rem', display: 'grid', gap: '0.85rem', fontSize: '0.95rem', color: 'var(--color-text)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h2 className="font-heading" style={{ margin: 0, fontSize: '1.2rem', color: 'var(--color-dark)' }}>
            {r.about.name}{r.about.org ? ` · ${r.about.org}` : ''}
          </h2>
          <p style={{ margin: 0, fontSize: '0.95rem', color: 'var(--color-dark)' }}>
            {[kind, whenLabel(r), `${e.guests} guest${e.guests === 1 ? '' : 's'}`, label(PLACES, w.place)].filter(Boolean).join(' · ')}
          </p>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-muted)' }}>
            Sent {new Date(r.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' })}
          </p>
        </div>
        <StatusPills name={r.about.name} current={r.status} statuses={PILLS} onMove={(s) => onMove(r.id, s)} />
      </div>
      <p style={{ margin: 0, display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <a href={`mailto:${r.about.email}`} style={{ color: 'var(--color-primary)' }}>{r.about.email}</a>
        <a href={`tel:${r.about.phone.replace(/[^\d+]/g, '')}`} style={{ color: 'var(--color-primary)' }}>{r.about.phone}</a>
        {r.about.contactBy && <span style={{ color: 'var(--color-muted)' }}>Prefers {label(CONTACT_BY, r.about.contactBy).toLowerCase()}</span>}
      </p>
      {group('The event', [
        row('Backup date', e.backupDate ? formatCalendarDay(e.backupDate) : ''),
        row('Flexible on the date', e.flexible ? 'Yes' : ''),
        row('How long', e.length),
        row('Who’s crafting', crafterLabel(r)),
      ])}
      {group('Where', [
        row('Address', w.address),
        row('Indoors or outdoors', label(SETTINGS, w.setting)),
        row('Tables and chairs there', label(YES_NO, w.tables)),
        row('Sink nearby', label(YES_NO, w.sink)),
        row('Can set up from', w.setupFrom),
        row('Getting in', w.access),
      ])}
      {group('The craft', [
        row('Wants', label(CRAFT_PICKS, c.pick)),
        row('Their vision', c.vision),
        row('Theme or colors', c.theme),
        row('Personalized', c.personalized),
        row('Inspiration', c.link ? <a href={/^https?:\/\//.test(c.link) ? c.link : `https://${c.link}`} target="_blank" rel="noreferrer noopener" style={{ color: 'var(--color-primary)', textDecoration: 'underline' }}>{c.link}</a> : ''),
      ])}
      {r.photos > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(7rem, 1fr))', gap: '0.5rem' }}>
          {Array.from({ length: r.photos }, (_, n) => {
            const src = `/api/admin/event-request-photo?id=${encodeURIComponent(r.id)}&n=${n}`
            return <a key={n} href={src} target="_blank" rel="noreferrer"><img src={src} alt={`${r.about.name}, inspiration photo ${n + 1}`} loading="lazy" style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: '0.5rem', display: 'block' }} /></a>
          })}
        </div>
      )}
      {group('Extras', [...extras.map(([k, v]) => row(k, v)), row('Food allergies', r.allergies)])}
      {group('More', [
        row('Budget', label(BUDGETS, r.budget)),
        row('Heard about us', r.about.heard),
        row('Anything else', r.notes),
      ])}
    </article>
  )
}
