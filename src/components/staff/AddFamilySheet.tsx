import { useState } from 'react'
import DoorSearch, { type AddedResult, type DoorEvent, type HouseholdMatch } from '@components/staff/DoorSearch'
import { btn } from '@components/staff/ui'
import NewFamilyButton from '@components/staff/NewFamilyButton'

/**
 * Roster "+ Add family": the Today door search, pointed at one event. Sheet
 * chrome copied from HistorySheet. On success it closes straight away — unless
 * a drop-off pickup code was just issued, which the crew must see, so that
 * stays up (with a Done button) until read out.
 */
export default function AddFamilySheet({
  event,
  initialHousehold,
  onAdded,
  onClose,
}: {
  event: DoorEvent
  initialHousehold?: HouseholdMatch
  /** Called once the family is on the roster — the roster refreshes. */
  onAdded: () => void
  onClose: () => void
}) {
  const [issued, setIssued] = useState<AddedResult | null>(null)

  function handleAdded(r: AddedResult) {
    onAdded()
    if (r.oneTimeCode || r.smsFailed) setIssued(r)
    else onClose()
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Add a family to ${event.title}`}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, zIndex: 130, display: 'flex', justifyContent: 'flex-end', background: 'rgba(0, 0, 0, 0.4)' }}
    >
      <div
        style={{
          width: '100%', maxWidth: '30rem', height: '100vh', overflowY: 'auto',
          padding: '1.25rem 1.25rem 2rem', boxSizing: 'border-box',
          background: 'linear-gradient(180deg, rgba(255,255,255,0.99) 0%, rgba(255,255,255,0.96) 100%)',
          boxShadow: '-12px 0 40px rgba(0,0,0,0.25)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.9rem' }}>
          <h3 style={{ margin: 0, fontFamily: 'var(--font-heading)', fontWeight: 700, color: 'var(--color-dark)' }}>+ Add family · {event.title}</h3>
          <button type="button" onClick={onClose} aria-label="Close" style={{ ...btn(), padding: '0.35rem 0.6rem' }}>✕</button>
        </div>

        {issued ? (
          <div style={{ textAlign: 'center', padding: '1rem 0' }}>
            <p style={{ margin: 0, fontWeight: 700, color: 'rgb(21,128,61)' }}>✓ Added and marked here</p>
            {issued.oneTimeCode && (
              <>
                <p style={{ margin: '0.9rem 0 0.2rem', fontSize: '0.875rem', color: 'var(--color-muted)' }}>Pickup code</p>
                <p style={{ margin: 0, fontSize: '2.25rem', fontWeight: 800, letterSpacing: '0.2em', color: 'var(--color-dark)' }}>{issued.oneTimeCode}</p>
                <p style={{ margin: '0.4rem 0 0', fontSize: '0.875rem', color: issued.smsFailed ? '#b91c1c' : 'var(--color-muted)', fontWeight: issued.smsFailed ? 700 : 400 }}>
                  {issued.smsFailed ? 'The text did not send — read the code to the parent.' : 'Texted to the parent.'}
                </p>
              </>
            )}
            <button type="button" onClick={onClose} style={{ ...btn(true), marginTop: '1.2rem', padding: '0.7rem 2rem', minHeight: '2.75rem' }}>Done</button>
          </div>
        ) : (
          <>
            {!initialHousehold && <NewFamilyButton event={event} />}
            <DoorSearch mode="event" event={event} initialHousehold={initialHousehold} onAdded={handleAdded} />
          </>
        )}
      </div>
    </div>
  )
}
