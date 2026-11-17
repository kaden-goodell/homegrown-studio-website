/** The status pills on one card. */
export function StatusPills<S extends string>({ name, current, statuses, onMove }: { name: string; current: S; statuses: [S, string][]; onMove: (s: S) => void }) {
  return (
    <div role="group" aria-label={`Status for ${name}`} style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
      {statuses.map(([s, l]) => (
        <button key={s} type="button" aria-pressed={current === s} onClick={() => onMove(s)} className={current === s ? 'btn btn-primary' : 'btn btn-secondary'} style={{ padding: '0.3rem 0.7rem', fontSize: '0.8rem' }}>{l}</button>
      ))}
    </div>
  )
}
