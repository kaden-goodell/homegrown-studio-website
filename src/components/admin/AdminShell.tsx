import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import '../../styles/booking-panel.css'
import '../../styles/admin.css'
import { OWNERS, type Owner } from '@lib/admin-who'
import { api, LOGIN, onAdminSignedOut, setAdminWho, TO_DECIDE } from './classes/api'
import CalendarView from './classes/CalendarView'
import ClassesTab from './ClassesTab'
import Home from './Home'
import Inbox, { type InboxSegment } from './inbox/Inbox'
import { InboxProvider, useInbox } from './inbox/InboxData'
import { InboxItemSheet, ToDecideSheet } from './inbox/InboxSheets'
import More from './More'
import { RefreshContext, ShellContext } from './shell/data'
import { Boundary, Crashed } from './shell/Boundary'
import { Seg } from './shell/items'
import { homeTabOf, isFormSheet, isTab, parseHash, sheetToken, TABS, type Sheet, type Tab } from './shell/router'
import { SheetFrame, SheetProvider, type SheetApi } from './shell/Sheet'
import { ToastHost } from './shell/Toast'
import { useWide } from './shell/useWide'
import { rememberedOwner, rememberOwner } from './shell/who'
import { BlockedSheet, CafeSheet, ClosedSheet, DaySheet, LegacySheet, PartySheet } from './sheets/CalendarSheets'
import { BlockSheet, ClassSheet, EditClassSheet, LibraryEditSheet, LibraryScheduleSheet, NewClassSheet, PrintSheet } from './sheets/ClassSheets'
import {
  BookPartySheet, ClosedDaysSheet, ComingSheet, HoursSheet, PartiesSetupSheet, ReportsSheet, SandboxSheet, WhoContext, WhoSheet,
} from './sheets/MoreSheets'

const LABEL: Record<Tab, string> = { home: 'Home', calendar: 'Calendar', classes: 'Classes', inbox: 'Inbox', more: 'More' }
const ICON: Record<Tab, ReactNode> = {
  home: <><path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  classes: <><circle cx="12" cy="12" r="8" /><path d="M5 9c4 1 9 5 11 10M8 5c3 3 6 9 6 14" /></>,
  inbox: <><path d="M3 13l3-8h12l3 8v6H3z" /><path d="M3 13h5l1 3h6l1-3h5" /></>,
  more: <><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></>,
}

type Auth = 'checking' | 'signed-out' | 'ready'

/**
 * /admin: owner-only tools, direction D (approved 19 Oct 2026). Sign in
 * (with who's using it), then five tabs: Home · Calendar · Classes · Inbox ·
 * More. Everything else opens in one sheet at a time, which a refresh or the
 * back button respects.
 */
export default function AdminShell() {
  const [auth, setAuth] = useState<Auth>('checking')
  const [who, setWhoState] = useState<Owner | null>(() => rememberedOwner())

  const setWho = useCallback((o: Owner) => {
    rememberOwner(o)
    setAdminWho(o)
    setWhoState(o)
  }, [])

  useEffect(() => {
    setAdminWho(who ?? '')
    onAdminSignedOut(() => setAuth('signed-out'))
    let live = true
    api(TO_DECIDE).then((r) => { if (live && r.status !== 401) setAuth('ready') })
    return () => { live = false; onAdminSignedOut(null) }
  }, [])

  const whoValue = useMemo(() => ({ who, setWho }), [who, setWho])
  if (auth === 'checking') return <div className="adm adm-signin" aria-busy="true"><p className="adm-muted">Loading…</p></div>
  if (auth === 'signed-out') return <SignIn who={who} onSignedIn={(o) => { setWho(o); setAuth('ready') }} />
  if (!who) return <PickWho onPick={setWho} />
  return (
    <WhoContext.Provider value={whoValue}>
      <ToastHost>
        <InboxProvider>
          <Shell who={who} onSignedOut={() => setAuth('signed-out')} />
        </InboxProvider>
      </ToastHost>
    </WhoContext.Provider>
  )
}

function WhoPicker({ value, onChange }: { value: Owner | null; onChange: (o: Owner) => void }) {
  return (
    <div>
      <p className="field-label" id="adm-who-label" style={{ marginBottom: '0.375rem' }}>Who’s using this?</p>
      <Seg label="Who’s using this?" value={value ?? ''} options={OWNERS.map((o) => [o, o] as [string, string])} onChange={(o) => onChange(o as Owner)} />
    </div>
  )
}

