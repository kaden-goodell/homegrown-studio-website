/**
 * Who may have staffing data stored under them: a well-formed Square team
 * member id that is not one of listStaff()'s fallback ids ('kaden',
 * 'catherine'). A Square blip must never split one person's data in two.
 * Client-safe.
 */
const STAFF_ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const FALLBACK = new Set(['kaden', 'catherine'])

export function storableStaffId(id: unknown): id is string {
  return typeof id === 'string' && STAFF_ID_RE.test(id) && !FALLBACK.has(id)
}
