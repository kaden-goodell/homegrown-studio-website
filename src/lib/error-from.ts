/**
 * Who caused a browser error PostHog caught — so "the site broke" (ours) is
 * told apart from noise the visitor's browser or app adds to every page
 * (Facebook's in-app tracker, Firefox iOS helpers, extensions).
 *
 *   ours              a stack frame points at a file served from our site
 *   facebook_app      Facebook / Instagram's in-app browser scripts (iabjs://)
 *   browser_extension an extension's script
 *   other_site        only other websites' scripts (Google, Meta pixel…)
 *   hidden            "Script error." — the browser hid the details because
 *                     the code came from another site; ours always has details
 *   unknown           no clue in the report (e.g. a phone dropping a request)
 *
 * MUST stay self-contained (no imports, no outside constants): posthog.astro
 * pastes this function's source into the page so it runs before PostHog loads.
 */
export type ErrorFrom = 'ours' | 'facebook_app' | 'browser_extension' | 'other_site' | 'hidden' | 'unknown'

export function errorFrom(exceptionList: unknown, origin: string): ErrorFrom {
  const list = Array.isArray(exceptionList) ? exceptionList : []
  const files: string[] = []
  const messages: string[] = []
  for (const ex of list) {
    if (!ex || typeof ex !== 'object') continue
    const value = (ex as { value?: unknown }).value
    if (typeof value === 'string') messages.push(value)
    const frames = (ex as { stacktrace?: { frames?: unknown } }).stacktrace?.frames
    if (!Array.isArray(frames)) continue
    for (const f of frames) {
      const name = f && typeof f === 'object' ? (f as { filename?: unknown }).filename : undefined
      if (typeof name === 'string' && name) files.push(name)
    }
  }
  const isOurs = (f: string) => f.startsWith(origin + '/') || (f.startsWith('/') && !f.startsWith('//'))
  if (files.some(isOurs)) return 'ours'
  if (files.some((f) => f.startsWith('iabjs://'))) return 'facebook_app'
  if (files.some((f) => /^(chrome|moz|safari|safari-web)-extension:\/\//.test(f))) return 'browser_extension'
  if (files.some((f) => /^https?:\/\//.test(f))) return 'other_site'
  if (messages.some((m) => /^Script error\.?$/i.test(m.trim()))) return 'hidden'
  return 'unknown'
}
