// Review (16 Nov 2026): with no signature key set, every Square notice is refused (500) and nothing is handled.
import { describe, it, expect, vi } from 'vitest'
import { createHmac } from 'node:crypto'

const mockHandleEvent = vi.fn()
vi.mock('@config/providers', () => ({ providers: { notification: { send: vi.fn() } } }))
vi.mock('@lib/classes/square-events', () => ({
  CLASS_EVENTS: new Set(['order.created', 'order.updated', 'payment.created', 'payment.updated', 'refund.created', 'refund.updated']),
  handleSquareEvent: (...a: any[]) => mockHandleEvent(...a),
}))

delete process.env.SQUARE_WEBHOOK_SIGNATURE_KEY
const { POST } = await import('../../src/pages/api/webhooks/square.json')

describe('Square webhook with no signature key set', () => {
  it('refuses with 500 and never handles the notice, whatever signature it carries', async () => {
    const body = JSON.stringify({ type: 'payment.updated', event_id: 'ev1', data: { type: 'payment', id: 'p1', object: {} } })
    for (const sig of ['', createHmac('sha256', '').update(`https://ourhometownstudio.com/api/webhooks/square.json${body}`).digest('base64'), 'anything']) {
      const request = new Request('https://ourhometownstudio.com/api/webhooks/square.json', { method: 'POST', headers: { 'x-square-hmacsha256-signature': sig }, body })
      const res = await POST({ request, locals: {} } as any)
      expect(res.status).toBe(500)
    }
    expect(mockHandleEvent).not.toHaveBeenCalled()
  })
})
