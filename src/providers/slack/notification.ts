import type { NotificationPayload, NotificationProvider } from '../interfaces/notification'
import type { SlackConfig } from '../../config/site.config'
import { createLogger } from '../../lib/logger'

const logger = createLogger('slack-notification')

const SEVERITY_COLORS: Record<NotificationPayload['severity'], string> = {
  info: '#36a64f',
  warning: '#ff9900',
  critical: '#cc0000',
}

export class SlackNotificationProvider implements NotificationProvider {
  private webhookUrl: string
  private channel?: string

  constructor(config: SlackConfig) {
    this.webhookUrl = config.webhookUrl
    this.channel = config.channel
  }

  async send(payload: NotificationPayload): Promise<void> {
    if (!this.webhookUrl) {
      logger.warn('Slack webhook URL not configured, skipping notification')
      return
    }

    const body: Record<string, any> = {
      text: payload.title,
      attachments: [
        {
          color: SEVERITY_COLORS[payload.severity],
          fields: Object.entries(payload.details).map(([key, value]) => ({
            title: key,
            value: String(value),
            short: true,
          })),
        },
      ],
    }

    if (this.channel) {
      body.channel = this.channel
    }

    try {
      await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch (error) {
      logger.error('Failed to send Slack notification', {
        error: error instanceof Error ? error.message : String(error),
        title: payload.title,
      })
    }
  }
}
