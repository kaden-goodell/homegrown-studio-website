# Details Steps + Program Square Migration Design

**Date:** 2026-03-02
**Status:** Approved

## Summary

Add a "Details" step to all three booking flows (workshops, programs, parties), showing full descriptions, images, and metadata pulled from Square catalog. Migrate program data from hardcoded site.config to Square catalog with custom attributes.

## Phase 1: Workshop Details Step

### Shared `<DetailsStep>` Component

Reusable component for all flows. Layout: image at top (if available), title, metadata pills, full description, continue button.

**Props:**
- `imageUrl?: string` — hero image, full width rounded
- `title: string`
- `description: string` — rendered with paragraph breaks
- `tags: { icon?: ReactNode; label: string }[]` — pill badges (duration, price, seats, etc.)
- `buttonText?: string` — defaults to "Continue"
- `onContinue: () => void`

### WorkshopBookingModal Step Changes

| Step | Component |
|------|-----------|
| 0 | DetailsStep (NEW) |
| 1 | Seats (existing picker) |
| 2 | Contact Info (existing) |
| 3 | Payment (existing) |

### Data: Add `imageUrl` to WorkshopData

WorkshopData gets `imageUrl?: string` field. Already available on EventType from Square — just needs to be passed through during the enrichment step in workshops.astro.

## Phase 2: Program Migration to Square

### Square Custom Attributes

New custom attributes on catalog items with `category: 'program'`:

| Attribute | Type | Example |
|-----------|------|---------|
| `enrollmentType` | string | `'per-session'` or `'full'` |
| `ageMin` | number | `6` |
| `ageMax` | number | `12` |
| `scheduleDays` | string | `'Mon–Thu'` |
| `scheduleTime` | string | `'9:00 AM – 12:30 PM'` |
| `totalHours` | number | `3.5` |
| `instructorEmail` | string | `'instructor@...'` |
| `pricePerHead` | number | `22500` (cents) |
| `maxCapacity` | number | `12` |

Sessions = Square variations. Each variation gets `startDate` and `endDate` custom attributes.

### Extended EventType Interface

```typescript
EventType {
  ...existing fields...
  enrollmentType?: 'per-session' | 'full'
  ageRange?: { min: number; max: number }
  schedule?: { days: string; time: string; totalHours: number }
  instructorEmail?: string
  pricePerHead?: number
  maxCapacity?: number
}

EventVariation {
  ...existing fields...
  startDate?: string
  endDate?: string
}
```

### Provider Changes

- Square catalog provider maps new custom attributes when present
- Mock provider updated with new fields in mock data
- Existing `getEventTypes({ category: 'program' })` endpoint serves programs

### Page & Component Changes

- `programs.astro` fetches from API instead of site.config
- `ProgramCard` renders from EventType instead of ProgramConfig
- `EnrollmentContext` accepts EventType, maps new fields
- `ProgramConfig` in site.config deprecated

### EnrollmentModal Step Changes

| Step | Component |
|------|-----------|
| 0 | DetailsStep (NEW — age/schedule/session tags) |
| 1 | Session Select (per-session programs) |
| 2 | Headcount |
| 3 | Child Intake (per child) |
| 4 | Parent Info |
| 5 | Payment |
| 6 | Confirmation |

## Phase 3: Party Type Details Step

### UX Pattern

Unlike workshops and programs (where details is the first modal step), party details uses progressive disclosure *within* the modal. The user picks a party type from cards on the landing page, the modal opens, and the **first step shows full details** for that party type. The back button on this step closes the modal so the user can browse other party types.

This avoids overloading the card grid with full details for 10+ party options.

### BookingModal Step Changes

| Step | Component | Notes |
|------|-----------|-------|
| 0 (landing) | EventTypeStep cards | User picks party type, modal opens |
| 1 | **DetailsStep** (NEW) | Full description, image, what to bring/wear. "Select This Party" CTA. Back button closes modal to return to card grid. |
| 2 | DateSelectionStep (was 1) | |
| 3 | AvailableSlotsStep (was 2) | |
| 4 | CustomizeStep (was 3) | |
| 5 | CheckoutStep/InquiryStep (was 4) | |

### Data Source

Same as workshops — Square `description` field (4096 chars) and `imageUrl` from EventType. Party EventTypes already flow through the catalog provider.

### Back Button Behavior

- Step 1 (details): Back closes modal, returns to card grid (user can pick a different party type)
- Step 2+: Back goes to previous modal step (normal behavior)

### Implementation

- Reuses the shared `<DetailsStep>` component from Phase 1
- Tags show: duration, base capacity, price, flow type (booking vs quote)
- `buttonText` = "Select This Party"
- BookingModal renumbers steps (1→2, 2→3, 3→4, 4→5) and adds DetailsStep as step 1
- WizardContext `SET_EVENT_TYPE` still sets `currentStep: 1` — now that's the details step instead of date selection

## Out of Scope

- Programmatic Square custom attribute creation (manual dashboard setup)
- Image upload to Square (manual)

## Decisions

- Single description field in Square (4096 chars) — truncated on cards, full in modal
- Image + text stacked layout in 40rem modal
- Phased rollout: workshops first (low risk), then program migration, then parties
- Programs fully migrate to Square as source of truth
- Party details step uses same shared component but with different back button behavior (closes modal vs previous step)
