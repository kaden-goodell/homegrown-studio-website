import { useEffect, useRef, useState, type CSSProperties } from 'react'
import IncidentSheet from '@components/staff/IncidentSheet'
import CheckInSheet from '@components/staff/CheckInSheet'
import { visibleTabs, useStaffNav } from '@components/staff/nav'
import type { HouseholdMatch } from '@components/staff/DoorSearch'
import type { EventKind } from '@lib/events'
import type { Household } from '@components/staff/HouseholdCard'
import type { StudioEvent } from '@lib/events'

export interface StaffHeaderMember {
  name: string
}

const btn = (primary = false): CSSProperties => ({
  padding: '0.55rem 0.9rem',
  borderRadius: '0.625rem',
  border: primary ? 'none' : '1px solid rgba(var(--color-primary-rgb),0.3)',
  background: primary ? 'var(--color-primary)' : 'transparent',
  color: primary ? '#fff' : 'var(--color-dark)',
  fontSize: '0.875rem',
  fontWeight: 600,
  cursor: 'pointer',
})

/** Shared top bar for every signed-in staff screen: the tabs (one row that
 *  scrolls sideways when it must, on its own line whenever the header is narrow, the
 *  current tab scrolled into view; Kits only while kits are on), then a red
 *  🚑 Incident and the signed-in name, which opens Switch / Log out. The 🚑 Incident sheet is self-contained here so every
 *  screen gets it for free — `event`/`households`/`day` let a roster screen
 *  hand it real context; other screens leave them unset ("Craft Café").
 *  Navigation comes from StaffNavContext (StaffConsole provides it). */
export default function StaffHeader({
  staff,
  event,
  households,
  day,
  onCheckIn,
  onOpenRoster,
}: {
  /** Kept for callers; the tabs say where you are now. */
  title?: string
  staff: StaffHeaderMember
  event?: StudioEvent | null
  households?: Household[]
  day?: string
  /** A roster opens its own "+ Add family" (pointed at that event); every other screen gets the general Check in sheet. */
  onCheckIn?: () => void
  onOpenRoster?: (e: { kind: EventKind; id: string; title: string; addFamily?: { household?: HouseholdMatch } }) => void
}) {
  const nav = useStaffNav()
  const [incidentOpen, setIncidentOpen] = useState(false)
  const [checkInOpen, setCheckInOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  const tab = (active: boolean): CSSProperties => ({
    padding: '0.65rem 1rem',
    minHeight: '2.75rem',
    borderRadius: '999px',
    border: 'none',
    background: active ? 'var(--color-primary)' : 'transparent',
    color: active ? '#fff' : 'var(--color-dark)',
    fontSize: '0.95rem',
    fontWeight: 700,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    flex: '0 0 auto',
    scrollSnapAlign: 'start',
  })

  const tabs = visibleTabs(nav?.active)
  const stripRef = useRef<HTMLDivElement | null>(null)
  const activeRef = useRef<HTMLButtonElement | null>(null)
  // A soft fade on the right edge while more tabs are hidden that way.
  const [moreRight, setMoreRight] = useState(false)
  const checkEdge = () => {
    const el = stripRef.current
    if (el) setMoreRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4)
  }
  useEffect(() => {
    // The tab you're on is always in view, even at the far end of the row.
    activeRef.current?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' })
    checkEdge()
  }, [nav?.active])

  return (
    <>
      {/* The tabs get their own full-width row unless the header itself is wide
          (a container query, not the screen width: the page is a narrow column
          even on an iPad held sideways, crew review I4). Browsers without
          container queries keep the own-row layout. */}
      <style>{`.staff-header { container-type: inline-size; } @container (min-width: 60rem) { .staff-tabs-row { flex-basis: 0 !important; } }`}</style>
      <div className="staff-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.6rem', marginBottom: '1.1rem', flexWrap: 'wrap' }}>
        <div className="staff-tabs-row" style={{ flex: '1 1 100%', minWidth: 0, position: 'relative' }}>
          <div
            ref={stripRef}
            onScroll={checkEdge}
            data-testid="staff-tabs-strip"
            style={{
              display: 'flex', flexWrap: 'nowrap', overflowX: 'auto', scrollSnapType: 'x proximity', WebkitOverflowScrolling: 'touch',
              scrollbarWidth: 'none', borderRadius: '999px',
              ...(moreRight ? { maskImage: 'linear-gradient(to right, #000 85%, transparent)', WebkitMaskImage: 'linear-gradient(to right, #000 85%, transparent)' } : {}),
            }}
          >
            <nav aria-label="Staff sections" style={{ display: 'flex', flexWrap: 'nowrap', gap: '0.25rem', padding: '0.25rem', borderRadius: '999px', background: 'rgba(var(--color-primary-rgb),0.08)', flex: '0 0 auto' }}>
              {tabs.map((t) => {
                const active = nav?.active === t.id
                return (
                  <button
                    key={t.id}
                    ref={active ? activeRef : undefined}
                    type="button"
                    aria-current={active ? 'page' : undefined}
                    onClick={() => nav?.go(t.id)}
                    style={tab(active)}
                  >
                    {t.label}
                  </button>
                )
              })}
            </nav>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', position: 'relative', marginLeft: 'auto' }}>
          <button
            type="button"
            onClick={() => setIncidentOpen(true)}
            style={{ ...btn(), minHeight: '2.75rem', border: '1px solid rgba(185,28,28,0.45)', color: '#b91c1c', fontSize: '0.9rem' }}
          >
            🚑 Incident
          </button>
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
            style={{ ...btn(), minHeight: '2.75rem', fontSize: '0.9rem' }}
          >
            {staff.name} ▾
          </button>
          {menuOpen && (
            <>
              <div onClick={() => setMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 110 }} />
              <div role="menu" style={{ position: 'absolute', right: 0, top: 'calc(100% + 0.35rem)', zIndex: 111, minWidth: '11rem', padding: '0.35rem', borderRadius: '0.75rem', background: '#fff', boxShadow: '0 10px 30px rgba(0,0,0,0.18)', display: 'grid', gap: '0.25rem' }}>
                <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); nav?.switchStaff() }} style={{ ...btn(), border: 'none', textAlign: 'left', minHeight: '2.75rem', fontSize: '0.95rem' }}>Switch person</button>
                <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); nav?.logout() }} style={{ ...btn(), border: 'none', textAlign: 'left', minHeight: '2.75rem', fontSize: '0.95rem' }}>Log out</button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Always there, bottom-right, on every signed-in screen. */}
      <button
        type="button"
        onClick={() => (onCheckIn ? onCheckIn() : setCheckInOpen(true))}
        aria-label="Check in a family"
        style={{
          position: 'fixed', right: '1rem', bottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))', zIndex: 120,
          padding: '0.9rem 1.3rem', minHeight: '3.25rem', borderRadius: '999px', border: 'none',
          background: 'var(--color-primary)', color: '#fff', fontSize: '1rem', fontWeight: 700,
          boxShadow: '0 8px 24px rgba(0,0,0,0.25)', cursor: 'pointer',
        }}
      >
        ✓ Check in
      </button>
      {checkInOpen && <CheckInSheet onOpenRoster={onOpenRoster} onClose={() => setCheckInOpen(false)} />}

      {incidentOpen && (
        <IncidentSheet
          staff={staff}
          event={event ?? null}
          day={day}
          households={households ?? []}
          onClose={() => setIncidentOpen(false)}
        />
      )}
    </>
  )
}
