# Specific Party Types Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add catalog-driven specific party types (pottery, slime, knitting, etc.) to the booking modal, inserted after date/time selection and before the details step.

**Architecture:** The three landing page cards (Kids/Adult/Corporate) become category selectors. After date & time selection in the modal, a new PartyTypeStep fetches catalog items by category (`kids-party` or `adult-party`) and displays them as cards. The selected party type's catalog data (name, description, image, variation price) flows through a new `selectedPartyType` field in WizardContext to DetailsStep, CustomizeStep, and CheckoutStep.

**Tech Stack:** React, TypeScript, Vitest, existing WizardContext reducer pattern, existing CatalogProvider interface

---

### Task 1: Add mock catalog data for specific party types

**Files:**
- Modify: `src/providers/mock/data.ts`

**Step 1: Add 8 new EventType entries to mockEventTypes**

Add these items to the `mockEventTypes` array in `src/providers/mock/data.ts`, after the `corporate-event` entry and before `workshop-pottery`:

```typescript
  // Kids party types
  {
    id: 'kids-slime',
    name: 'Slime Party',
    description: 'Gooey, glittery, totally messy fun! Kids make custom slime creations with mix-ins like foam beads, glitter, and scented oils. Each guest takes home their own slime jar.',
    category: 'kids-party',
    imageUrl: '/images/parties/kids-slime.jpg',
    duration: 120,
    baseCapacity: 12,
    maxCapacity: 20,
    flow: 'booking' as const,
    variations: [
      { id: 'kids-slime-base', name: 'Base Package', priceAmount: 40000, priceCurrency: 'USD' },
    ],
    modifiers: [],
  },
  {
    id: 'kids-painting',
    name: 'Painting Party',
    description: 'Canvas painting with guided instruction — each guest creates their own masterpiece to take home. Choose from our gallery of kid-friendly designs or request a custom theme.',
    category: 'kids-party',
    imageUrl: '/images/parties/kids-painting.jpg',
    duration: 120,
    baseCapacity: 12,
    maxCapacity: 20,
    flow: 'booking' as const,
    variations: [
      { id: 'kids-painting-base', name: 'Base Package', priceAmount: 40000, priceCurrency: 'USD' },
    ],
    modifiers: [],
  },
  {
    id: 'kids-pottery',
    name: 'Pottery Party',
    description: 'Hand-building with air-dry clay — kids sculpt bowls, animals, and imaginative creations. Each piece is painted and sealed to take home the same day.',
    category: 'kids-party',
    imageUrl: '/images/parties/kids-pottery.jpg',
    duration: 120,
    baseCapacity: 12,
    maxCapacity: 20,
    flow: 'booking' as const,
    variations: [
      { id: 'kids-pottery-base', name: 'Base Package', priceAmount: 40000, priceCurrency: 'USD' },
    ],
    modifiers: [],
  },
  {
    id: 'kids-jewelry',
    name: 'Jewelry Making Party',
    description: 'Beaded bracelets, necklaces, and keychains — kids design and assemble their own wearable art using colorful beads, charms, and cord.',
    category: 'kids-party',
    imageUrl: '/images/parties/kids-jewelry.jpg',
    duration: 120,
    baseCapacity: 12,
    maxCapacity: 20,
    flow: 'booking' as const,
    variations: [
      { id: 'kids-jewelry-base', name: 'Base Package', priceAmount: 40000, priceCurrency: 'USD' },
    ],
    modifiers: [],
  },
  // Adult party types
  {
    id: 'adult-pottery',
    name: 'Pottery Party',
    description: 'Wheel throwing and hand-building — your group creates functional pottery pieces like mugs, bowls, and vases. Pieces are kiln-fired and ready for pickup in two weeks.',
    category: 'adult-party',
    imageUrl: '/images/parties/adult-pottery.jpg',
    duration: 150,
    baseCapacity: 12,
    maxCapacity: 36,
    flow: 'booking' as const,
    variations: [
      { id: 'adult-pottery-base', name: 'Base Package', priceAmount: 40000, priceCurrency: 'USD' },
    ],
    modifiers: [],
  },
  {
    id: 'adult-candle',
    name: 'Candle Making Party',
    description: 'Custom scented soy candles — choose from 30+ fragrance oils to create your signature blend. Each guest makes two candles in their choice of vessel.',
    category: 'adult-party',
    imageUrl: '/images/parties/adult-candle.jpg',
    duration: 150,
    baseCapacity: 12,
    maxCapacity: 36,
    flow: 'booking' as const,
    variations: [
      { id: 'adult-candle-base', name: 'Base Package', priceAmount: 40000, priceCurrency: 'USD' },
    ],
    modifiers: [],
  },
  {
    id: 'adult-knitting',
    name: 'Knitting Party',
    description: 'Learn to knit with wine and snacks — a relaxed evening of fiber arts. Beginners welcome! Each guest starts a scarf or cowl project to take home.',
    category: 'adult-party',
    imageUrl: '/images/parties/adult-knitting.jpg',
    duration: 150,
    baseCapacity: 12,
    maxCapacity: 36,
    flow: 'booking' as const,
    variations: [
      { id: 'adult-knitting-base', name: 'Base Package', priceAmount: 40000, priceCurrency: 'USD' },
    ],
    modifiers: [],
  },
  {
    id: 'adult-watercolor',
    name: 'Watercolor Party',
    description: 'Guided watercolor painting session — no experience needed. Your group paints a beautiful botanical or landscape piece with step-by-step instruction.',
    category: 'adult-party',
    imageUrl: '/images/parties/adult-watercolor.jpg',
    duration: 150,
    baseCapacity: 12,
    maxCapacity: 36,
    flow: 'booking' as const,
    variations: [
      { id: 'adult-watercolor-base', name: 'Base Package', priceAmount: 40000, priceCurrency: 'USD' },
    ],
    modifiers: [],
  },
```

