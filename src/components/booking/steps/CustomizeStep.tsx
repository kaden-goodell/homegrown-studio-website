import { useWizard } from '@components/booking/WizardContext'
import type { AddOn } from '@providers/interfaces/catalog'

interface CustomizeStepProps {
  addOns: AddOn[]
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

export default function CustomizeStep({ addOns }: CustomizeStepProps) {
  const { state, dispatch } = useWizard()
  const eventType = state.eventType

  if (!eventType) return null

  const isBooking = eventType.flow === 'booking'

  const extraGuestCount = Math.max(
    0,
    state.guestCount - (eventType.baseCapacity ?? 0),
  )
  const extraGuestCost = extraGuestCount * (eventType.extraGuestPrice ?? 0)

  const addOnCost = addOns
    .filter((a) => state.selectedAddOns.includes(a.id))
    .reduce((sum, a) => sum + a.priceAmount, 0)

  const additionalCost = extraGuestCost + addOnCost

  return (
    <div className="space-y-6">
      {isBooking && (
        <>
          <div className="space-y-2">
            <label
              htmlFor="guest-count"
              className="block text-sm font-medium text-gray-700"
            >
              Number of Guests
            </label>
            {eventType.baseCapacity != null && (
              <p className="text-sm text-gray-500">
                Base: {eventType.baseCapacity} guests
              </p>
            )}
            <input
              id="guest-count"
              type="number"
              min={1}
              value={state.guestCount}
              onChange={(e) =>
                dispatch({
                  type: 'SET_GUEST_COUNT',
                  payload: Math.max(1, Number(e.target.value)),
                })
              }
              className="w-24 rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
            />
            {eventType.allowExtraGuests && eventType.extraGuestPrice != null && (
              <p className="text-sm text-gray-500">
                +{formatPrice(eventType.extraGuestPrice)} per extra guest
              </p>
            )}
          </div>

          {eventType.allowAddOns && addOns.length > 0 && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-gray-700">
                Add-Ons
              </legend>
              {addOns.map((addOn) => (
                <label
                  key={addOn.id}
                  className="flex items-center gap-2 text-sm text-gray-700"
                >
                  <input
                    type="checkbox"
                    checked={state.selectedAddOns.includes(addOn.id)}
                    onChange={() =>
                      dispatch({ type: 'TOGGLE_ADDON', payload: addOn.id })
                    }
                    className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                  />
                  {addOn.name} - {formatPrice(addOn.priceAmount)}
                </label>
              ))}
            </fieldset>
          )}

          <div className="rounded-md bg-purple-50 p-4">
            <p className="text-sm font-medium text-purple-800">
              Additional costs: {formatPrice(additionalCost)}
            </p>
          </div>
        </>
      )}

      <div className="space-y-2">
        <label
          htmlFor="special-requests"
          className="block text-sm font-medium text-gray-700"
        >
          Special Requests
        </label>
        <textarea
          id="special-requests"
          rows={4}
          value={state.specialRequests}
          onChange={(e) =>
            dispatch({ type: 'SET_SPECIAL_REQUESTS', payload: e.target.value })
          }
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
          placeholder="Any special requests or notes..."
        />
      </div>

      <button
        type="button"
        onClick={() => dispatch({ type: 'GO_TO_STEP', payload: 4 })}
        className="rounded-md bg-purple-600 px-6 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2"
      >
        Continue
      </button>
    </div>
  )
}
