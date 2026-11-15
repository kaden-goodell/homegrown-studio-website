import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import ShopOrders from '@components/staff/ShopOrders'
import { StaffNavContext, type StaffNav } from '@components/staff/nav'
import StaffHeader from '@components/staff/StaffHeader'

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
afterEach(() => vi.unstubAllGlobals())

const magnetOrder = (over: any = {}) => ({
  id: 'M-ABC234', createdAt: '2026-11-09T18:00:00.000Z', status: 'new', draftId: '0f8fad5b-d9cb-469f-a165-70867728950e', sets: 1,
  magnets: Array(6).fill('1700000000000-deadbeef'), delivery: 'pickup', address: null,
  contact: { name: 'Mags Buyer', email: 'kaden+m@ourhometownstudio.com', phone: '4029802907' },
  amounts: { subtotalCents: 1800, taxCents: 162, shippingCents: 0, totalCents: 1962 },
  squareOrderId: 's', paymentId: 'p', receiptUrl: null, doneAt: null, photosDeletedAt: null, emailed: {}, ...over,
})
const STAFF = { id: 'cat', name: 'Catherine', role: 'crew' as const }

function server({ orders = [magnetOrder()], moveFails = false } = {}) {
  return vi.fn(async (url: string, init?: any) => {
    if (url === '/api/staff/shop-orders.json') {
      if (init?.method === 'POST') {
        if (moveFails) return { ok: false, status: 409, json: async () => ({ error: 'The photos were deleted, so this order cannot move back.' }) }
        const b = JSON.parse(init.body)
        return ok({ data: { order: { ...orders.find((o: any) => o.id === b.id), status: b.status }, emailed: false } })
      }
      return ok({ data: { orders } })
    }
    // the photo previews and silhouette print buttons fetch images; none here
    return { ok: false, status: 404, json: async () => ({}), blob: async () => new Blob() }
  })
}

describe('ShopOrders (/staff Orders tab)', () => {
  it('lists an order with its print link, and moves its status', async () => {
    const fetchMock = server()
    vi.stubGlobal('fetch', fetchMock)
    const onNewCount = vi.fn()
    render(<ShopOrders staff={STAFF} onNewCount={onNewCount} />)
    expect(await screen.findByText(/Mags Buyer · M-ABC234/, {}, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Print' })).toHaveAttribute('href', '/staff/magnets-print?id=M-ABC234')
    expect(onNewCount).toHaveBeenLastCalledWith(1)
    const group = screen.getByRole('group', { name: 'Status for M-ABC234' })
    fireEvent.click(within(group).getByRole('button', { name: 'Made' }))
    expect(await within(group).findByRole('button', { name: 'Made', pressed: true }, { timeout: 5000 })).toBeInTheDocument()
    const post = fetchMock.mock.calls.find((c) => c[0] === '/api/staff/shop-orders.json' && c[1]?.method === 'POST')!
    expect(JSON.parse(post[1].body)).toEqual({ id: 'M-ABC234', status: 'made' })
    expect(onNewCount).toHaveBeenLastCalledWith(0)
  })

  it('offers the batch print for two or more new magnet orders', async () => {
    vi.stubGlobal('fetch', server({ orders: [magnetOrder(), magnetOrder({ id: 'M-DEF567', contact: { name: 'Second', email: 'kaden+n@ourhometownstudio.com', phone: '4029802907' } })] }))
    render(<ShopOrders staff={STAFF} />)
    const batch = await screen.findByRole('region', { name: 'Print new orders together' })
    expect(within(batch).getByRole('link', { name: /Print 12 magnets/ })).toHaveAttribute('href', '/staff/magnets-print?ids=M-ABC234,M-DEF567')
  })

  it('shows the server message when an order cannot move', async () => {
    vi.stubGlobal('fetch', server({ moveFails: true }))
    render(<ShopOrders staff={STAFF} />)
    await screen.findByText(/Mags Buyer · M-ABC234/)
    fireEvent.click(within(screen.getByRole('group', { name: 'Status for M-ABC234' })).getByRole('button', { name: 'Made' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/photos were deleted/)
  })

  it('the staff tabs include Orders, with its new count', () => {
    const nav: StaffNav = { active: 'orders', go: vi.fn(), switchStaff: vi.fn(), logout: vi.fn(), newCounts: { orders: 2 } }
    render(<StaffNavContext.Provider value={nav}><StaffHeader staff={STAFF} /></StaffNavContext.Provider>)
    const tab = screen.getByRole('button', { name: 'Orders (2 new)' })
    expect(tab).toHaveAttribute('aria-current', 'page')
    fireEvent.click(tab)
    expect(nav.go).toHaveBeenCalledWith('orders')
  })
})
