/**
 * Masked customer contacts: for logs (M5) and for what crew see (DV19).
 * `jane.doe@gmail.com` → `j•••@gmail.com`; `(256) 555-1234` → `••1234`.
 * Client-safe: no imports.
 */
export function maskEmail(email: string | null | undefined): string {
  const e = String(email ?? '').trim()
  if (!e) return ''
  const at = e.lastIndexOf('@')
  if (at <= 0) return '•••'
  return `${e[0]}•••${e.slice(at)}`
}

export function maskPhone(phone: string | null | undefined): string {
  const digits = String(phone ?? '').replace(/\D/g, '')
  if (!digits) return ''
  return `••${digits.slice(-4)}`
}

/** An email or a phone, whichever it looks like (a family key, a search term). */
export function maskContact(value: string | null | undefined): string {
  const v = String(value ?? '').trim()
  if (!v) return ''
  if (v.includes('@')) return maskEmail(v)
  if (/^[+\d\s().-]{7,}$/.test(v)) return maskPhone(v)
  return v.length > 2 ? `${v.slice(0, 1)}•••` : '•••'
}