/** Passcode and who's using it. One tap: the button says "Signing in…" and can't be pressed twice. */
function SignIn({ who: remembered, onSignedIn }: { who: Owner | null; onSignedIn: (o: Owner) => void }) {
  const [passcode, setPasscode] = useState('')
  const [show, setShow] = useState(false)
  const [who, setWho] = useState<Owner | null>(remembered)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    if (!passcode.trim()) return setError('Type the passcode.')
    if (!who) return setError('Pick who’s using this.')
    setError('')
    setBusy(true)
    const r = await api(LOGIN, { passcode })
    setBusy(false)
    if (!r.ok) return setError(r.status === 401 && r.error === 'Sign in first.' ? 'That passcode isn’t right.' : r.error ?? 'That didn’t work.')
    setPasscode('')
    onSignedIn(who)
  }
  return (
    <div className="adm adm-signin">
      <form className="adm-card" onSubmit={submit} aria-label="Sign in">
        <p className="adm-brand">Hometown Studio</p>
        <h1>Admin</h1>
        <div>
          <label className="field-label" htmlFor="admin-passcode">Passcode</label>
          <div className="adm-pass" style={{ marginTop: '0.375rem' }}>
            <input
              id="admin-passcode"
              className="field-input"
              type={show ? 'text' : 'password'}
              autoComplete="current-password"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
            />
            <button type="button" className="adm-btn is-ghost is-sm" aria-pressed={show} onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</button>
          </div>
        </div>
        <WhoPicker value={who} onChange={setWho} />
        {error && <p role="alert" className="field-error">{error}</p>}
        <button type="submit" className="adm-btn is-pri" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  )
}

/** Signed in on this device before "Who's using this?" existed: ask once. */
function PickWho({ onPick }: { onPick: (o: Owner) => void }) {
  const [who, setWho] = useState<Owner | null>(null)
  return (
    <div className="adm adm-signin">
      <form className="adm-card" onSubmit={(e) => { e.preventDefault(); if (who) onPick(who) }} aria-label="Who’s using this?">
        <p className="adm-brand">Hometown Studio · Admin</p>
        <WhoPicker value={who} onChange={setWho} />
        <p className="adm-small adm-muted">Changes you make are saved under this name. You can change it under More.</p>
        <button type="submit" className="adm-btn is-pri" disabled={!who}>Continue</button>
      </form>
    </div>
  )
}

interface Open { sheet: Sheet; data?: unknown; n: number }

