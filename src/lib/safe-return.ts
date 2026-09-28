/**
 * Validate a `return=` URL param (kiosk mode, `/waiver?kiosk=1&return=...`)
 * down to a same-origin path — never trust it as-is, or a shared iPad could
 * be redirected off-site after signing. Must start with a single `/` (not
 * `//`, which the browser treats as protocol-relative), carry no scheme, and
 * contain no backslash (`/\evil.com` is normalized to `//evil.com` by some
 * browsers). Anything that fails these checks falls back to `/staff`.
 */
export function safeReturnPath(v: string | null | undefined): string {
  const fallback = '/staff'
  if (typeof v !== 'string' || !v) return fallback
  if (!v.startsWith('/') || v.startsWith('//')) return fallback
  if (v.includes('\\')) return fallback
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(v)) return fallback // e.g. "/javascript:..." smuggling a scheme
  return v
}
