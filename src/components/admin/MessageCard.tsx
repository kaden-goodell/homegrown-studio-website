import { STATUSES, STATUS_LABEL, topicLabel, type ContactMessage, type MessageStatus } from '@lib/contact-options'
import { StatusPills } from './StatusPills'

const PILLS = STATUSES.map((s) => [s, STATUS_LABEL[s]] as [MessageStatus, string])

/** One contact message on /admin. */
export function MessageCard({ message: m, onMove }: { message: ContactMessage; onMove: (id: string, s: MessageStatus) => void }) {
  const about = topicLabel(m.topic)
  return (
    <article className="glass rounded-2xl" style={{ padding: '1.25rem', display: 'grid', gap: '0.6rem', fontSize: '0.95rem', color: 'var(--color-text)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h2 className="font-heading" style={{ margin: 0, fontSize: '1.2rem', color: 'var(--color-dark)' }}>{m.name}</h2>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-muted)' }}>
            {new Date(m.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' })}
            {about ? ` · ${about}` : ''}
          </p>
        </div>
        <StatusPills name={m.name} current={m.status} statuses={PILLS} onMove={(s) => onMove(m.id, s)} />
      </div>
      <p style={{ margin: 0, display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <a href={`mailto:${m.email}`} style={{ color: 'var(--color-primary)' }}>{m.email}</a>
        <a href={`tel:${m.phone.replace(/[^\d+]/g, '')}`} style={{ color: 'var(--color-primary)' }}>{m.phone}</a>
      </p>
      <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{m.message}</p>
    </article>
  )
}
