import { useState } from 'react'
import DoorSearch, { type AddedResult, type HouseholdMatch, type TodayEvent } from '@components/staff/DoorSearch'
import NewFamilyButton from '@components/staff/NewFamilyButton'
import { btn } from '@components/staff/ui'
import { formatTime } from '@lib/studio-time'

type Choice = { type: 'cafe' } | { type: 'event'; event: TodayEvent }
const ICON: Record<string, string> = { party: '🎉', workshop: '🧵', program: '🌙' }

/**
 * Check in, step 1: "What are they here for?" — today's parties and classes,
 * plus Craft Café on the days it runs. Step 2 finds the family (or hands the
 * iPad to a new one) and puts them on THAT event's roster, marked here.
 * Choosing first is the point: a party guest is never logged as a café
 * walk-in by accident.
 */
export default function CheckInFlow({
  todayEvents,
  cafeOpen,
  onOpenRoster,
  onCheckedIn,
}: {
  todayEvents: TodayEvent[] | null
  /** Craft Café runs today. */
  cafeOpen: boolean
  onOpenRoster?: (e: { kind: TodayEvent['kind']; id: string; title: string; addFamily?: { household?: HouseholdMatch } }) => void
  onCheckedIn?: () => void
}) {
  const [choice, setChoice] = useState<Choice | null>(null)
  const [added, setAdded] = useState<(AddedResult & { title: string }) | null>(null)
  const [round, setRound] = useState(0) // remounts the search for "someone else"

  const reset = () => { setChoice(null); setAdded(null); setRound((n) => n + 1) }
  const heading = { margin: '0 0 0.6rem', fontWeight: 700, color: 'var(--color-dark)', fontSize: '1rem' } as const
  const option = { ...btn(), width: '100%', minHeight: '3rem', textAlign: 'left', fontSize: '0.95rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' } as const

  if (added && choice?.type === 'event') {
    const e = choice.event
    return (
      <div style={{ textAlign: 'center', padding: '0.5rem 0' }}>
        <p role="status" style={{ margin: 0, fontWeight: 700, color: 'rgb(21,128,61)' }}>✓ On the {e.title} roster and marked here</p>
        {added.oneTimeCode && (
          <>
            <p style={{ margin: '0.9rem 0 0.2rem', fontSize: '0.8125rem', color: 'var(--color-muted)' }}>Pickup code</p>
            <p style={{ margin: 0, fontSize: '2.25rem', fontWeight: 800, letterSpacing: '0.2em', color: 'var(--color-dark)' }}>{added.oneTimeCode}</p>
            <p style={{ margin: '0.4rem 0 0', fontSize: '0.8125rem', color: added.smsFailed ? '#b91c1c' : 'var(--color-muted)', fontWeight: added.smsFailed ? 700 : 400 }}>
              {added.smsFailed ? 'The text did not send — read the code to the parent.' : 'Texted to the parent.'}
            </p>
          </>
        )}
        {e.kind === 'workshop' && (
          <p style={{ margin: '0.8rem 0 0', fontSize: '0.8125rem', color: 'var(--color-dark)' }}>
            Didn’t book online? Open the roster and use <strong>Sell a seat</strong> or <strong>Comp a seat</strong>.
          </p>
        )}
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', marginTop: '1rem', flexWrap: 'wrap' }}>
          {onOpenRoster && <button type="button" onClick={() => onOpenRoster({ kind: e.kind, id: e.id, title: e.title })} style={btn()}>Open roster</button>}
          <button type="button" onClick={reset} style={btn(true)}>Check in someone else</button>
        </div>
      </div>
    )
  }

  if (!choice) {
    const events = todayEvents ?? []
    return (
      <div>
        <p style={heading}>What are they here for?</p>
        {todayEvents === null && <p style={{ color: 'var(--color-muted)', fontSize: '0.875rem' }}>Loading today…</p>}
        {events.map((e) => (
          <button key={`${e.kind}:${e.id}`} type="button" onClick={() => setChoice({ type: 'event', event: e })} style={option}>
            <span>{ICON[e.kind] ?? '•'}</span>
            <span style={{ flex: 1 }}>{e.title}</span>
            <span style={{ color: 'var(--color-muted)', fontSize: '0.8125rem' }}>{formatTime(e.startIso)}</span>
          </button>
        ))}
        {cafeOpen && (
          <button type="button" onClick={() => setChoice({ type: 'cafe' })} style={option}>
            <span>☕</span><span style={{ flex: 1 }}>Craft Café (walk-in)</span>
          </button>
        )}
        {todayEvents !== null && events.length === 0 && !cafeOpen && (
          <p style={{ color: 'var(--color-muted)', fontSize: '0.875rem', margin: '0 0 0.5rem' }}>
            Nothing on today.{' '}
            <button type="button" onClick={() => setChoice({ type: 'cafe' })} style={{ ...btn(), padding: '0.2rem 0.5rem', fontSize: '0.8125rem' }}>Log a walk-in visit anyway</button>
          </p>
        )}
      </div>
    )
  }

  const back = (
    <button type="button" onClick={reset} style={{ ...btn(), marginBottom: '0.8rem' }}>
      ← {choice.type === 'event' ? choice.event.title : 'Craft Café'}
    </button>
  )

  if (choice.type === 'cafe') {
    return (
      <div key={round}>
        {back}
        <NewFamilyButton />
        <DoorSearch onCheckedIn={onCheckedIn} />
      </div>
    )
  }

  return (
    <div key={round}>
      {back}
      <NewFamilyButton event={choice.event} />
      <DoorSearch mode="event" event={choice.event} onAdded={(r) => { setAdded({ ...r, title: choice.event.title }); onCheckedIn?.() }} />
    </div>
  )
}
