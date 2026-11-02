/**
 * /admin staffing (stage 3 Task 10): the shapes the owner staffing routes
 * answer with, and the small helpers the Staff section, More › Staff and Home
 * share. Client-safe.
 */
import { useEffect, useRef, useState } from 'react'
import type { StaffingRow, StaffPersonRow } from '@lib/staffing/events'
import type { Warning } from '@lib/warnings'
import { verdictLabel } from '@lib/staffing/crew-copy'
import { eventKeyOf } from '@lib/staffing/rules'
import { api, type Reply } from '../classes/api'
import { useRefresh } from '../shell/data'
import type { Sheet } from '../shell/router'
import { parseHash } from '../shell/router'

export type { StaffingRow, StaffPersonRow }
export const STAFFING = '/api/admin/staffing.json'
export const OWNER_FEED = '/api/admin/feed.json'
export const PEOPLE = '/api/admin/staff-people.json'
export const PASSCODE = '/api/admin/staff-passcode.json'

/** Owners only: how to reach each person (`left` = no longer working here). */
export type Contacts = Record<string, { phone: string | null; email: string | null; left?: boolean }>

export interface BoardData { rows: StaffingRow[]; team: { id: string; name: string; role: 'owner' | 'crew' }[]; contacts: Contacts }

/** A staffing line for Home (owners only), with the event it's about. */
export type StaffLine = Warning & { staff?: { key: string; openHref: string | null; people: { staffId: string; name: string }[] } }

/** Words for a person's mark, never colour alone (Can / Can't (dentist) / Part (4–9 PM) / Outside the hours they gave / Not said). */
export const markWords = (p: Pick<StaffPersonRow, 'verdict' | 'markNote' | 'hours'>) => verdictLabel(p)

/** "No one on yet" / "1 of 2 on" / "Jessica on" / "Nobody needed". */
export function stateWords(row: Pick<StaffingRow, 'state' | 'needed' | 'people'>): string {
  const on = row.people.filter((p) => p.assigned)
  if (row.needed === 0) return on.length ? `${names(on.map((p) => p.name))} on · nobody needed` : 'Nobody needed'
  if (on.length === 0) return 'No one on yet'
  if (row.state === 'short') return `${on.length} of ${row.needed} on · ${names(on.map((p) => p.name))}`
  return `${names(on.map((p) => p.name))} on`
}

/** Short tag for a calendar row: null when it's covered. */
export function staffTag(row: Pick<StaffingRow, 'state' | 'needed' | 'people' | 'event'>): string | null {
  if (row.event.status !== 'on' || row.needed === 0 || row.state === 'staffed') return null
  const on = (row.people ?? []).filter((p) => p.assigned).length
  return on === 0 ? 'No one on' : `${on} of ${row.needed} on`
}

export const needsSomeone = (r: StaffingRow, now = Date.now()) =>
  r.event.status === 'on' && Date.parse(r.event.endIso) > now && r.needed > 0 && r.state !== 'staffed'

