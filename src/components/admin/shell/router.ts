/**
 * /admin's address bar. A tab is `#home`, `#calendar`, `#classes`, `#inbox`
 * or `#more`. An open sheet replaces it with the sheet's token (`#class-cls_1`,
 * `#day-2026-10-24`, `#more-hours`), and the tab under it rides along in
 * history.state, so a refresh puts back both. Tokens are plain: letters,
 * digits, `-`, `_` and `.` only.
 */
export const TABS = ['home', 'calendar', 'classes', 'inbox', 'more'] as const
export type Tab = (typeof TABS)[number]

export const isTab = (v: unknown): v is Tab => typeof v === 'string' && (TABS as readonly string[]).includes(v)

const TOKEN_RE = /^[A-Za-z0-9._-]{1,120}$/
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

export type InboxKind = 'request' | 'message' | 'teacher'
export type MorePage = 'parties' | 'hours' | 'closed' | 'staff' | 'promos' | 'reports' | 'sandbox' | 'who'
export const MORE_PAGES: MorePage[] = ['parties', 'hours', 'closed', 'staff', 'promos', 'reports', 'sandbox', 'who']

/** Every sheet /admin can open, as data. */
export type Sheet =
  /** A class: Bookings · Details · Dates. `edit-<id>` is the same sheet on Details. */
  | { kind: 'class'; id: string }
  | { kind: 'edit'; id: string }
  | { kind: 'new'; day?: string }
  /** Run a class again: New class filled in from it, a week on. */
  | { kind: 'again'; id: string }
  /** A library class: Schedule it, Edit details, Archive, Earlier versions. */
  | { kind: 'lib'; id: string }
  | { kind: 'libedit'; id: string }
  /** Schedule a library class: New class filled in from it. */
  | { kind: 'libsched'; id: string }
  | { kind: 'block'; day?: string }
  | { kind: 'print'; day: string }
  | { kind: 'day'; day: string }
  | { kind: 'legacy'; day: string; id: string }
  | { kind: 'blocked'; day: string; id: string }
  | { kind: 'party'; day: string; id: string }
  | { kind: 'cafe'; day: string }
  | { kind: 'closed'; day: string }
  | { kind: 'book-party'; day?: string }
  | { kind: InboxKind; id: string }
  | { kind: 'todo'; id: string }
  | { kind: 'more'; page: MorePage }

const plain = (s: string) => TOKEN_RE.test(s)

/** The token for a sheet, or null when one of its ids isn't plain enough for an address. */
export function sheetToken(s: Sheet): string | null {
  let t: string
  switch (s.kind) {
    case 'new': t = s.day ? `new-${s.day}` : 'new'; break
    case 'block': t = s.day ? `block-${s.day}` : 'block'; break
    case 'book-party': t = s.day ? `book-party-${s.day}` : 'book-party'; break
    case 'print': case 'day': case 'cafe': case 'closed': t = `${s.kind}-${s.day}`; break
    case 'legacy': case 'blocked': case 'party': t = `${s.kind}-${s.day}-${s.id}`; break
    case 'more': t = `more-${s.page}`; break
    default: t = `${s.kind}-${s.id}`
  }
  return plain(t) ? t : null
}

/** The sheet a token names, or null. */
export function parseSheet(token: string): Sheet | null {
  if (!plain(token)) return null
  const dayAfter = (prefix: string) => {
    const rest = token.slice(prefix.length)
    return DAY_RE.test(rest) ? rest : null
  }
  if (token === 'new') return { kind: 'new' }
  if (token === 'block') return { kind: 'block' }
  if (token === 'book-party') return { kind: 'book-party' }
  for (const k of ['new', 'block', 'book-party', 'print', 'day', 'cafe', 'closed'] as const) {
    if (!token.startsWith(`${k}-`)) continue
    const day = dayAfter(`${k}-`)
    if (day) return { kind: k, day } as Sheet
  }
  for (const k of ['legacy', 'blocked', 'party'] as const) {
    if (!token.startsWith(`${k}-`)) continue
    const rest = token.slice(k.length + 1)
    const day = rest.slice(0, 10), id = rest.slice(11)
    if (DAY_RE.test(day) && rest[10] === '-' && id) return { kind: k, day, id }
  }
  if (token.startsWith('more-')) {
    const page = token.slice(5) as MorePage
    return MORE_PAGES.includes(page) ? { kind: 'more', page } : null
  }
  for (const k of ['class', 'edit', 'again', 'libedit', 'libsched', 'lib', 'request', 'message', 'teacher', 'todo'] as const) {
    if (token.startsWith(`${k}-`) && token.length > k.length + 1) return { kind: k, id: token.slice(k.length + 1) } as Sheet
  }
  return null
}

/** What a hash says: a tab, a sheet, or nothing we know. */
export function parseHash(hash: string): { tab?: Tab; sheet?: Sheet } {
  const raw = hash.replace(/^#/, '')
  let token = raw
  try {
    token = decodeURIComponent(raw)
  } catch {
    // a malformed escape: read it as typed
  }
  if (isTab(token)) return { tab: token }
  const sheet = parseSheet(token)
  return sheet ? { sheet } : {}
}

/** The tab a sheet belongs under when the address only names the sheet (a link, a bookmark). */
export function homeTabOf(s: Sheet): Tab {
  switch (s.kind) {
    case 'request': case 'message': case 'teacher': case 'todo': return 'inbox'
    case 'more': return 'more'
    case 'class': case 'edit': case 'lib': case 'libedit': case 'libsched': case 'again': return 'classes'
    case 'day': case 'legacy': case 'blocked': case 'party': case 'cafe': case 'closed': return 'calendar'
    default: return 'home'
  }
}

/** Sheets that hold a long form: on an iPad they open as a centred card, not a side panel. (A class's own sheet stays a panel.) */
export function isFormSheet(s: Sheet): boolean {
  return s.kind === 'new' || s.kind === 'again' || s.kind === 'libedit' || s.kind === 'libsched'
}
