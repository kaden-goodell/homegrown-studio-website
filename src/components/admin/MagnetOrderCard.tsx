// src/components/admin/MagnetOrderCard.tsx
import { StatusPills } from '@components/admin/StatusPills'
import { STATUS_LABEL, PICKUP_STATUSES as PICKUP, SHIP_STATUSES as SHIP, type MagnetOrder, type MagnetStatus } from '@lib/magnet-status'
import { formatMoney } from '@lib/money'

export function MagnetOrderCard({ order: o, onMove }: { order: MagnetOrder; onMove: (id: string, s: MagnetStatus) => void }) {
  const when = new Date(o.createdAt).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  const unique = [...new Set(o.magnets)]
  return (
    <article className="glass rounded-2xl" style={{ padding: '1.25rem', display: 'grid', gap: '0.6rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
        <h2 style={{ margin: 0, fontSize: '1.15rem' }}>{o.contact.name} · {o.id}</h2>
        <span style={{ fontSize: '0.85rem' }}>{when}{o.simulated ? ' · test' : ''}</span>
      </div>
      <p style={{ margin: 0, fontWeight: 600 }}>
        {o.magnets.length} magnets · {o.delivery === 'pickup' ? 'Pickup' : `Ship to ${o.address}`} · {formatMoney(o.amounts.totalCents)}
      </p>
      <StatusPills name={o.id} current={o.status} statuses={(o.delivery === 'pickup' ? PICKUP : SHIP).map((s) => [s, STATUS_LABEL[s]] as [MagnetStatus, string])} onMove={(s) => onMove(o.id, s)} />
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', fontSize: '0.9rem' }}>
        <a href={`mailto:${o.contact.email}`}>{o.contact.email}</a>
        <a href={`tel:${o.contact.phone}`}>{o.contact.phone}</a>
      </div>
      {o.photosDeletedAt ? <p style={{ margin: 0, fontSize: '0.85rem' }}>Photos deleted {o.photosDeletedAt.slice(0, 10)}.</p> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))', gap: '0.4rem' }}>
            {unique.map((p) => (
              <img key={p} src={`/api/admin/magnet-photo?draft=${o.draftId}&photo=${p}`} alt="" loading="lazy" style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 4 }} />
            ))}
          </div>
          <a className="btn btn-primary" href={`/admin/magnets-print?id=${o.id}`} target="_blank" rel="noopener" style={{ justifySelf: 'start' }}>Print</a>
        </>
      )}
    </article>
  )
}