/** "Jessica", "Jessica and Sam", "Jessica, Sam and Kaden". */
export const names = (list: string[]) => (list.length <= 1 ? list[0] ?? '' : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`)

/** The sheet an event's /admin address opens (null when it can't be read). */
export function sheetOfHref(href: string | null | undefined): Sheet | null {
  if (!href) return null
  return parseHash(href).sheet ?? null
}

/** What the sheet opener hands a class or party sheet so it opens on Staff (and on that day of a class). */
export interface StaffOpen { staffKey: string }
export const staffOpenOf = (data: unknown): StaffOpen | null =>
  data && typeof data === 'object' && typeof (data as StaffOpen).staffKey === 'string' ? (data as StaffOpen) : null

/** The staffing board for [from, to): rows, team and contacts, with Try again. Reloads when /admin changes something. */
export function useBoard(fromIso: string, toIso: string) {
  const { version } = useRefresh()
  const [data, setData] = useState<BoardData | null>(null)
  const [error, setError] = useState('')
  const [tries, setTries] = useState(0)
  const range = useRef('')
  useEffect(() => {
    let live = true
    setError('')
    // A new week clears the list; a change on this screen reloads it in place (no flash while assigning).
    if (range.current !== `${fromIso}|${toIso}`) { range.current = `${fromIso}|${toIso}`; setData(null) }
    const q = new URLSearchParams({ from: fromIso, to: toIso })
    api<BoardData>(`${STAFFING}?${q}`).then((r) => {
      if (!live) return
      if (r.ok && r.data) setData({ rows: r.data.rows, team: r.data.team ?? [], contacts: r.data.contacts ?? {} })
      else setError(r.error ?? 'Couldn’t check staffing.')
    })
    return () => { live = false }
  }, [fromIso, toIso, version, tries])
  return { data, error, retry: () => setTries((n) => n + 1), setData }
}

/** Assign or take off (one day, or every day of a class with `keys`). */
export function postAssign(body: { action: 'assign' | 'unassign'; staffId: string; tell: boolean } & ({ key: string; startIso?: string } | { keys: string[]; hints?: Record<string, string> })): Promise<Reply<{ row?: StaffingRow | null; rows?: (StaffingRow | null)[] }>> {
  return api(STAFFING, body)
}

export function postNeeded(key: string, needed: number | null, expectedUpdatedAt: string | null, startIso?: string): Promise<Reply<{ row: StaffingRow }>> {
  return api(STAFFING, { action: 'needed', key, needed, expectedUpdatedAt, ...(startIso ? { startIso } : {}) })
}

export const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`
export const smsHref = (phone: string) => `sms:${phone.replace(/[^\d+]/g, '')}`

/** "+12565550199" → "(256) 555-0199"; anything else as saved. */
export function phoneWords(phone: string | null | undefined): string {
  if (!phone) return ''
  const d = phone.replace(/\D/g, '')
  const ten = d.length === 11 && d.startsWith('1') ? d.slice(1) : d
  return ten.length === 10 ? `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}` : phone
}

/** "No one on" / "1 of 2 on" by calendar item, from board rows (undefined when covered or not listed). */
export function tagLookup(rows: StaffingRow[] | null | undefined): (item: { kind: string; id: string; sessionId?: string }) => string | undefined {
  const tags = new Map<string, string>()
  for (const r of rows ?? []) {
    const t = staffTag(r)
    if (t) tags.set(r.event.key, t)
  }
  return (item) => {
    const key = eventKeyOf(item)
    return key ? tags.get(key) : undefined
  }
}

/**
 * "No one on" / "1 of 2 on" for calendar rows in [fromIso, toIso): a lookup
 * by calendar item. Nothing shows while loading or when staffing can't be
 * read (Home's Needs you says so instead).
 */
export function useStaffTags(fromIso: string, toIso: string): (item: { kind: string; id: string; sessionId?: string }) => string | undefined {
  const { data } = useBoard(fromIso, toIso)
  return tagLookup(data?.rows)
}

/** Home: the owners' staffing lines for the next two weeks, with contacts for Call / Text. */
export function useStaffLines() {
  const { version } = useRefresh()
  const [lines, setLines] = useState<StaffLine[] | null>(null)
  const [contacts, setContacts] = useState<Contacts>({})
  const [error, setError] = useState('')
  const [tries, setTries] = useState(0)
  useEffect(() => {
    let live = true
    setError('')
    api<{ lines: StaffLine[]; contacts: Contacts }>(`${STAFFING}?lines=1`).then((r) => {
      if (!live) return
      if (r.ok && r.data) { setLines(r.data.lines ?? []); setContacts(r.data.contacts ?? {}) }
      else setError(r.error ?? 'Couldn’t check staffing.')
    })
    return () => { live = false }
  }, [version, tries])
  return { lines, contacts, error, retry: () => setTries((n) => n + 1) }
}
