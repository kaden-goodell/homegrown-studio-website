import { useState, useEffect } from 'react'
import { useReservation } from '../ReservationContext'

function formatPrice(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
}

export default function OptionsStep() {
  const { state, dispatch } = useReservation()
  const [tableCount, setTableCount] = useState(state.tableCount)
  const [wholeStudio, setWholeStudio] = useState(state.wholeStudio)
  const [partyTable, setPartyTable] = useState(state.partyTable)
  const [dedicatedHost, setDedicatedHost] = useState(state.dedicatedHost)
  const [hovered, setHovered] = useState(false)

  const wholeStudioAvailable = state.tablesAvailable >= 6

  // Derive prices from service info
  const depositPerTableCents = state.selectedVariation?.priceCents ?? 0
  const partyTableMod = state.serviceInfo?.modifiers.find(m => m.name.toLowerCase().includes('party'))
  const hostMod = state.serviceInfo?.modifiers.find(m => m.name.toLowerCase().includes('host'))
  const partyTablePriceCents = partyTableMod?.priceCents ?? 0
  const dedicatedHostPriceCents = hostMod?.priceCents ?? 0

  // Dispatch prices on mount (from dynamic catalog data)
  useEffect(() => {
    dispatch({
      type: 'SET_PRICES',
      depositPerTableCents,
      partyTablePriceCents,
      dedicatedHostPriceCents,
    })
  }, [depositPerTableCents, partyTablePriceCents, dedicatedHostPriceCents])

  const effectiveTableCount = wholeStudio ? 6 : tableCount

  const tableDeposit = effectiveTableCount * depositPerTableCents
  const partyTableCost = partyTable ? partyTablePriceCents : 0
  const dedicatedHostCost = dedicatedHost ? dedicatedHostPriceCents : 0
  const total = tableDeposit + partyTableCost + dedicatedHostCost

  function handleNext() {
    dispatch({
      type: 'SET_OPTIONS',
      tableCount: effectiveTableCount,
      wholeStudio,
      partyTable,
      dedicatedHost,
    })
    dispatch({ type: 'NEXT_STEP' })
  }

  return (
    <div>
      {/* Whole Studio toggle */}
      {wholeStudioAvailable && (
        <label style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          padding: '1rem 1.25rem',
          borderRadius: '0.75rem',
          border: wholeStudio
            ? '2px solid var(--color-primary)'
            : '1px solid rgba(150, 112, 91, 0.15)',
          background: wholeStudio
            ? 'rgba(150, 112, 91, 0.05)'
            : 'rgba(255, 255, 255, 0.8)',
          cursor: 'pointer',
          marginBottom: '1rem',
          transition: 'border-color 0.2s ease, background 0.2s ease',
        }}>
          <input
            type="checkbox"
            checked={wholeStudio}
            onChange={(e) => setWholeStudio(e.target.checked)}
            style={{ accentColor: 'var(--color-primary)', width: '1.125rem', height: '1.125rem' }}
          />
          <div>
            <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-dark)' }}>
              Book Whole Studio
            </div>
            <div style={{ fontSize: '0.8125rem', color: 'var(--color-muted)' }}>
              All 6 tables
            </div>
          </div>
        </label>
      )}

      {/* Table count selector */}
      {!wholeStudio && (
        <div style={{ marginBottom: '1rem' }}>
          <label style={{
            display: 'block',
            fontSize: '0.8125rem',
            fontWeight: 500,
            color: 'var(--color-dark)',
            marginBottom: '0.5rem',
          }}>
            Number of Tables
          </label>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {Array.from({ length: state.tablesAvailable }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setTableCount(n)}
                style={{
                  width: '2.75rem',
                  height: '2.75rem',
                  borderRadius: '0.5rem',
                  border: tableCount === n
                    ? '2px solid var(--color-primary)'
                    : '1px solid rgba(150, 112, 91, 0.15)',
                  background: tableCount === n
                    ? 'rgba(150, 112, 91, 0.05)'
                    : 'rgba(255, 255, 255, 0.8)',
                  fontSize: '0.875rem',
                  fontWeight: tableCount === n ? 600 : 400,
                  color: 'var(--color-dark)',
                  cursor: 'pointer',
                  transition: 'border-color 0.2s ease, background 0.2s ease',
                }}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Dynamic modifiers from Square catalog */}
      {partyTableMod && state.partyTableAvailable && (
        <label style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          padding: '1rem 1.25rem',
          borderRadius: '0.75rem',
          border: partyTable
            ? '2px solid var(--color-primary)'
            : '1px solid rgba(150, 112, 91, 0.15)',
          background: partyTable
            ? 'rgba(150, 112, 91, 0.05)'
            : 'rgba(255, 255, 255, 0.8)',
          cursor: 'pointer',
          marginBottom: '0.75rem',
          transition: 'border-color 0.2s ease, background 0.2s ease',
        }}>
          <input
            type="checkbox"
            checked={partyTable}
            onChange={(e) => setPartyTable(e.target.checked)}
            style={{ accentColor: 'var(--color-primary)', width: '1.125rem', height: '1.125rem' }}
          />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-dark)' }}>
              {partyTableMod.name}
            </div>
          </div>
          <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-dark)' }}>
            {formatPrice(partyTablePriceCents)}
          </span>
        </label>
      )}

      {hostMod && state.dedicatedHostAvailable && (
        <label style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          padding: '1rem 1.25rem',
          borderRadius: '0.75rem',
          border: dedicatedHost
            ? '2px solid var(--color-primary)'
            : '1px solid rgba(150, 112, 91, 0.15)',
          background: dedicatedHost
            ? 'rgba(150, 112, 91, 0.05)'
            : 'rgba(255, 255, 255, 0.8)',
          cursor: 'pointer',
          marginBottom: '1.5rem',
          transition: 'border-color 0.2s ease, background 0.2s ease',
        }}>
          <input
            type="checkbox"
            checked={dedicatedHost}
            onChange={(e) => setDedicatedHost(e.target.checked)}
            style={{ accentColor: 'var(--color-primary)', width: '1.125rem', height: '1.125rem' }}
          />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-dark)' }}>
              {hostMod.name}
            </div>
          </div>
          <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-dark)' }}>
            {formatPrice(dedicatedHostPriceCents)}
          </span>
        </label>
      )}

      {/* Price summary */}
      <div style={{
        padding: '1rem 1.25rem',
        borderRadius: '0.75rem',
        border: '1px solid rgba(150, 112, 91, 0.08)',
        background: 'rgba(255, 255, 255, 0.6)',
        marginBottom: '1.5rem',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
          <span style={{ fontSize: '0.8125rem', color: 'var(--color-muted)' }}>
            Table deposit: {effectiveTableCount} {effectiveTableCount === 1 ? 'table' : 'tables'} &times; {formatPrice(depositPerTableCents)}
          </span>
          <span style={{ fontSize: '0.875rem', color: 'var(--color-dark)' }}>
            {formatPrice(tableDeposit)}
          </span>
        </div>
        {partyTable && (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.8125rem', color: 'var(--color-muted)' }}>{partyTableMod?.name ?? 'Party Table'}</span>
            <span style={{ fontSize: '0.875rem', color: 'var(--color-dark)' }}>
              {formatPrice(partyTablePriceCents)}
            </span>
          </div>
        )}
        {dedicatedHost && (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.8125rem', color: 'var(--color-muted)' }}>{hostMod?.name ?? 'Dedicated Host'}</span>
            <span style={{ fontSize: '0.875rem', color: 'var(--color-dark)' }}>
              {formatPrice(dedicatedHostPriceCents)}
            </span>
          </div>
        )}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          paddingTop: '0.75rem',
          borderTop: '1px solid rgba(150, 112, 91, 0.08)',
        }}>
          <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-dark)' }}>Total</span>
          <span style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--color-dark)' }}>
            {formatPrice(total)}
          </span>
        </div>
        <p style={{ fontSize: '0.8125rem', color: 'rgb(34, 197, 94)', marginTop: '0.5rem' }}>
          {formatPrice(tableDeposit)} will be applied as craft credit
        </p>
      </div>

      {/* Next button */}
      <button
        type="button"
        onClick={handleNext}
        style={{
          width: '100%',
          padding: '0.875rem',
          background: 'linear-gradient(135deg, var(--color-primary), var(--color-accent))',
          color: '#fff',
          border: 'none',
          borderRadius: '0.75rem',
          fontSize: '0.875rem',
          fontWeight: 600,
          cursor: 'pointer',
          boxShadow: hovered ? '0 8px 25px rgba(150, 112, 91, 0.35)' : '0 4px 15px rgba(150, 112, 91, 0.2)',
          transform: hovered ? 'translateY(-1px)' : 'none',
          transition: 'box-shadow 0.3s ease, transform 0.3s ease',
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        Next
      </button>
    </div>
  )
}
