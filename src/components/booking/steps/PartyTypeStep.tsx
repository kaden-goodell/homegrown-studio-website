import { useState, useEffect } from 'react'
import { useWizard } from '@components/booking/WizardContext'
import type { EventType } from '@providers/interfaces/catalog'

export default function PartyTypeStep() {
  const { state, dispatch } = useWizard()
  const [partyTypes, setPartyTypes] = useState<EventType[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!state.eventType?.catalogCategory) return

    fetch(`/api/catalog/event-types.json?category=${state.eventType.catalogCategory}`)
      .then((res) => res.json())
      .then((json) => {
        const items: EventType[] = json.data ?? json
        setPartyTypes(items)
      })
      .catch(() => setPartyTypes([]))
      .finally(() => setLoading(false))
  }, [state.eventType?.catalogCategory])

  function handleSelect(partyType: EventType) {
    dispatch({ type: 'SET_PARTY_TYPE', payload: partyType })
    dispatch({ type: 'GO_TO_STEP', payload: 4 })
  }

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--color-muted)', fontSize: '0.875rem' }}>
        Loading party options...
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', marginBottom: '0.25rem' }}>
        Choose your party activity:
      </p>
      <div style={{
        display: 'grid',
        gap: '1rem',
        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
      }}>
        {partyTypes.map((pt) => (
          <button
            key={pt.id}
            type="button"
            onClick={() => handleSelect(pt)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              padding: '1.25rem',
              background: 'linear-gradient(135deg, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0.35) 50%, rgba(255,255,255,0.5) 100%)',
              backdropFilter: 'blur(20px) saturate(1.3)',
              WebkitBackdropFilter: 'blur(20px) saturate(1.3)',
              border: '1px solid rgba(255, 255, 255, 0.5)',
              borderRadius: '0.75rem',
              boxShadow: '0 2px 8px rgba(150, 112, 91, 0.06)',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.3s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)'
              e.currentTarget.style.boxShadow = '0 8px 24px rgba(150, 112, 91, 0.12)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'none'
              e.currentTarget.style.boxShadow = '0 2px 8px rgba(150, 112, 91, 0.06)'
            }}
          >
            {pt.imageUrl && (
              <img
                src={pt.imageUrl}
                alt={pt.name}
                style={{
                  width: '100%',
                  height: '8rem',
                  objectFit: 'cover',
                  borderRadius: '0.5rem',
                  marginBottom: '0.75rem',
                }}
              />
            )}
            <h4 style={{
              fontSize: '0.9375rem',
              fontWeight: 600,
              fontFamily: 'var(--font-heading)',
              color: 'var(--color-dark)',
              marginBottom: '0.375rem',
            }}>
              {pt.name}
            </h4>
            <p style={{
              fontSize: '0.8125rem',
              lineHeight: 1.5,
              color: 'var(--color-muted)',
              display: '-webkit-box',
              WebkitLineClamp: 3,
              WebkitBoxOrient: 'vertical' as const,
              overflow: 'hidden',
            }}>
              {pt.description}
            </p>
          </button>
        ))}
      </div>
    </div>
  )
}