**Step 2: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: Clean (0 errors)

**Step 3: Run existing tests**

Run: `npx vitest run`
Expected: All existing tests pass (mock data additions shouldn't break anything)

**Step 4: Commit**

```bash
git add src/providers/mock/data.ts
git commit -m "feat(parties): add mock catalog data for specific party types"
```

---

### Task 2: Add `catalogCategory` to EventTypeConfig and site.config

**Files:**
- Modify: `src/config/site.config.ts:103-117` (EventTypeConfig interface)
- Modify: `src/config/site.config.ts:153-184` (partyTypes array)
- Modify: `src/config/site.config.ts:304-318` (eventTypes array, corporate entry)

**Step 1: Add `catalogCategory` field to EventTypeConfig**

In `src/config/site.config.ts`, add a new optional field to `EventTypeConfig`:

```typescript
export interface EventTypeConfig {
  id: string
  name: string
  description: string
  icon?: string
  flow: 'booking' | 'quote'
  baseCapacity?: number
  duration: number
  allowAddOns: boolean
  allowExtraGuests: boolean
  extraGuestPrice?: number
  maxCapacity?: number
  basePrice?: number
  catalogItemId?: string
  catalogCategory?: string  // <-- add this line
}
```

**Step 2: Add `catalogCategory` to party type configs**

In the `partyTypes` array, add `catalogCategory` to each entry:

For Kids Party (id: `birthday`), add: `catalogCategory: 'kids-party',`
For Adult Party (id: `adult-party`), add: `catalogCategory: 'adult-party',`

Do NOT add `catalogCategory` to the corporate entry — corporate is out of scope.

**Step 3: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: Clean (0 errors)

**Step 4: Commit**

```bash
git add src/config/site.config.ts
git commit -m "feat(parties): add catalogCategory field to EventTypeConfig"
```

---

### Task 3: Add `selectedPartyType` to WizardContext

**Files:**
- Modify: `src/components/booking/WizardContext.tsx`
- Modify: `tests/components/booking/WizardContext.test.tsx`

**Step 1: Write the failing test**

Add a new test to `tests/components/booking/WizardContext.test.tsx`:

```typescript
it('SET_PARTY_TYPE stores the selected party type', () => {
  const partyType = {
    id: 'kids-slime',
    name: 'Slime Party',
    description: 'Gooey fun',
    category: 'kids-party',
    duration: 120,
    flow: 'booking' as const,
    variations: [{ id: 'kids-slime-base', name: 'Base Package', priceAmount: 40000, priceCurrency: 'USD' }],
    modifiers: [],
  }
  const result = wizardReducer(initialState, { type: 'SET_PARTY_TYPE', payload: partyType })
  expect(result.selectedPartyType).toEqual(partyType)
})

it('RESET clears selectedPartyType', () => {
  const stateWithParty = {
    ...initialState,
    selectedPartyType: {
      id: 'kids-slime',
      name: 'Slime Party',
      description: 'Gooey fun',
      category: 'kids-party',
      duration: 120,
      flow: 'booking' as const,
      variations: [{ id: 'kids-slime-base', name: 'Base Package', priceAmount: 40000, priceCurrency: 'USD' }],
      modifiers: [],
    },
  }
  const result = wizardReducer(stateWithParty as any, { type: 'RESET' })
  expect(result.selectedPartyType).toBeNull()
})
```

You'll need to add the `EventType` import at the top of the test file:

```typescript
import type { EventType } from '@providers/interfaces/catalog'
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/booking/WizardContext.test.tsx`
Expected: FAIL — `SET_PARTY_TYPE` is not a valid action type, `selectedPartyType` doesn't exist on state

**Step 3: Implement WizardContext changes**

In `src/components/booking/WizardContext.tsx`:

1. Add the import at the top:
```typescript
import type { EventType } from '@providers/interfaces/catalog'
```

2. Add `selectedPartyType` to `WizardState`:
```typescript
export interface WizardState {
  currentStep: number
  eventType: EventTypeConfig | null
  selectedPartyType: EventType | null  // <-- add this line
  selectedDates: { start: string; end: string } | null
  // ... rest unchanged
}
```

3. Add `SET_PARTY_TYPE` to `WizardAction`:
```typescript
export type WizardAction =
  | { type: 'SET_EVENT_TYPE'; payload: EventTypeConfig }
  | { type: 'SET_PARTY_TYPE'; payload: EventType }  // <-- add this line
  | { type: 'SET_DATES'; payload: { start: string; end: string } }
  // ... rest unchanged
```

4. Add `selectedPartyType: null` to `initialState`:
```typescript
export const initialState: WizardState = {
  currentStep: 0,
  eventType: null,
  selectedPartyType: null,  // <-- add this line
  selectedDates: null,
  // ... rest unchanged
}
```

5. Add the reducer case after `SET_EVENT_TYPE`:
```typescript
case 'SET_PARTY_TYPE':
  return { ...state, selectedPartyType: action.payload }
```

6. Update RESET to include `selectedPartyType: null` (it already spreads `initialState` so this is automatic).

**Step 4: Run tests**

Run: `npx vitest run tests/components/booking/WizardContext.test.tsx`
Expected: All PASS

**Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All pass

**Step 6: Commit**

```bash
git add src/components/booking/WizardContext.tsx tests/components/booking/WizardContext.test.tsx
git commit -m "feat(parties): add selectedPartyType to WizardContext"
```

---

### Task 4: Create PartyTypeStep component

**Files:**
- Create: `src/components/booking/steps/PartyTypeStep.tsx`
- Create: `tests/components/booking/steps/PartyTypeStep.test.tsx`

**Step 1: Write the failing test**

Create `tests/components/booking/steps/PartyTypeStep.test.tsx`:

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockDispatch = vi.fn()

vi.mock('@components/booking/WizardContext', () => ({
  useWizard: () => ({
    state: {
      eventType: { id: 'birthday', name: 'Kids Party', catalogCategory: 'kids-party', flow: 'booking', duration: 120, allowAddOns: true, allowExtraGuests: true },
      selectedPartyType: null,
      currentStep: 3,
      selectedDates: null,
      desiredDuration: null,
      selectedSlot: null,
      guestCount: 12,
      selectedAddOns: [],
      specialRequests: '',
      customerInfo: null,
      couponCode: null,
      appliedDiscount: null,
      orderId: null,
      bookingId: null,
      paymentStatus: 'idle',
      error: null,
    },
    dispatch: mockDispatch,
  }),
}))

// Mock fetch to return party types
global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve({
    data: [
      {
        id: 'kids-slime',
        name: 'Slime Party',
        description: 'Gooey, glittery, totally messy fun!',
        category: 'kids-party',
        variations: [{ id: 'kids-slime-base', name: 'Base Package', priceAmount: 40000, priceCurrency: 'USD' }],
        modifiers: [],
        flow: 'booking',
        duration: 120,
      },
      {
        id: 'kids-painting',
        name: 'Painting Party',
        description: 'Canvas painting with guided instruction.',
        category: 'kids-party',
        variations: [{ id: 'kids-painting-base', name: 'Base Package', priceAmount: 40000, priceCurrency: 'USD' }],
        modifiers: [],
        flow: 'booking',
        duration: 120,
      },
    ],
  }),
}) as any

