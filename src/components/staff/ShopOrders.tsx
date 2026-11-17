import { useCallback, useEffect, useState } from 'react'
import StaffHeader from '@components/staff/StaffHeader'
import { btn } from '@components/staff/ui'
import { StatusList } from '@components/shared/StatusList'
import { MagnetBatchPrint } from '@components/orders/MagnetBatchPrint'
import { MagnetOrderCard } from '@components/orders/MagnetOrderCard'
import { STATUSES, STATUS_LABEL, type MagnetOrder, type MagnetStatus } from '@lib/magnet-status'
import type { StaffMember } from '@lib/staff-auth'

const ENDPOINT = '/api/staff/shop-orders.json'

/**
 * Orders: shop orders (photo magnets and framed silhouettes) to print and
 * hand over. On /staff so anyone working can print them, not just the owners
 * (Kaden, 15 Nov 2026). `onNewCount` keeps the tab's "(2 new)" in step.
 */
export default function ShopOrders({ staff, onNewCount }: { staff: StaffMember; onNewCount?: (n: number) => void }) {
  const [orders, setOrders] = useState<MagnetOrder[] | null>(null)
  const [error, setError] = useState('')
  const [moveError, setMoveError] = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      const res = await fetch(ENDPOINT, { cache: 'no-store' })
      const body = await res.json().catch(() => null)
      if (!res.ok) { setError(body?.error ?? 'Couldn’t load orders.'); return }
      setOrders(body.data.orders)
    } catch {
      setError('Couldn’t reach the studio server — check wifi and tap Retry.')
    }
  }, [])
  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (orders) onNewCount?.(orders.filter((o) => o.status === 'new').length)
  }, [orders, onNewCount])

  async function move(id: string, status: MagnetStatus) {
    setMoveError('')
    try {
      const res = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }) })
      const body = await res.json().catch(() => ({}))
      if (res.ok) setOrders((list) => (list ?? []).map((o) => (o.id === id ? body.data.order : o)))
      else setMoveError(body?.error ?? 'That didn’t work. Try again.')
    } catch {
      setMoveError('That didn’t work. Try again.')
    }
  }

  return (
    <div>
      <StaffHeader title="Orders" staff={staff} />
      {error && (
        <div role="alert" style={{ background: 'rgba(185,28,28,0.08)', border: '1px solid rgba(185,28,28,0.3)', borderRadius: '0.6rem', padding: '0.7rem 0.9rem', marginBottom: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          <span style={{ flex: 1, fontSize: '0.875rem', color: '#b91c1c', fontWeight: 600 }}>{error}</span>
          <button type="button" onClick={load} style={btn()}>Retry</button>
        </div>
      )}
      {!orders && !error && <p style={{ color: 'var(--color-muted)', textAlign: 'center' }}>Loading…</p>}
      {orders && (
        <div style={{ display: 'grid', gap: '1.25rem' }}>
          {moveError && <p role="alert" className="field-error">{moveError}</p>}
          <MagnetBatchPrint orders={orders} onMarkMade={(ids) => { for (const id of ids) void move(id, 'made') }} />
          <StatusList
            title="Shop orders"
            items={orders}
            statuses={STATUSES.map((s) => [s, STATUS_LABEL[s]] as [MagnetStatus, string])}
            empty="No shop orders yet."
            render={(o) => <MagnetOrderCard key={o.id} order={o} onMove={move} />}
          />
        </div>
      )}
    </div>
  )
}
