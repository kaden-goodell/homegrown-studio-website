/**
 * A phone number as people read it: "+14029802907" → "(402) 980-2907";
 * anything that isn't a US number is shown as typed. Client-safe.
 */
export function prettyPhone(phone: string): string {
  const d = phone.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '')
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : phone
}