import PartyTypeStep from '@components/booking/steps/PartyTypeStep'

describe('PartyTypeStep', () => {
  beforeEach(() => {
    mockDispatch.mockClear()
    ;(global.fetch as any).mockClear()
  })

  it('fetches party types by catalog category and renders cards', async () => {
    render(<PartyTypeStep />)

    await waitFor(() => {
      expect(screen.getByText('Slime Party')).toBeInTheDocument()
      expect(screen.getByText('Painting Party')).toBeInTheDocument()
    })

    expect(global.fetch).toHaveBeenCalledWith('/api/catalog/event-types.json?category=kids-party')
  })

  it('dispatches SET_PARTY_TYPE and GO_TO_STEP on card click', async () => {
    render(<PartyTypeStep />)

    await waitFor(() => {
      expect(screen.getByText('Slime Party')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Slime Party'))

    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'SET_PARTY_TYPE',
      payload: expect.objectContaining({ id: 'kids-slime', name: 'Slime Party' }),
    })
    expect(mockDispatch).toHaveBeenCalledWith({ type: 'GO_TO_STEP', payload: 4 })
  })

  it('shows short descriptions on each card', async () => {
    render(<PartyTypeStep />)

    await waitFor(() => {
      expect(screen.getByText(/Gooey, glittery/)).toBeInTheDocument()
      expect(screen.getByText(/Canvas painting/)).toBeInTheDocument()
    })
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/booking/steps/PartyTypeStep.test.tsx`
Expected: FAIL — module not found

**Step 3: Create PartyTypeStep component**

Create `src/components/booking/steps/PartyTypeStep.tsx`:

```tsx
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
```

**Step 4: Run tests**

Run: `npx vitest run tests/components/booking/steps/PartyTypeStep.test.tsx`
Expected: All PASS

**Step 5: Commit**

```bash
git add src/components/booking/steps/PartyTypeStep.tsx tests/components/booking/steps/PartyTypeStep.test.tsx
git commit -m "feat(parties): add PartyTypeStep component for specific party selection"
```

---

### Task 5: Rewire BookingModal for new step order

The modal step order changes from:
```
1=Details, 2=Date, 3=TimeSlot, 4=Customize, 5=Checkout
```
to:
```
1=Date, 2=TimeSlot, 3=PartyType, 4=Details, 5=Customize, 6=Checkout
```

**Files:**
- Modify: `src/components/booking/BookingModal.tsx`

**Step 1: Update step labels**

Change:
```typescript
const MODAL_STEP_LABELS = ['Details', 'Date', 'Time Slot', 'Customize', 'Checkout']
```
to:
```typescript
const MODAL_STEP_LABELS = ['Date', 'Time Slot', 'Party Type', 'Details', 'Customize', 'Checkout']
```

**Step 2: Add PartyTypeStep import**

Add at top of file:
```typescript
import PartyTypeStep from './steps/PartyTypeStep'
```

**Step 3: Update finalStepLabel index**

Change the final step label replacement from index 4 to index 5:
```typescript
const finalStepLabel = state.eventType?.flow === 'quote' ? 'Inquiry' : 'Checkout'
const stepLabels = MODAL_STEP_LABELS.map((label, i) =>
  i === 5 ? finalStepLabel : label,
)
```

**Step 4: Update renderStep switch**

Replace the entire `renderStep` function body:

```typescript
function renderStep() {
  switch (displayStep) {
    case 1:
      return <DateSelectionStep onSlotsLoaded={setAvailableSlots} />
    case 2:
      return <AvailableSlotsStep slots={availableSlots} />
    case 3:
      return <PartyTypeStep />
    case 4: {
      const partyType = state.selectedPartyType
      const detailsTags = [
        ...(state.eventType?.duration ? [{ label: `${state.eventType.duration} min` }] : []),
        ...(state.eventType?.maxCapacity
          ? [{ label: `Up to ${state.eventType.maxCapacity} guests` }]
          : state.eventType?.baseCapacity
            ? [{ label: `Up to ${state.eventType.baseCapacity} guests` }]
            : []),
      ]
      return (
        <DetailsStep
          imageUrl={partyType?.imageUrl}
          title={partyType?.name ?? state.eventType?.name ?? ''}
          description={partyType?.description ?? state.eventType?.description ?? ''}
          tags={detailsTags}
          buttonText="Continue"
          onContinue={() => dispatch({ type: 'GO_TO_STEP', payload: 5 })}
        />
      )
    }
    case 5:
      return <CustomizeStep addOns={addOns} basePrice={state.selectedPartyType?.variations?.[0]?.priceAmount ?? state.eventType?.basePrice ?? 0} />
    case 6:
      return state.eventType?.flow === 'quote' ? (
        <InquiryStep />
      ) : (
        <CheckoutStep />
      )
    default:
      return null
  }
}
```

**Step 5: Update add-ons fetch step trigger**

Change the add-ons `useEffect` from step 4 to step 5:
```typescript
if (state.currentStep === 5 && state.eventType) {
```

**Step 6: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: Clean

**Step 7: Commit**

```bash
git add src/components/booking/BookingModal.tsx
git commit -m "feat(parties): rewire BookingModal for new 6-step flow with PartyTypeStep"
```

---

### Task 6: Update GO_TO_STEP dispatches in existing step components

The step numbers all shift because Date is now step 1 (was 2), TimeSlot is now step 2 (was 3), etc.

**Files:**
- Modify: `src/components/booking/steps/DateSelectionStep.tsx` — GO_TO_STEP 3 → 2
- Modify: `src/components/booking/steps/AvailableSlotsStep.tsx` — GO_TO_STEP 4 → 3
- Modify: `src/components/booking/steps/CustomizeStep.tsx` — GO_TO_STEP 5 → 6

**Step 1: Update DateSelectionStep**

In `src/components/booking/steps/DateSelectionStep.tsx`, find:
```typescript
dispatch({ type: 'GO_TO_STEP', payload: 3 })
```
Change to:
```typescript
dispatch({ type: 'GO_TO_STEP', payload: 2 })
```

**Step 2: Update AvailableSlotsStep**

In `src/components/booking/steps/AvailableSlotsStep.tsx`, find:
```typescript
dispatch({ type: 'GO_TO_STEP', payload: 4 })
```
Change to:
```typescript
dispatch({ type: 'GO_TO_STEP', payload: 3 })
```

**Step 3: Update CustomizeStep**

In `src/components/booking/steps/CustomizeStep.tsx`, find:
```typescript
dispatch({ type: 'GO_TO_STEP', payload: 5 })
```
Change to:
```typescript
dispatch({ type: 'GO_TO_STEP', payload: 6 })
```

**Step 4: Update tests for step number changes**

In `tests/components/booking/steps/DateSelectionStep.test.tsx`, update the expected GO_TO_STEP payload from 3 to 2.

In `tests/components/booking/steps/AvailableSlotsStep.test.tsx`, update the expected GO_TO_STEP payload from 4 to 3.

In `tests/components/booking/steps/CustomizeStep.test.tsx`, update the expected GO_TO_STEP payload from 5 to 6.

**Step 5: Run tests**

Run: `npx vitest run`
Expected: All pass

**Step 6: Commit**

```bash
git add src/components/booking/steps/DateSelectionStep.tsx src/components/booking/steps/AvailableSlotsStep.tsx src/components/booking/steps/CustomizeStep.tsx tests/components/booking/steps/DateSelectionStep.test.tsx tests/components/booking/steps/AvailableSlotsStep.test.tsx tests/components/booking/steps/CustomizeStep.test.tsx
git commit -m "fix(parties): update step numbers after PartyTypeStep insertion"
```

---

### Task 7: Update CustomizeStep to read base price from selectedPartyType

**Files:**
- Modify: `src/components/booking/steps/CustomizeStep.tsx`

**Step 1: Update price source**

Currently `CustomizeStep` receives `basePrice` as a prop. The BookingModal already passes the catalog price in Task 5:

```typescript
basePrice={state.selectedPartyType?.variations?.[0]?.priceAmount ?? state.eventType?.basePrice ?? 0}
```

So no code changes needed in CustomizeStep itself — the prop already works. Just verify the price displays correctly by checking the existing test still passes.

**Step 2: Run tests**

Run: `npx vitest run tests/components/booking/steps/CustomizeStep.test.tsx`
Expected: All pass

---

### Task 8: Update CheckoutStep to use catalog item for order creation

**Files:**
- Modify: `src/components/booking/steps/CheckoutStep.tsx`

**Step 1: Update buildLineItems to use selectedPartyType**

In `src/components/booking/steps/CheckoutStep.tsx`, update the `buildLineItems` function. Replace the base price logic:

Change:
```typescript
if (state.eventType) {
  // Use basePrice from config, fall back to catalog variation
  const basePrice = state.eventType.basePrice
    ?? catalogEvent?.variations?.[0]?.priceAmount
    ?? 0

  items.push({
    name: state.eventType.name,
    quantity: 1,
    pricePerUnit: basePrice,
  })
```

To:
```typescript
if (state.eventType) {
  const basePrice = state.selectedPartyType?.variations?.[0]?.priceAmount
    ?? state.eventType.basePrice
    ?? catalogEvent?.variations?.[0]?.priceAmount
    ?? 0

  items.push({
    name: state.selectedPartyType?.name ?? state.eventType.name,
    quantity: 1,
    pricePerUnit: basePrice,
  })
```

This prioritizes: catalog party type price → config basePrice → catalog event variation → 0.

**Step 2: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: Clean

**Step 3: Run tests**

Run: `npx vitest run tests/components/booking/steps/CheckoutStep.test.tsx`
Expected: All pass (the mock doesn't set `selectedPartyType` so it falls through to existing behavior)

**Step 4: Commit**

```bash
git add src/components/booking/steps/CheckoutStep.tsx
git commit -m "feat(parties): use selectedPartyType catalog data for checkout pricing"
```

---

### Task 9: Update BookingModal add-on fetch to use category config

**Files:**
- Modify: `src/components/booking/BookingModal.tsx`

Currently add-ons are fetched by `state.eventType.id` (e.g., `birthday`). The mock catalog has modifiers on `party-birthday`, not `birthday`. We need add-ons to come from the category-level catalog item, referenced by `catalogItemId` on `EventTypeConfig`.

**Step 1: Update the add-on fetch useEffect**

Find:
```typescript
fetch(`/api/catalog/add-ons.json?eventTypeId=${state.eventType.id}`)
```

Change to:
```typescript
fetch(`/api/catalog/add-ons.json?eventTypeId=${state.eventType.catalogItemId ?? state.eventType.id}`)
```

This uses the `catalogItemId` (e.g., `party-birthday`) if set, falling back to `id` (e.g., `birthday`).

**Step 2: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: Clean

**Step 3: Commit**

```bash
git add src/components/booking/BookingModal.tsx
git commit -m "fix(parties): use catalogItemId for add-on fetch"
```

---

### Task 10: Final verification and cleanup

**Step 1: Run full TypeScript check**

Run: `npx tsc --noEmit`
Expected: Clean (0 errors)

**Step 2: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

**Step 3: Manual verification checklist**

Run: `npm run dev`

Visit `/book`:
- [ ] See three cards: Kids Party, Adult Party, Corporate Event
- [ ] Click "Kids Party" → modal opens at Date step (step 1)
- [ ] Select a date → advance to Time Slot (step 2)
- [ ] Select a time slot → advance to Party Type (step 3)
- [ ] See 4 kids party cards (Slime, Painting, Pottery, Jewelry)
- [ ] Click "Slime Party" → advance to Details (step 4)
- [ ] Details shows Slime Party name and description
- [ ] Click "Continue" → advance to Customize (step 5)
- [ ] Base price shows $400.00
- [ ] Add-ons load correctly (from Kids Party category)
- [ ] Guest count defaults to 12, max 20
- [ ] Click "Continue to Checkout" → advance to Checkout (step 6)
- [ ] Line item shows "Slime Party" at $400.00
- [ ] Back button works through all steps
- [ ] Progress bar shows correct step labels

**Step 4: Commit any fixes, then push**

```bash
git push origin dev
```
