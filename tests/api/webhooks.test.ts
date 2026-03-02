import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHmac } from 'node:crypto'

// Mock providers before importing route
const mockNotificationSend = vi.fn()
vi.mock('@config/providers', () => ({
  providers: {
    notification: { send: mockNotificationSend },
  },
}))

// Must set env before importing the route
const TEST_SIGNATURE_KEY = 'test-webhook-signature-key'
const TEST_WEBHOOK_URL = 'https://example.com/api/webhooks/square.json'
process.env.SQUARE_WEBHOOK_SIGNATURE_KEY = TEST_SIGNATURE_KEY
process.env.SQUARE_WEBHOOK_URL = TEST_WEBHOOK_URL

const { POST } = await import('../../src/pages/api/webhooks/square.json')
const { verifySquareSignature } = await import('../../src/lib/webhook-verify')

function makeSignature(body: string): string {
  return createHmac('sha256', TEST_SIGNATURE_KEY)
    .update(TEST_WEBHOOK_URL + body)
    .digest('base64')
}

function makeRequest(body: string, signature?: string): Request {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (signature !== undefined) {
    headers['x-square-hmacsha256-signature'] = signature
  }
  return new Request(TEST_WEBHOOK_URL, {
    method: 'POST',
    headers,
    body,
  })
}

const apiContext = { request: null as unknown as Request } as any

describe('Square webhook handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects requests with invalid signature', async () => {
    const body = JSON.stringify({ type: 'booking.created', data: {} })
    apiContext.request = makeRequest(body, 'bad-signature')

    const response = await POST(apiContext)
    expect(response.status).toBe(403)

    const json = await response.json()
    expect(json.error).toBe('Invalid signature')
  })

  it('accepts requests with valid HMAC signature', async () => {
    const body = JSON.stringify({ type: 'booking.created', data: { id: 'BK1' } })
    apiContext.request = makeRequest(body, makeSignature(body))

    const response = await POST(apiContext)
    expect(response.status).toBe(200)

    const json = await response.json()
    expect(json.received).toBe(true)
  })

  it('sends notification for handled event types', async () => {
    mockNotificationSend.mockResolvedValue(undefined)
    const body = JSON.stringify({ type: 'booking.created', data: { id: 'BK1' } })
    apiContext.request = makeRequest(body, makeSignature(body))

    await POST(apiContext)

    expect(mockNotificationSend).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'webhook',
        title: 'Square webhook: booking.created',
        severity: 'info',
      })
    )
  })

  it('handles booking.updated events', async () => {
    mockNotificationSend.mockResolvedValue(undefined)
    const body = JSON.stringify({ type: 'booking.updated', data: { id: 'BK2' } })
    apiContext.request = makeRequest(body, makeSignature(body))

    const response = await POST(apiContext)
    expect(response.status).toBe(200)
    expect(mockNotificationSend).toHaveBeenCalled()
  })

  it('handles payment.created events', async () => {
    mockNotificationSend.mockResolvedValue(undefined)
    const body = JSON.stringify({ type: 'payment.created', data: { id: 'PAY1' } })
    apiContext.request = makeRequest(body, makeSignature(body))

    const response = await POST(apiContext)
    expect(response.status).toBe(200)
    expect(mockNotificationSend).toHaveBeenCalled()
  })

  it('handles payment.updated events', async () => {
    mockNotificationSend.mockResolvedValue(undefined)
    const body = JSON.stringify({ type: 'payment.updated', data: { id: 'PAY2' } })
    apiContext.request = makeRequest(body, makeSignature(body))

    const response = await POST(apiContext)
    expect(response.status).toBe(200)
    expect(mockNotificationSend).toHaveBeenCalled()
  })

  it('does not send notification for unhandled event types', async () => {
    const body = JSON.stringify({ type: 'inventory.count.updated', data: {} })
    apiContext.request = makeRequest(body, makeSignature(body))

    const response = await POST(apiContext)
    expect(response.status).toBe(200)
    expect(mockNotificationSend).not.toHaveBeenCalled()
  })

  it('returns 400 for invalid JSON body', async () => {
    const body = 'not-json'
    apiContext.request = makeRequest(body, makeSignature(body))

    const response = await POST(apiContext)
    expect(response.status).toBe(400)

    const json = await response.json()
    expect(json.error).toBe('Invalid JSON')
  })

  it('still returns 200 even if notification fails', async () => {
    mockNotificationSend.mockRejectedValue(new Error('Slack down'))
    const body = JSON.stringify({ type: 'booking.created', data: { id: 'BK3' } })
    apiContext.request = makeRequest(body, makeSignature(body))

    const response = await POST(apiContext)
    expect(response.status).toBe(200)
  })
})

describe('verifySquareSignature', () => {
  it('returns true for valid signature', () => {
    const body = '{"type":"test"}'
    const url = 'https://example.com/webhook'
    const key = 'secret-key'
    const sig = createHmac('sha256', key).update(url + body).digest('base64')

    expect(verifySquareSignature(body, sig, key, url)).toBe(true)
  })

  it('returns false for tampered body', () => {
    const url = 'https://example.com/webhook'
    const key = 'secret-key'
    const sig = createHmac('sha256', key).update(url + '{"type":"original"}').digest('base64')

    expect(verifySquareSignature('{"type":"tampered"}', sig, key, url)).toBe(false)
  })

  it('returns false for empty signature', () => {
    expect(verifySquareSignature('body', '', 'key', 'url')).toBe(false)
  })

  it('returns false for empty key', () => {
    expect(verifySquareSignature('body', 'sig', '', 'url')).toBe(false)
  })
})