/** The tabs, the one sheet, and the address bar that remembers both. */
function Shell({ who, onSignedOut }: { who: Owner; onSignedOut: () => void }) {
  const wide = useWide()
  const inbox = useInbox()
  const [version, setVersion] = useState(0)
  const refresh = useMemo(() => ({ version, bump: () => setVersion((n) => n + 1) }), [version])

  const first = useMemo(() => {
    const h = parseHash(typeof window === 'undefined' ? '' : window.location.hash)
    const fromState = typeof history !== 'undefined' ? history.state?.admTab : undefined
    const tab: Tab = h.tab ?? (isTab(fromState) ? fromState : h.sheet ? homeTabOf(h.sheet) : 'home')
    return { tab, sheet: h.sheet ?? null }
  }, [])
  const [tab, setTab] = useState<Tab>(first.tab)
  const [open, setOpen] = useState<Open | null>(first.sheet ? { sheet: first.sheet, n: 0 } : null)
  const [leaving, setLeaving] = useState<null | (() => void)>(null)
  const [inboxSeg, setInboxSeg] = useState<InboxSegment>('request')

  const tabRef = useRef(tab)
  tabRef.current = tab
  const openRef = useRef(open)
  openRef.current = open
  const dirty = useRef(false)
  const pushed = useRef(false)
  const ignorePop = useRef(false)
  const opener = useRef<HTMLElement | null>(null)
  const seq = useRef(0)
  const layer = useRef<HTMLDivElement>(null)

  const state = (sheet?: string) => ({ admTab: tabRef.current, ...(sheet ? { admSheet: sheet } : {}) })

  // A refresh on a sheet: put the tab under it in history first, so Back closes the sheet and stays in /admin.
  useEffect(() => {
    const token = first.sheet && sheetToken(first.sheet)
    if (token && history.state?.admSheet === token) {
      // A reload of an entry we pushed: the tab entry is already behind it.
      pushed.current = true
    } else if (token) {
      history.replaceState(state(), '', `#${first.tab}`)
      history.pushState(state(token), '', `#${token}`)
      pushed.current = true
    } else {
      history.replaceState(state(), '', `#${first.tab}`)
    }
  }, [])

  /** Run `go` now, or after "Leave" when the sheet has unsaved changes. */
  const guard = useCallback((go: () => void) => {
    if (dirty.current) setLeaving(() => go)
    else go()
  }, [])

  const shut = useCallback((viaHistory = true) => {
    dirty.current = false
    setLeaving(null)
    setOpen(null)
    if (!viaHistory) return
    if (pushed.current) {
      pushed.current = false
      ignorePop.current = true
      history.back()
    } else {
      history.replaceState(state(), '', `#${tabRef.current}`)
    }
  }, [])

  const openSheet = useCallback((sheet: Sheet, data?: unknown) => {
    guard(() => {
      const token = sheetToken(sheet)
      if (!openRef.current) {
        opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
        if (token) {
          history.pushState(state(token), '', `#${token}`)
          pushed.current = true
        }
      } else if (token) {
        history.replaceState(state(token), '', `#${token}`)
      }
      dirty.current = false
      setLeaving(null)
      seq.current += 1
      setOpen({ sheet, data, n: seq.current })
    })
  }, [guard])

  const closeSheet = useCallback(() => guard(() => shut()), [guard, shut])

  const goTab = useCallback((t: Tab) => {
    guard(() => {
      if (openRef.current) {
        dirty.current = false
        setLeaving(null)
        setOpen(null)
        pushed.current = false
      }
      setTab(t)
      tabRef.current = t
      history.replaceState(state(), '', `#${t}`)
      window.scrollTo?.({ top: 0, behavior: 'instant' })
    })
  }, [guard])

  // Back and forward (and iOS swipe-back).
  useEffect(() => {
    function onPop() {
      if (ignorePop.current) { ignorePop.current = false; return }
      const h = parseHash(window.location.hash)
      const cur = openRef.current
      if (cur && !h.sheet) {
        if (dirty.current) {
          // Keep the sheet's place in history and ask first.
          const token = sheetToken(cur.sheet)
          if (token) { history.pushState(state(token), '', `#${token}`); pushed.current = true }
          setLeaving(() => () => shut())
          return
        }
        pushed.current = false
        dirty.current = false
        setLeaving(null)
        setOpen(null)
        if (h.tab) setTab(h.tab)
        return
      }
      if (h.sheet) {
        pushed.current = true
        seq.current += 1
        setOpen({ sheet: h.sheet, n: seq.current })
        return
      }
      if (h.tab) setTab(h.tab)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [shut])

  // Escape closes the sheet (or, while "Leave without saving?" shows, keeps editing).
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      e.preventDefault()
      if (leaving) setLeaving(null)
      else closeSheet()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, leaving, closeSheet])

  // Focus: into the sheet when one opens, back to what opened it when it closes.
  const openN = open?.n ?? null
  useEffect(() => {
    if (openN !== null) {
      layer.current?.querySelector<HTMLElement>('[data-sheet-close]')?.focus({ preventScroll: true })
    } else if (opener.current?.isConnected) {
      opener.current.focus({ preventScroll: true })
      opener.current = null
    }
  }, [openN])

  const form = !!open && isFormSheet(open.sheet)
  const panel = wide && !!open && !form
  const modal = !panel
  const locked = !!open && modal

  // A bottom sheet or centred card: the page behind doesn't scroll, and comes back where it was.
  useEffect(() => {
    if (!locked) return
    const y = window.scrollY
    const b = document.body.style
    const was = { position: b.position, top: b.top, width: b.width, overflow: b.overflow }
    Object.assign(b, { position: 'fixed', top: `-${y}px`, width: '100%', overflow: 'hidden' })
    return () => {
      Object.assign(b, was)
      // Instant: the site sets scroll-behavior: smooth on html, which would glide the page back down.
      window.scrollTo?.({ top: y, behavior: 'instant' })
    }
  }, [locked])
  const sheetApi: SheetApi = {
    open: openSheet,
    close: closeSheet,
    setDirty: (d) => { dirty.current = d },
    leaving: !!leaving,
    keepEditing: () => setLeaving(null),
    leave: () => { const go = leaving; dirty.current = false; setLeaving(null); go?.() },
    modal,
    data: open?.data,
  }

  async function signOut() {
    await api(LOGIN, {}, 'DELETE')
    onSignedOut()
  }

  const showInbox = (s: InboxSegment) => { setInboxSeg(s); goTab('inbox') }
  const covered = locked
  const shellInfo = useMemo(() => ({ paneled: panel, activeToken: open ? sheetToken(open.sheet) : null }), [panel, open])

  return (
    <RefreshContext.Provider value={refresh}>
      <ShellContext.Provider value={shellInfo}>
      <div className={`adm adm-shell${panel ? ' is-paneled' : ''}`}>
        <nav className="adm-tabbar" aria-label="Admin sections" inert={covered}>
          <p className="adm-tbrand">Hometown Studio</p>
          {TABS.map((t) => (
            <button key={t} type="button" className="adm-tab" aria-current={tab === t ? 'page' : undefined} onClick={() => goTab(t)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">{ICON[t]}</svg>
              <span>{LABEL[t]}</span>
              {t === 'inbox' && inbox.total > 0 && (
                <>
                  <span className="adm-dot" aria-hidden="true">{inbox.total}</span>
                  <span className="sr-only">{`, ${inbox.total} waiting`}</span>
                </>
              )}
            </button>
          ))}
        </nav>
        <main className="adm-main" inert={covered} aria-label={LABEL[tab]}>
          <Boundary key={tab} name={`${tab} tab`} onRetry={() => { refresh.bump(); inbox.retryAll() }}>
            {tab === 'home' && <Home who={who} onOpen={openSheet} onInbox={showInbox} />}
            {tab === 'calendar' && <CalendarView onOpen={openSheet} />}
            {tab === 'classes' && <ClassesTab onOpen={openSheet} />}
            {tab === 'inbox' && <Inbox segment={inboxSeg} onSegment={setInboxSeg} onOpen={openSheet} />}
            {tab === 'more' && <More onOpen={openSheet} onSignOut={signOut} />}
          </Boundary>
        </main>
        {open && (
          <div ref={layer} className={`adm-sheet-layer ${panel ? 'is-panel' : form && wide ? 'is-modal' : 'is-bottom'}`}>
            {!panel && <button type="button" className="adm-scrim" aria-label="Close" tabIndex={-1} onClick={closeSheet} />}
            <SheetProvider value={sheetApi}>
              <Boundary
                key={open.n}
                name="sheet"
                fallback={(retry) => <SheetFrame title="Something went wrong"><Crashed onRetry={retry} /></SheetFrame>}
              >
                <SheetContent sheet={open.sheet} />
              </Boundary>
            </SheetProvider>
          </div>
        )}
      </div>
      </ShellContext.Provider>
    </RefreshContext.Provider>
  )
}

function SheetContent({ sheet: s }: { sheet: Sheet }) {
  switch (s.kind) {
    case 'class': return <ClassSheet id={s.id} />
    case 'edit': return <EditClassSheet id={s.id} />
    case 'new': return <NewClassSheet day={s.day} />
    case 'libnew': return <LibraryEditSheet />
    case 'libedit': return <LibraryEditSheet id={s.id} />
    case 'libsched': return <LibraryScheduleSheet id={s.id} />
    case 'block': return <BlockSheet day={s.day} />
    case 'print': return <PrintSheet day={s.day} />
    case 'day': return <DaySheet day={s.day} />
    case 'legacy': return <LegacySheet day={s.day} id={s.id} />
    case 'blocked': return <BlockedSheet day={s.day} id={s.id} />
    case 'party': return <PartySheet day={s.day} id={s.id} />
    case 'cafe': return <CafeSheet day={s.day} />
    case 'closed': return <ClosedSheet day={s.day} />
    case 'book-party': return <BookPartySheet day={s.day} />
    case 'request': case 'message': case 'teacher': return <InboxItemSheet kind={s.kind} id={s.id} />
    case 'todo': return <ToDecideSheet id={s.id} />
    case 'more':
      switch (s.page) {
        case 'parties': return <PartiesSetupSheet />
        case 'hours': return <HoursSheet />
        case 'closed': return <ClosedDaysSheet />
        case 'staff': return <ComingSheet title="Staff" stage={3} what="who can work when, and who’s on each class and party." />
        case 'promos': return <ComingSheet title="Promotions" stage={4} what="discount codes for classes and parties, and how often each is used." />
        case 'reports': return <ReportsSheet />
        case 'sandbox': return <SandboxSheet />
        case 'who': return <WhoSheet />
      }
  }
}
