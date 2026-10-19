/**
 * Raw Square REST helper for our own classes. One API version for every new
 * raw call (the v44 SDK rejects some catalog shapes, so these go via fetch).
 * Server only: reads the access token from the site config.
 */
import { siteConfig, type SquareConfig } from '@config/site.config'

export const SQUARE_API_VERSION = '2026-01-22'

export function squareBaseUrl(environment: string | undefined): string {
  return environment === 'production' ? 'https://connect.squareup.com/v2' : 'https://connect.squareupsandbox.com/v2'
}

/** The Square settings in force (empty fields when Square isn't configured). */
export function squareSettings(): Partial<SquareConfig> {
  return (siteConfig.providers.catalog.config ?? {}) as Partial<SquareConfig>
}

/**
 * Call Square at `path` (e.g. '/catalog/batch-upsert'). JSON bodies are sent
 * as JSON; a FormData body is sent as multipart. On a non-2xx answer throws a
 * plain Error carrying Square's first error detail, with `status` attached.
 */
export async function squareFetch<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const cfg = squareSettings()
  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.accessToken ?? ''}`,
    'Square-Version': SQUARE_API_VERSION,
    Accept: 'application/json',
    ...((init.headers as Record<string, string>) ?? {}),
  }
  if (init.body !== undefined && !(init.body instanceof FormData)) headers['Content-Type'] = 'application/json'
  const res = await fetch(`${squareBaseUrl(cfg.environment)}${path}`, { ...init, headers })
  const text = await res.text()
  let body: any = null
  try { body = text ? JSON.parse(text) : null } catch { body = null }
  if (!res.ok) {
    const detail = body?.errors?.[0]?.detail || body?.errors?.[0]?.code
    const err = new Error(detail ? `Square said: ${detail}` : `Square answered with an error (${res.status}).`)
    throw Object.assign(err, { status: res.status })
  }
  return body as T
}
