# Details Steps Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "Details" step to all three booking flows (workshops, programs, parties) using a shared component, and migrate program data from site.config to Square catalog.

**Architecture:** Shared `<DetailsStep>` component renders image, title, metadata pills, and full description. Each flow passes its own tags. Workshops and parties already get data from Square. Programs will be migrated from site.config to Square with custom attributes for schedule, age range, etc.

**Tech Stack:** React, TypeScript, Astro SSR, Square Catalog API

---

## Phase 1: Workshop Details Step

### Task 1: Create shared DetailsStep component

**Files:**
- Create: `src/components/shared/DetailsStep.tsx`
- Test: `tests/components/shared/DetailsStep.test.tsx`

**Step 1: Write the failing test**

```tsx
// tests/components/shared/DetailsStep.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import DetailsStep from '@components/shared/DetailsStep'

describe('DetailsStep', () => {
  const defaultProps = {
    title: 'Hand-Built Pottery',
    description: 'Learn the art of hand-building with clay.\n\nYou will create two pieces.',
    tags: [
      { label: '2 hours' },
      { label: '$65.00' },
      { label: '8 seats left' },
    ],
    onContinue: vi.fn(),
  }

  it('renders title and description', () => {
    render(<DetailsStep {...defaultProps} />)
    expect(screen.getByText('Hand-Built Pottery')).toBeDefined()
    expect(screen.getByText(/Learn the art/)).toBeDefined()
  })

  it('renders all tags', () => {
    render(<DetailsStep {...defaultProps} />)
    expect(screen.getByText('2 hours')).toBeDefined()
    expect(screen.getByText('$65.00')).toBeDefined()
    expect(screen.getByText('8 seats left')).toBeDefined()
  })

  it('renders image when imageUrl is provided', () => {
    render(<DetailsStep {...defaultProps} imageUrl="https://example.com/img.jpg" />)
    const img = screen.getByRole('img')
    expect(img.getAttribute('src')).toBe('https://example.com/img.jpg')
  })

  it('does not render image when imageUrl is not provided', () => {
    render(<DetailsStep {...defaultProps} />)
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('calls onContinue when button is clicked', () => {
    render(<DetailsStep {...defaultProps} />)
    fireEvent.click(screen.getByText('Continue'))
    expect(defaultProps.onContinue).toHaveBeenCalledOnce()
  })

  it('renders custom button text', () => {
    render(<DetailsStep {...defaultProps} buttonText="Select This Party" />)
    expect(screen.getByText('Select This Party')).toBeDefined()
  })

  it('splits description on newlines into paragraphs', () => {
    const { container } = render(<DetailsStep {...defaultProps} />)
    const paragraphs = container.querySelectorAll('[data-testid="description"] p')
    expect(paragraphs.length).toBe(2)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/shared/DetailsStep.test.tsx`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```tsx
// src/components/shared/DetailsStep.tsx
import type { ReactNode } from 'react'

export interface DetailsStepProps {
  imageUrl?: string
  title: string
  description: string
  tags: { icon?: ReactNode; label: string }[]
  buttonText?: string
  onContinue: () => void
}

export default function DetailsStep({
  imageUrl,
  title,
  description,
  tags,
  buttonText = 'Continue',
  onContinue,
}: DetailsStepProps) {
  const paragraphs = description.split(/\n\n|\n/).filter(Boolean)

  return (
    <div>
      {imageUrl && (
        <img
          src={imageUrl}
          alt={title}
          style={{
            width: '100%',
            height: '14rem',
            objectFit: 'cover',
            borderRadius: '0.75rem',
            marginBottom: '1.25rem',
          }}
        />
      )}

      <h3
        style={{
          fontSize: '1.25rem',
          fontFamily: 'var(--font-heading)',
          fontWeight: 700,
          color: 'var(--color-dark, #3d3229)',
          marginBottom: '0.75rem',
        }}
      >
        {title}
      </h3>

      {tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
          {tags.map((tag, i) => (
            <span
              key={i}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.375rem',
                fontSize: '0.75rem',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                padding: '0.375rem 0.75rem',
                borderRadius: '9999px',
                background: 'rgba(150, 112, 91, 0.08)',
                color: 'var(--color-primary)',
              }}
            >
              {tag.icon}
              {tag.label}
            </span>
          ))}
        </div>
      )}

      <div
        data-testid="description"
        style={{ fontSize: '0.875rem', lineHeight: 1.7, color: 'var(--color-muted)', marginBottom: '1.5rem' }}
      >
        {paragraphs.map((p, i) => (
          <p key={i} style={{ marginBottom: i < paragraphs.length - 1 ? '0.75rem' : 0 }}>
            {p}
          </p>
        ))}
      </div>

      <button
        type="button"
        onClick={onContinue}
        style={{
          display: 'block',
          width: '100%',
          textAlign: 'center',
          borderRadius: '0.75rem',
          padding: '0.875rem 1.5rem',
          color: 'white',
          fontWeight: 600,
          fontSize: '0.875rem',
          background: 'linear-gradient(135deg, var(--color-primary), var(--color-accent))',
          boxShadow: '0 4px 15px rgba(150, 112, 91, 0.2)',
          border: 'none',
          cursor: 'pointer',
          transition: 'all 0.3s ease',
        }}
      >
        {buttonText}
      </button>
    </div>
  )
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/shared/DetailsStep.test.tsx`
Expected: PASS — all 7 tests

