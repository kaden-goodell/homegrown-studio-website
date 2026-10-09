/**
 * Dedicated PostHog Logs emitter for this integration's staff-operation records.
 * Existing application loggers and browser console output are intentionally not
 * routed here, so only the explicit records added by this integration leave
 * the client.
 */
export const posthogOperationalLogger = {
  info(message: string, attributes: Record<string, string | number | boolean>): void {
    if (typeof window === 'undefined') return
    window.posthog?.logger?.info(message, attributes)
  },
}
