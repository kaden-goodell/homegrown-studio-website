import type { PartySummary } from '@lib/party-summary'

/**
 * The party price, split by when it is paid. The same block on the Guests step
 * and the payment step, so nothing changes size or wording between them.
 */
const groupLabel = {
  margin: '0 0 0.375rem',
  fontSize: '0.75rem',
  fontWeight: 700,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--color-text)',
} as const

const row = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  gap: '1rem',
  fontSize: '0.9375rem',
  lineHeight: 1.4,
  color: 'var(--color-dark)',
} as const

const amount = { flexShrink: 0, fontWeight: 600, whiteSpace: 'nowrap' } as const
const rule = { border: 'none', borderTop: '1px solid var(--color-line)', margin: '0.75rem 0' } as const

export default function PartyPriceSummary({ summary }: { summary: PartySummary }) {
  return (
    <section
      aria-label="Price summary"
      style={{ padding: '1rem 1.125rem', borderRadius: '0.75rem', background: 'var(--color-sand)' }}
    >
      <p style={groupLabel}>Pay today</p>
      {summary.today.map((line) => (
        <div key={line.label} style={{ ...row, marginBottom: '0.25rem' }}>
          <span>{line.label}</span>
          <span style={amount}>{line.amount}</span>
        </div>
      ))}

      {summary.atStudio.length > 0 && (
        <>
          <hr style={rule} />
          <p style={groupLabel}>Pay at the studio</p>
          {summary.atStudio.map((line) => (
            <div key={line.label}>
              <div style={row}>
                <span>{line.label}</span>
                <span style={amount}>{line.amount}</span>
              </div>
              {line.note && (
                <p style={{ margin: '0.125rem 0 0', fontSize: '0.875rem', color: 'var(--color-text)' }}>{line.note}</p>
              )}
            </div>
          ))}
          <hr style={rule} />
          <div style={{ ...row, fontWeight: 600 }}>
            <span>Estimated party total</span>
            <span style={amount}>{summary.estimatedTotal}</span>
          </div>
        </>
      )}
    </section>
  )
}
