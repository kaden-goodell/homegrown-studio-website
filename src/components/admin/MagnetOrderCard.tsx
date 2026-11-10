// src/components/admin/MagnetOrderCard.tsx
import { StatusPills } from '@components/admin/StatusPills'
import { STATUS_LABEL, PICKUP_STATUSES as PICKUP, SHIP_STATUSES as SHIP, productOf, itemsLabel, type MagnetOrder, type MagnetStatus } from '@lib/magnet-status'
import { SilhouettePrintButton } from '@components/admin/SilhouettePrintButton'
import { formatMoney } from '@lib/money'

export function MagnetOrderCard({ order: o, onMove }: { order: MagnetOrder; onMove: (id: string, s: MagnetStatus) => void }) {
  const when = new Date(o.createdAt).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  const unique = [...new Set(o.magnets)]
  const sil = productOf(o) === 'silhouettes'
  const photo = (p: string) => `/api/admin/magnet-photo?draft=${o.draftId}&photo=${p}`
  return (
    <article className="glass rounded-2xl" style={{ padding: '1.25rem', display: 'grid', gap: '0.6rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
        <h2 style={{ margin: 0, fontSize: '1.15rem' }}>{o.contact.name} · {o.id}</h2>
        <span style={{ fontSize: '0.85rem' }}>{when}{o.simulated ? ' · test' : ''}</span>
      </div>
      <p style={{ margin: 0, fontWeight: 600 }}>
        {sil ? `Framed silhouettes · ${itemsLabel(o)}` : itemsLabel(o)} · {o.delivery === 'pickup' ? 'Pickup' : `Ship to ${o.address}`} · {formatMoney(o.amounts.totalCents)}
      </p>
      <StatusPills name={o.id} current={o.status} statuses={(o.delivery === 'pickup' ? PICKUP : SHIP).map((s) => [s, STATUS_LABEL[s]] as [MagnetStatus, string])} onMove={(s) => onMove(o.id, s)} />
      {o.status === 'cancelled' && <p style={{ margin: 0, fontSize: '0.85rem' }}>Cancelled here only. Refund it in Square.</p>}
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', fontSize: '0.9rem' }}>
        <a href={`mailto:${o.contact.email}`}>{o.contact.email}</a>
        <a href={`tel:${o.contact.phone}`}>{o.contact.phone}</a>
      </div>
      {o.photosDeletedAt ? <p style={{ margin: 0, fontSize: '0.85rem' }}>Photos deleted {o.photosDeletedAt.slice(0, 10)}.</p> : sil ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: '0.6rem' }}>
            {o.magnets.map((p, i) => (
              <div key={p} style={{ display: 'grid', gap: '0.35rem', justifyItems: 'center' }}>
                <img src={photo(p)} alt={`Silhouette ${i + 1}`} loading="lazy" style={{ width: '100%', aspectRatio: '2 / 3', objectFit: 'cover', borderRadius: 4, boxShadow: '0 0 0 1px rgba(0,0,0,0.12)' }} />
                <SilhouettePrintButton src={photo(p)} filename={`${o.id}-${i + 1}.jpg`} label={o.magnets.length > 1 ? `Print ${i + 1}` : 'Print'} />
              </div>
            ))}
          </div>
          <p style={{ margin: 0, fontSize: '0.85rem' }}>Print opens the share sheet. Pick the photo printer's app, or Save Image.</p>
        </>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))', gap: '0.4rem' }}>
            {unique.map((p) => (
              <img key={p} src={photo(p)} alt="" loading="lazy" style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 4 }} />
            ))}
          </div>
          <a className="btn btn-primary" href={`/admin/magnets-print?id=${o.id}`} target="_blank" rel="noopener" style={{ justifySelf: 'start' }}>Print</a>
        </>
      )}
    </article>
  )
}
