import { useWizard } from '@components/booking/WizardContext'
import type { AddOn } from '@providers/interfaces/catalog'

interface CustomizeStepProps {
  addOns: AddOn[]
  basePrice: number
}

function formatPrice(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
}

export default function CustomizeStep({ addOns, basePrice }: CustomizeStepProps) {
  const { state, dispatch } = useWizard()
  const eventType = state.eventType

  if (!eventType) return null

  const isBooking = eventType.flow === 'booking'
  const maxGuests = eventType.maxCapacity ?? 999

  const extraGuestCount = Math.max(
    0,
    state.guestCount - (eventType.baseCapacity ?? 0),
  )
  const extraGuestCost = extraGuestCount * (eventType.extraGuestPrice ?? 0)

  const addOnCost = addOns
    .filter((a) => state.selectedAddOns.includes(a.id))
    .reduce((sum, a) => sum + a.priceAmount, 0)

  const total = basePrice + extraGuestCost + addOnCost

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {isBooking && (
        <>
          {/* Guest count */}
          <div>
            <label
              htmlFor="guest-count"
              style={{
                display: 'block',
                fontSize: '0.875rem',
                fontWeight: 500,
                color: 'var(--color-dark)',
                marginBottom: '0.5rem',
              }}
            >
              Number of Guests
            </label>
            <p style={{ fontSize: '0.8125rem', color: 'var(--color-muted)', marginBottom: '0.5rem' }}>
              {eventType.baseCapacity} included in base package
              {eventType.allowExtraGuests && eventType.extraGuestPrice
                ? ` \u00b7 ${formatPrice(eventType.extraGuestPrice)}/extra guest`
                : ''}
              {eventType.maxCapacity ? ` \u00b7 ${eventType.maxCapacity} max` : ''}
            </p>
            <input
              id="guest-count"
              type="number"
              min={1}
              max={maxGuests}
              value={state.guestCount}
              onChange={(e) => {
                dispatch({
                  type: 'SET_GUEST_COUNT',
                  payload: Math.max(1, Math.min(maxGuests, Number(e.target.value))),
                })
              }}
              style={{
                width: '5rem',
                padding: '0.75rem 1rem',
                background: 'rgba(255, 255, 255, 0.75)',
                backdropFilter: 'blur(12px)',
                border: '1px solid rgba(150, 112, 91, 0.1)',
                borderRadius: '0.75rem',
                fontSize: '1rem',
                color: 'var(--color-dark)',
                outline: 'none',
              }}
            />
          </div>

          {/* Add-ons */}
          {eventType.allowAddOns && addOns.length > 0 && (
            <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
              <legend style={{
                fontSize: '0.875rem',
                fontWeight: 500,
                color: 'var(--color-dark)',
                marginBottom: '0.75rem',
              }}>
                Add-Ons
              </legend>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                {addOns.map((addOn) => (
                  <label
                    key={addOn.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      padding: '0.875rem 1rem',
                      background: state.selectedAddOns.includes(addOn.id)
                        ? 'linear-gradient(135deg, rgba(150, 112, 91, 0.1) 0%, rgba(150, 112, 91, 0.05) 100%)'
                        : 'linear-gradient(135deg, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0.35) 50%, rgba(255,255,255,0.5) 100%)',
                      backdropFilter: 'blur(20px) saturate(1.3)',
                      WebkitBackdropFilter: 'blur(20px) saturate(1.3)',
                      border: state.selectedAddOns.includes(addOn.id)
                        ? '1.5px solid var(--color-primary)'
                        : '1px solid rgba(255, 255, 255, 0.5)',
                      borderRadius: '0.75rem',
                      cursor: 'pointer',
                      transition: 'all 0.3s ease',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={state.selectedAddOns.includes(addOn.id)}
                      onChange={() =>
                        dispatch({ type: 'TOGGLE_ADDON', payload: addOn.id })
                      }
                      style={{ accentColor: 'var(--color-primary)' }}
                    />
                    <span style={{ flex: 1, fontSize: '0.875rem', color: 'var(--color-dark)' }}>
                      {addOn.name}
                    </span>
                    <span style={{ fontSize: '0.8125rem', color: 'var(--color-muted)' }}>
                      {formatPrice(addOn.priceAmount)}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {/* Price breakdown */}
          <div style={{
            padding: '1rem 1.25rem',
            background: 'linear-gradient(135deg, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0.35) 50%, rgba(255,255,255,0.5) 100%)',
            backdropFilter: 'blur(20px) saturate(1.3)',
            WebkitBackdropFilter: 'blur(20px) saturate(1.3)',
            border: '1px solid rgba(255, 255, 255, 0.5)',
            borderRadius: '0.75rem',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem', color: 'var(--color-muted)', marginBottom: '0.375rem' }}>
              <span>Base package ({eventType.baseCapacity} guests)</span>
              <span>{formatPrice(basePrice)}</span>
            </div>
            {extraGuestCount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem', color: 'var(--color-muted)', marginBottom: '0.375rem' }}>
                <span>Extra guests ({extraGuestCount} &times; {formatPrice(eventType.extraGuestPrice ?? 0)})</span>
                <span>{formatPrice(extraGuestCost)}</span>
              </div>
            )}
            {addOnCost > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem', color: 'var(--color-muted)', marginBottom: '0.375rem' }}>
                <span>Add-ons</span>
                <span>{formatPrice(addOnCost)}</span>
              </div>
            )}
            <div style={{
              borderTop: '1px solid rgba(150, 112, 91, 0.08)',
              marginTop: '0.5rem',
              paddingTop: '0.5rem',
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '1.125rem',
              fontWeight: 600,
              color: 'var(--color-dark)',
            }}>
              <span>Estimated Total</span>
              <span>{formatPrice(total)}</span>
            </div>
          </div>
        </>
      )}

      {/* Special requests */}
      <div>
        <label
          htmlFor="special-requests"
          style={{
            display: 'block',
            fontSize: '0.875rem',
            fontWeight: 500,
            color: 'var(--color-dark)',
            marginBottom: '0.5rem',
          }}
        >
          Special Requests
        </label>
        <textarea
          id="special-requests"
          rows={3}
          value={state.specialRequests}
          onChange={(e) =>
            dispatch({ type: 'SET_SPECIAL_REQUESTS', payload: e.target.value })
          }
          placeholder="Any special requests or notes..."
          style={{
            width: '100%',
            padding: '0.75rem 1rem',
            background: 'rgba(255, 255, 255, 0.75)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(150, 112, 91, 0.1)',
            borderRadius: '0.75rem',
            fontSize: '0.875rem',
            color: 'var(--color-dark)',
            outline: 'none',
            resize: 'vertical',
            fontFamily: 'inherit',
          }}
        />
      </div>

      <button
        type="button"
        onClick={() => dispatch({ type: 'GO_TO_STEP', payload: 6 })}
        style={{
          padding: '0.875rem',
          background: 'var(--color-primary)',
          color: '#fff',
          border: 'none',
          borderRadius: '0.75rem',
          fontSize: '0.875rem',
          fontWeight: 600,
          cursor: 'pointer',
          transition: 'filter 0.3s ease',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.filter = 'brightness(0.9)' }}
        onMouseLeave={(e) => { e.currentTarget.style.filter = 'none' }}
      >
        Continue to Checkout
      </button>
    </div>
  )
}
