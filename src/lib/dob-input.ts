/**
 * Adult date-of-birth input helpers (HOM-212) — a masked `MM/DD/YYYY` text
 * field beats `<input type="date">` on mobile (no 30-year wheel-spin). The
 * form keeps the underlying `dob` state as the ISO string the server already
 * expects (`YYYY-MM-DD`); these two functions are the only bridge between the
 * masked text a person types and that ISO value. Kids keep the date picker —
 * a parent picking a birthdate 5-10 years back doesn't hit the same problem.
 */

/** Digits-only input → `MM/DD/YYYY` with slashes auto-inserted as they type.
 *  Caps at 8 digits (10 chars incl. slashes) — anything beyond is dropped. */
export function maskDob(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8)
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(Boolean).join('/')
}

/** `MM/DD/YYYY` → `YYYY-MM-DD`, or `null` if it isn't a real calendar date
 *  (catches both malformed input and roll-over dates like 02/30). */
export function dobToIso(masked: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(masked.trim())
  if (!m) return null
  const [, mm, dd, yyyy] = m
  const month = Number(mm)
  const day = Number(dd)
  const year = Number(yyyy)
  if (month < 1 || month > 12) return null
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null
  }
  return `${yyyy}-${mm}-${dd}`
}
