import { useEffect, useState } from 'react'
import WorkshopCard from '@components/workshops/WorkshopCard'
import type { WorkshopData } from '@components/workshops/WorkshopExplorer'
import { byStart } from '@components/workshops/workshop-view-model'

/** How many workshops the home page shows before "See all workshops". */
const SHOWN = 3

export default function UpcomingWorkshops() {
  const [workshops, setWorkshops] = useState<WorkshopData[]>([])

  useEffect(() => {
    let cancelled = false
    fetch('/api/workshops.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`workshops ${r.status}`))))
      .then((d: { workshops?: WorkshopData[] }) => {
        if (cancelled) return
        const list = (Array.isArray(d?.workshops) ? d.workshops : [])
          .slice()
          .sort(byStart)
          .slice(0, SHOWN)
        setWorkshops(list)
      })
      .catch((err) => {
        // Section hides itself when empty — degrade silently for visitors,
        // but keep the failure visible to developers.
        console.error('workshops fetch failed:', err)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (workshops.length === 0) return null

  return (
    <section style={{ padding: '3rem 1rem' }}>
      <div style={{ maxWidth: '64rem', margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
          <p className="eyebrow tone-workshop" style={{ marginBottom: '0.75rem' }}>
            Coming Up
          </p>
          <h2 className="font-heading" style={{ fontSize: 'clamp(1.875rem, 4vw, 3rem)', fontWeight: 700, color: 'var(--color-dark)' }}>
            Upcoming Workshops
          </h2>
        </div>
        {/* The same card as the workshops page; here its button leads there. */}
        <div style={{ display: 'grid', gap: '1.25rem', gridTemplateColumns: 'repeat(auto-fit, minmax(16rem, 1fr))' }}>
          {workshops.map((w) => (
            <WorkshopCard key={w.id} workshop={w} href={`/workshops?w=${encodeURIComponent(w.id)}`} />
          ))}
        </div>
        <p style={{ textAlign: 'center', marginTop: '2rem' }}>
          <a href="/workshops" style={{ fontSize: '0.9375rem', fontWeight: 500, color: 'var(--color-primary)' }}>See all workshops →</a>
        </p>
      </div>
    </section>
  )
}
