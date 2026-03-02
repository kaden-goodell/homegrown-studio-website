export type NotificationType =
  | 'corporate-inquiry'
  | 'api-failure'
  | 'payment-failure'
  | 'consecutive-failures'
  | 'webhook'

export interface NotificationPayload {
  type: NotificationType
  title: string
  details: Record<string, any>
  severity: 'info' | 'warning' | 'critical'
  timestamp: string
}

export interface NotificationProvider {
  send(payload: NotificationPayload): Promise<void>
}
