import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { ArtistApplication } from '@lib/artist-applications'
import type { ContactMessage } from '@lib/contact-options'
import type { EventRequest } from '@lib/event-request-options'
import type { ToDecideItem } from '@pages/api/admin/to-decide.json'
import { api, APPLICATIONS, MESSAGES, REQUESTS, TO_DECIDE } from '../classes/api'
import { DIDNT_SAVE, useToast } from '../shell/Toast'
import type { InboxKind } from '../shell/router'

export interface Source<T> {
  items: T[] | null
  error: string
  retry: () => void
}
export type InboxItem = EventRequest | ContactMessage | ArtistApplication

interface InboxApi {
  request: Source<EventRequest>
  message: Source<ContactMessage>
  teacher: Source<ArtistApplication>
  todo: Source<ToDecideItem>
  /** Waiting on the owners: New requests, messages and teacher applications, and To decide items. */
  counts: Record<InboxKind | 'todo', number>
  total: number
  /** Optimistic: the status changes at once; Undo puts it back; a failed save puts it back and says so. */
  setStatus: (kind: InboxKind, id: string, status: string, label: string) => void
}

const ENDPOINT: Record<InboxKind, string> = { request: REQUESTS, message: MESSAGES, teacher: APPLICATIONS }
const ONE_KEY: Record<InboxKind, string> = { request: 'request', message: 'message', teacher: 'application' }

const InboxContext = createContext<InboxApi | null>(null)
export function useInbox(): InboxApi {
  const v = useContext(InboxContext)
  if (!v) throw new Error('useInbox outside InboxProvider')
  return v
}

/** One list that loads on its own, with its own error and Try again. */
function useSource<T>(url: string, key: string) {
  const [items, setItems] = useState<T[] | null>(null)
  const [error, setError] = useState('')
  const [tries, setTries] = useState(0)
  useEffect(() => {
    let live = true
    setError('')
    api<Record<string, T[]>>(url).then((r) => {
      if (!live) return
      if (r.ok && r.data && Array.isArray(r.data[key])) setItems(r.data[key])
      else setError(r.error ?? 'That didn’t load.')
    })
    return () => { live = false }
  }, [url, key, tries])
  return { items, setItems, error, retry: () => setTries((n) => n + 1) }
}

/**
 * The three inboxes (private event requests, contact messages, teacher
 * applications) and To decide, loaded once for Home's counters, the tab
 * badge and the Inbox tab. Each loads on its own: one failing never takes
 * down the others.
 */
export function InboxProvider({ children }: { children: ReactNode }) {
  const toast = useToast()
  const request = useSource<EventRequest>(REQUESTS, 'requests')
  const message = useSource<ContactMessage>(MESSAGES, 'messages')
  const teacher = useSource<ArtistApplication>(APPLICATIONS, 'applications')
  const todo = useSource<ToDecideItem>(TO_DECIDE, 'items')
  const sources = { request, message, teacher }
  const ref = useRef(sources)
  ref.current = sources

  const put = (kind: InboxKind, id: string, status: string) =>
    ref.current[kind].setItems((list: any[] | null) => (list ?? []).map((x) => (x.id === id ? { ...x, status } : x)) as any)

  const send = useCallback(async (kind: InboxKind, id: string, status: string) => {
    const r = await api<Record<string, InboxItem>>(ENDPOINT[kind], { id, status })
    const saved = r.ok ? r.data?.[ONE_KEY[kind]] : undefined
    if (saved) ref.current[kind].setItems((list: any[] | null) => (list ?? []).map((x) => (x.id === id ? saved : x)) as any)
    return r.ok
  }, [])

  const setStatus = useCallback((kind: InboxKind, id: string, status: string, label: string) => {
    const was = (ref.current[kind].items as InboxItem[] | null)?.find((x) => x.id === id)?.status
    if (!was || was === status) return
    put(kind, id, status)
    send(kind, id, status).then((ok) => {
      if (!ok) {
        put(kind, id, was)
        toast(DIDNT_SAVE)
        return
      }
      toast(`Marked ${label}.`, {
        undo: () => {
          put(kind, id, was)
          send(kind, id, was).then((back) => {
            if (!back) { put(kind, id, status); toast(DIDNT_SAVE) }
          })
        },
      })
    })
  }, [toast, send])

  const fresh = (list: { status: string }[] | null) => (list ?? []).filter((x) => x.status === 'new').length
  const counts = {
    request: fresh(request.items),
    message: fresh(message.items),
    teacher: fresh(teacher.items),
    todo: (todo.items ?? []).filter((t) => !t.done).length,
  }
  const value: InboxApi = {
    request, message, teacher, todo, counts,
    total: counts.request + counts.message + counts.teacher + counts.todo,
    setStatus,
  }
  return <InboxContext.Provider value={value}>{children}</InboxContext.Provider>
}