**Step 5: Commit**

```bash
git add src/components/shared/DetailsStep.tsx tests/components/shared/DetailsStep.test.tsx
git commit -m "feat: add shared DetailsStep component for booking modals"
```

---

### Task 2: Add imageUrl to WorkshopData and pass through enrichment

**Files:**
- Modify: `src/components/workshops/WorkshopExplorer.tsx` (lines 6-18, WorkshopData interface)
- Modify: `src/pages/workshops.astro` (lines 26-49, enrichment loop)

**Step 1: Add imageUrl to WorkshopData interface**

In `src/components/workshops/WorkshopExplorer.tsx`, add `imageUrl?: string` to the WorkshopData interface after `category`:

```typescript
export interface WorkshopData {
  id: string
  name: string
  description: string
  category: string
  imageUrl?: string  // NEW
  date: string
  startTime: string
  endTime: string
  duration: number
  price: number
  currency: string
  remainingSeats: number | null
}
```

**Step 2: Pass imageUrl through in workshops.astro enrichment**

In `src/pages/workshops.astro`, in the enrichment loop where WorkshopData objects are created, add `imageUrl: et.imageUrl` to the object being built.

**Step 3: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: Clean (imageUrl is optional, so existing code won't break)

**Step 4: Commit**

```bash
git add src/components/workshops/WorkshopExplorer.tsx src/pages/workshops.astro
git commit -m "feat: add imageUrl to WorkshopData for details step"
```

---

### Task 3: Add DetailsStep to WorkshopBookingModal

**Files:**
- Modify: `src/components/workshops/WorkshopBookingModal.tsx`

The modal currently has 3 steps (0=Details+Seats, 1=Contact, 2=Payment). We need to split step 0 into a proper DetailsStep (step 0) and move the existing seat picker to step 1.

**Step 1: Update step labels**

Change line 14 from:
```typescript
const STEP_LABELS = ['Details', 'Your Info', 'Payment']
```
to:
```typescript
const STEP_LABELS = ['Details', 'Seats', 'Your Info', 'Payment']
```

**Step 2: Import DetailsStep and add it as step 0**

Import the shared component:
```typescript
import DetailsStep from '@components/shared/DetailsStep'
```

In the step rendering switch:
- Case 0: Render `<DetailsStep>` with workshop data, tags for duration/price/seats, `onContinue={() => setStep(1)}`
- Case 1: The existing seat picker (was case 0)
- Case 2: Contact info (was case 1)
- Case 3: Payment (was case 2)

**Step 3: Build the tags array for workshops**

```typescript
function formatPrice(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
}

const detailsTags = [
  { label: `${workshop.duration} min` },
  { label: `${formatPrice(workshop.price)} / seat` },
  ...(workshop.remainingSeats !== null ? [{ label: `${workshop.remainingSeats} seats left` }] : []),
]
```

**Step 4: Renumber all step references**

Update the step state initialization, back button, and any step-specific logic to account for the new step 0. The existing seat picker code moves from step 0 to step 1.

**Step 5: Run tests and TypeScript**

Run: `npx tsc --noEmit && npx vitest run`
Expected: Clean

**Step 6: Commit**

```bash
git add src/components/workshops/WorkshopBookingModal.tsx
git commit -m "feat(workshops): add details step as first step in booking modal"
```

---

## Phase 2: Program Migration to Square

### Task 4: Extend EventType and EventVariation interfaces

**Files:**
- Modify: `src/providers/interfaces/catalog.ts` (lines 1-26)

**Step 1: Add program-specific fields to EventType**

After `baseCapacity?: number` (line 11), add:

```typescript
  allowExtraGuests?: boolean
  extraGuestPrice?: number
  allowAddOns?: boolean
  enrollmentType?: 'per-session' | 'full'
  ageRange?: { min: number; max: number }
  schedule?: { days: string; time: string; totalHours: number }
  instructorEmail?: string
  pricePerHead?: number
  maxCapacity?: number
```

**Step 2: Add date fields to EventVariation**

After `priceCurrency: string` (line 18), add:

```typescript
  startDate?: string
  endDate?: string
```

**Step 3: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: Clean (all new fields are optional)

**Step 4: Commit**

```bash
git add src/providers/interfaces/catalog.ts
git commit -m "feat: extend EventType with program-specific fields and variation dates"
```

---

### Task 5: Update Square catalog provider to map new fields

**Files:**
- Modify: `src/providers/square/catalog.ts` (lines 71-126, mapping section)

**Step 1: Map custom attributes for program fields**

After the existing `flow` custom attribute extraction (lines 98-99), add mapping for the new fields:

```typescript
const customAttrs = itemData.customAttributeValues ?? {}
const enrollmentType = customAttrs.enrollmentType?.stringValue as 'per-session' | 'full' | undefined
const ageMin = customAttrs.ageMin?.numberValue ? Number(customAttrs.ageMin.numberValue) : undefined
const ageMax = customAttrs.ageMax?.numberValue ? Number(customAttrs.ageMax.numberValue) : undefined
const scheduleDays = customAttrs.scheduleDays?.stringValue
const scheduleTime = customAttrs.scheduleTime?.stringValue
const totalHours = customAttrs.totalHours?.numberValue ? Number(customAttrs.totalHours.numberValue) : undefined
const instructorEmail = customAttrs.instructorEmail?.stringValue
const pricePerHead = customAttrs.pricePerHead?.numberValue ? Number(customAttrs.pricePerHead.numberValue) : undefined
const maxCapacity = customAttrs.maxCapacity?.numberValue ? Number(customAttrs.maxCapacity.numberValue) : undefined
```

**Step 2: Add variation date mapping**

In the variations mapping loop (lines 71-79), add:

```typescript
startDate: varData.customAttributeValues?.startDate?.stringValue,
endDate: varData.customAttributeValues?.endDate?.stringValue,
```

**Step 3: Include new fields in returned EventType object**

Add to the returned object:
```typescript
...(enrollmentType && { enrollmentType }),
...(ageMin !== undefined && ageMax !== undefined && { ageRange: { min: ageMin, max: ageMax } }),
...(scheduleDays && scheduleTime && { schedule: { days: scheduleDays, time: scheduleTime, totalHours: totalHours ?? 0 } }),
...(instructorEmail && { instructorEmail }),
...(pricePerHead !== undefined && { pricePerHead }),
...(maxCapacity !== undefined && { maxCapacity }),
```

**Step 4: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: Clean

**Step 5: Commit**

```bash
git add src/providers/square/catalog.ts
git commit -m "feat: map program custom attributes in Square catalog provider"
```

---

### Task 6: Update mock data with program-specific fields

**Files:**
- Modify: `src/providers/mock/data.ts` (program entries around lines 109-140)

**Step 1: Add program fields to mock data**

Update each program entry in `mockEventTypes` to include the new fields. Example for summer-camp:

```typescript
{
  id: 'summer-camp',
  name: 'Summer Art Camp',
  description: 'A week of creative exploration for kids ages 6-12. Each day features a different art medium including pottery, painting, printmaking, and mixed media. Kids will create portfolio-worthy pieces while learning fundamental art techniques.\n\nWhat to bring: Smock or old clothes, water bottle, nut-free snack.\nWhat to wear: Comfortable clothes that can get messy.',
  category: 'program',
  duration: 210,
  baseCapacity: 12,
  flow: 'booking' as const,
  enrollmentType: 'per-session' as const,
  ageRange: { min: 6, max: 12 },
  schedule: { days: 'Mon–Thu', time: '9:00 AM – 12:30 PM', totalHours: 3.5 },
  pricePerHead: 22500,
  maxCapacity: 12,
  instructorEmail: 'instructor@homegrowncraftstudio.com',
  variations: [
    { id: 'summer-wk1', name: 'Week 1 (Jun 8-11)', priceAmount: 22500, priceCurrency: 'USD', startDate: '2026-06-08', endDate: '2026-06-11' },
    { id: 'summer-wk2', name: 'Week 2 (Jun 15-18)', priceAmount: 22500, priceCurrency: 'USD', startDate: '2026-06-15', endDate: '2026-06-18' },
    { id: 'summer-wk3', name: 'Week 3 (Jun 22-25)', priceAmount: 22500, priceCurrency: 'USD', startDate: '2026-06-22', endDate: '2026-06-25' },
    { id: 'summer-wk4', name: 'Week 4 (Jun 29-Jul 2)', priceAmount: 22500, priceCurrency: 'USD', startDate: '2026-06-29', endDate: '2026-07-02' },
  ],
  modifiers: [],
}
```

Apply similar updates to homeschool-spring and winter-break-camp entries.

**Step 2: Run tests**

Run: `npx vitest run`
Expected: All pass (new fields are additive)

**Step 3: Commit**

```bash
git add src/providers/mock/data.ts
git commit -m "feat: add program-specific fields to mock catalog data"
```

---

### Task 7: Update programs page to fetch from catalog API

**Files:**
- Modify: `src/pages/programs.astro`
- Modify: `src/components/programs/ProgramCard.tsx`

**Step 1: Update programs.astro**

Replace the site.config-based program loading with a catalog API fetch:

```astro
---
import { getProviders } from '../providers'
const providers = getProviders()
const programs = await providers.catalog.getEventTypes({ category: 'program' })
---
```

Pass `programs` (EventType[]) to the page content instead of `siteConfig.features.programs.types`.

**Step 2: Update ProgramCard to accept EventType**

ProgramCard currently accepts `ProgramConfig`. Update it to accept `EventType` (which now has the program fields). Map the relevant fields:

- `program.name` → title
- `program.description` → truncated description
- `program.ageRange` → age badge
- `program.schedule` → schedule display
- `program.pricePerHead` → price display
- `program.variations` → session count
- `program.imageUrl` → card image (if available)

**Step 3: Run TypeScript and tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: May need to update ProgramCard tests for new prop shape

**Step 4: Commit**

```bash
git add src/pages/programs.astro src/components/programs/ProgramCard.tsx
git commit -m "feat(programs): fetch from catalog API instead of site.config"
```

---

### Task 8: Update EnrollmentContext and EnrollmentModal to use EventType

**Files:**
- Modify: `src/components/programs/EnrollmentContext.tsx`
- Modify: `src/components/programs/EnrollmentModal.tsx`

**Step 1: Update EnrollmentState to use EventType**

Change `program: ProgramConfig` to `program: EventType` in the state interface. Map the fields that the enrollment flow needs:

- `program.enrollmentType` → determines if session select step shows
- `program.variations` → sessions (with startDate/endDate)
- `program.pricePerHead` → price calculation
- `program.maxCapacity` → headcount limit

**Step 2: Update EnrollmentModal step labels**

The `getStepLabels` function currently takes `ProgramConfig`. Update to use `EventType`:

```typescript
function getStepLabels(program: EventType, headcount: number): string[] {
  const labels: string[] = ['Details']  // NEW first step
  if (program.enrollmentType === 'per-session') {
    labels.push('Select Sessions')
  }
  labels.push('Headcount')
  for (let i = 0; i < headcount; i++) {
    labels.push(`Child ${i + 1}`)
  }
  labels.push('Parent Info')
  labels.push('Payment')
  labels.push('Confirmation')
  return labels
}
```

**Step 3: Add DetailsStep as step 0 in EnrollmentModal**

Import DetailsStep and render it at step 0:

```tsx
import DetailsStep from '@components/shared/DetailsStep'

// In the step rendering:
if (state.currentStep === 0) {
  return (
    <DetailsStep
      imageUrl={state.program.imageUrl}
      title={state.program.name}
      description={state.program.description}
      tags={[
        ...(state.program.ageRange ? [{ label: `Ages ${state.program.ageRange.min}–${state.program.ageRange.max}` }] : []),
        ...(state.program.schedule ? [{ label: state.program.schedule.days }, { label: state.program.schedule.time }] : []),
        { label: `${state.program.variations.length} session${state.program.variations.length !== 1 ? 's' : ''}` },
        ...(state.program.pricePerHead ? [{ label: `${formatPrice(state.program.pricePerHead)} / child` }] : []),
      ]}
      onContinue={() => dispatch({ type: 'NEXT_STEP' })}
    />
  )
}
```

**Step 4: Shift remaining step indices**

All subsequent steps increment by 1 since details is now step 0. Update the step rendering switch accordingly.

**Step 5: Run TypeScript and tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: Tests may need updates for new step numbering and EventType shape

**Step 6: Commit**

```bash
git add src/components/programs/EnrollmentContext.tsx src/components/programs/EnrollmentModal.tsx
git commit -m "feat(programs): migrate to EventType and add details step"
```

---

## Phase 3: Party Details Step

### Task 9: Add DetailsStep to BookingModal

**Files:**
- Modify: `src/components/booking/BookingModal.tsx`

**Step 1: Update step labels**

Change line 15 from:
```typescript
const MODAL_STEP_LABELS = ['Date', 'Time Slot', 'Customize', 'Checkout']
```
to:
```typescript
const MODAL_STEP_LABELS = ['Details', 'Date', 'Time Slot', 'Customize', 'Checkout']
```

**Step 2: Import DetailsStep and add as step 1**

Import:
```typescript
import DetailsStep from '@components/shared/DetailsStep'
```

The modal currently maps `state.currentStep` (1-based from WizardContext) to modal steps. `SET_EVENT_TYPE` sets `currentStep: 1`. Now step 1 = details instead of date selection.

Update the step rendering switch:
- Case 1: `<DetailsStep>` with party type info, `buttonText="Select This Party"`, `onContinue={() => dispatch({ type: 'GO_TO_STEP', payload: 2 })}`
- Case 2: DateSelectionStep (was case 1)
- Case 3: AvailableSlotsStep (was case 2)
- Case 4: CustomizeStep (was case 3)
- Case 5: CheckoutStep/InquiryStep (was case 4)

Tags for parties:
```typescript
const detailsTags = [
  { label: `${state.eventType.duration} min` },
  ...(state.eventType.baseCapacity ? [{ label: `Up to ${state.eventType.baseCapacity} guests` }] : []),
  { label: formatPrice(state.eventType.variations[0]?.priceAmount ?? 0) },
]
```

**Step 3: Update back button behavior**

In `handleBack` (line 87), the existing logic already handles this:
```typescript
if (state.currentStep <= 1) {
  onClose()  // Step 1 (details) back = close modal, return to card grid
}
```

This is exactly what we want — back on the details step closes the modal so the user can browse other party types.

**Step 4: Update step label count and progress calculation**

The `modalStep` calculation (`state.currentStep - 1`) and progress bar work automatically since we just added an entry to `MODAL_STEP_LABELS`.

**Step 5: Run TypeScript and tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: Clean

**Step 6: Commit**

```bash
git add src/components/booking/BookingModal.tsx
git commit -m "feat(parties): add details step after party type selection"
```

---

### Task 10: Add imageUrl to EventTypeStep cards (party landing)

**Files:**
- Modify: `src/components/booking/steps/EventTypeStep.tsx`

The party cards on the landing page currently don't show images. Now that EventType has `imageUrl` from Square, show a small image on the card if available.

**Step 1: Update EventTypeStep card rendering**

Add an optional image at the top of each card:

```tsx
{eventType.imageUrl && (
  <img
    src={eventType.imageUrl}
    alt={eventType.name}
    style={{
      width: '100%',
      height: '8rem',
      objectFit: 'cover',
      borderRadius: '0.75rem 0.75rem 0 0',
    }}
  />
)}
```

**Step 2: Run TypeScript and tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: Clean

**Step 3: Commit**

```bash
git add src/components/booking/steps/EventTypeStep.tsx
git commit -m "feat(parties): show images on event type cards when available"
```

---

### Task 11: Final verification and push

**Step 1: Full test suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: All tests pass, no type errors

**Step 2: Local dev check**

Run: `npm run dev`
Verify:
- `/workshops` → click Book Seat → modal shows details step first → continue to seats → contact → payment
- `/programs` → click Enroll Now → modal shows details step first (age, schedule, sessions) → continue to session select → headcount → etc.
- `/book` → click party card → modal shows details step with full description → "Select This Party" → date → slot → customize → checkout
- All three details steps show images when available
- Back button on details step in parties closes modal (returns to card grid)
- Back button on details step in workshops/programs also works correctly

**Step 3: Push**

```bash
git push origin dev && git push origin dev:main
```
