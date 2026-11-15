import { useState, type ReactNode } from 'react'

/** A heading, "All / New / …" filters with counts, then the matching cards. Used on /admin and the /staff Orders tab. */
export function StatusList<S extends string, T extends { id: string; status: S }>({ title, items, statuses, empty, render }: {
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
          <button key={s} type="button" aria-pressed={show === s} onClick={() => setShow(s)} className={show === s ? 'btn btn-primary' : 'btn btn-secondary'} style={{ padding: '0.4rem 0.9rem', fontSize: '0.85rem', minHeight: '2.75rem' }}>{l}</button>
        ))}
      </div>
      {shown.length === 0 && <p style={{ color: 'var(--color-muted)' }}>{items.length === 0 ? empty : 'None here.'}</p>}
      {shown.map(render)}
    </div>
  )
}
