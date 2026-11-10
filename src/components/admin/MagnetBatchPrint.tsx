import { useEffect, useState } from 'react'
import { productOf, type MagnetOrder } from '@lib/magnet-status'

const PER_PAGE = 12

/**
 * "Print new orders together": every New order back to back, so two orders of 6
 * share one sheet. Each magnet carries its order code on the folded edge.
 */
export function MagnetBatchPrint({ orders, onMarkMade }: { orders: MagnetOrder[]; onMarkMade: (ids: string[]) => void }) {
  const ready = orders.filter((o) => o.status === 'new' && !o.photosDeletedAt && productOf(o) === 'magnets')
  const [picked, setPicked] = useState<Set<string>>(() => new Set(ready.map((o) => o.id)))
  const readyKey = ready.map((o) => o.id).join(',')
  // New orders arriving are ticked by default; ones that left New drop out.
  useEffect(() => { setPicked(new Set(ready.map((o) => o.id))) }, [readyKey]) // eslint-disable-line react-hooks/exhaustive-deps
  if (ready.length < 2) return null

  const chosen = ready.filter((o) => picked.has(o.id))
  const magnets = chosen.reduce((n, o) => n + o.magnets.length, 0)
  const pages = Math.ceil(magnets / PER_PAGE)
  const toggle = (id: string) => setPicked((cur) => { const next = new Set(cur); if (next.has(id)) next.delete(id); else next.add(id); return next })

  return (
    <section className="glass rounded-2xl" aria-label="Print new orders together" style={{ padding: '1.25rem', display: 'grid', gap: '0.75rem' }}>
      <h2 style={{ margin: 0, fontSize: '1.15rem' }}>Print new orders together</h2>
      <p style={{ margin: 0, fontSize: '0.9rem' }}>They print back to back so no paper is wasted. Each magnet has its order code on the folded edge.</p>
      <div style={{ display: 'grid', gap: '0.4rem' }}>
        {ready.map((o) => (
          <label key={o.id} style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', fontSize: '1rem' }}>
            <input type="checkbox" checked={picked.has(o.id)} onChange={() => toggle(o.id)} style={{ width: 22, height: 22 }} />
            <span>{o.contact.name} · {o.magnets.length} magnets · {o.id}</span>
          </label>
        ))}
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        {chosen.length > 0 ? (
          <a className="btn btn-primary" href={`/admin/magnets-print?ids=${chosen.map((o) => o.id).join(',')}`} target="_blank" rel="noopener">
            Print {magnets} magnets ({pages} page{pages === 1 ? '' : 's'})
          </a>
        ) : <span style={{ fontSize: '0.9rem' }}>Tick at least one order.</span>}
        {chosen.length > 0 && (
          <button type="button" className="btn btn-secondary" onClick={() => onMarkMade(chosen.map((o) => o.id))}>Mark these as Made</button>
        )}
      </div>
    </section>
  )
}
