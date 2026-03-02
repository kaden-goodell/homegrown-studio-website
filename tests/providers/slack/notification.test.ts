import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SlackNotificationProvider } from '@providers/slack/notification'
import type { NotificationPayload } from '@providers/interfaces/notification'

describe('SlackNotificationProvider', () => {
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const basePayload: NotificationPayload = {
    type: 'api-failure',
    title: 'API Error Detected',
    details: { endpoint: '/api/bookings', statusCode: 500 },
    severity: 'critical',
    timestamp: '2026-03-01T12:00:00Z',
  }

  it('calls fetch with correct webhook URL and POST method', async () => {
    const provider = new SlackNotificationProvider({ webhookUrl: 'https://hooks.slack.com/test' })
    await provider.send(basePayload)

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, options] = mockFetch.mock.calls[0]
    expect(url).toBe('https://hooks.slack.com/test')
    expect(options.method).toBe('POST')
    expect(options.headers['Content-Type']).toBe('application/json')
  })

  it('includes title and critical severity color (#cc0000) in attachment', async () => {
    const provider = new SlackNotificationProvider({ webhookUrl: 'https://hooks.slack.com/test' })
    await provider.send(basePayload)

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.attachments).toBeDefined()
    expect(body.attachments[0].color).toBe('#cc0000')
    expect(body.text).toContain('API Error Detected')
  })

  it('uses green (#36a64f) for info severity', async () => {
    const provider = new SlackNotificationProvider({ webhookUrl: 'https://hooks.slack.com/test' })
    await provider.send({ ...basePayload, severity: 'info' })

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.attachments[0].color).toBe('#36a64f')
  })

  it('uses orange (#ff9900) for warning severity', async () => {
    const provider = new SlackNotificationProvider({ webhookUrl: 'https://hooks.slack.com/test' })
    await provider.send({ ...basePayload, severity: 'warning' })

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.attachments[0].color).toBe('#ff9900')
  })

  it('includes details as fields in attachment', async () => {
    const provider = new SlackNotificationProvider({ webhookUrl: 'https://hooks.slack.com/test' })
    await provider.send(basePayload)

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    const fields = body.attachments[0].fields
    expect(fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: 'endpoint', value: '/api/bookings' }),
        expect.objectContaining({ title: 'statusCode', value: '500' }),
      ])
    )
  })

  it('includes channel when configured', async () => {
    const provider = new SlackNotificationProvider({
      webhookUrl: 'https://hooks.slack.com/test',
      channel: '#alerts',
    })
    await provider.send(basePayload)

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.channel).toBe('#alerts')
  })

  it('does not include channel when not configured', async () => {
    const provider = new SlackNotificationProvider({ webhookUrl: 'https://hooks.slack.com/test' })
    await provider.send(basePayload)

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.channel).toBeUndefined()
  })

  it('does not throw when fetch fails', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'))
    const provider = new SlackNotificationProvider({ webhookUrl: 'https://hooks.slack.com/test' })

    await expect(provider.send(basePayload)).resolves.toBeUndefined()
  })

  it('does not call fetch when webhookUrl is empty', async () => {
    const provider = new SlackNotificationProvider({ webhookUrl: '' })
    await provider.send(basePayload)

    expect(mockFetch).not.toHaveBeenCalled()
  })
})
