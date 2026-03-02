# Programs Feature Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Programs page with enrollment modal for multi-session offerings (summer camps, homeschool days, winter camps) — per-head pricing, child intake forms, Square payment, and nightly roster emails.

**Architecture:** Programs are configured in site.config.ts and modeled as Square Catalog Items (one variation per session). Enrollment creates a Square Order. A nightly Netlify Scheduled Function emails rosters via Resend and pings Slack. The UI is an Astro page with React enrollment modal matching existing glassmorphism aesthetic.

**Tech Stack:** Astro, React, TypeScript, Square (Catalog + Orders + Payments), Resend (email), Netlify Scheduled Functions, Vitest

---

## Task 1: Config Types & Site Config

**Files:**
- Modify: `src/config/site.config.ts`

**Step 1: Add ProgramConfig and ProgramSessionConfig types**

Add after the `EventTypeConfig` interface (~line 30):

```typescript
export interface ProgramSessionConfig {
  id: string
  name: string                        // "Week 1" or "Spring Semester"
  startDate: string                   // "2026-06-02"
  endDate: string                     // "2026-06-05"
  catalogVariationId?: string
}

export interface ProgramConfig {
  id: string
  name: string                        // "Summer Art Camp"
  description: string
  image?: string
  enrollmentType: 'per-session' | 'full'
  pricePerHead: number                // cents
  maxCapacity: number
  ageRange?: { min: number; max: number }
  schedule: {
    days: string                      // "Mon-Thu"
    time: string                      // "9:00 AM - 12:30 PM"
    totalHours: number
  }
  sessions: ProgramSessionConfig[]
  catalogItemId?: string
  instructorEmail: string
}
```

**Step 2: Add programs to features type and config**

In the `SiteConfig` interface, add to `features`:
```typescript
programs: {
  enabled: boolean
  types: ProgramConfig[]
}
```

In the actual config object's `features`, add:
```typescript
programs: {
  enabled: true,
  types: [],  // will be populated in Task 2
},
```

**Step 3: Add Programs to nav**

In the `nav` array, add between Workshops and Book a Party:
```typescript
{ label: 'Programs', href: '/programs' },
```

**Step 4: Add email config to site config**

Add to the config object:
```typescript
email: {
  fromAddress: 'hello@homegrowncraftstudio.com',
  fromName: 'Homegrown Craft Studio',
},
```

Add to the `SiteConfig` interface:
```typescript
email?: {
  fromAddress: string
  fromName: string
}
```

**Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: Clean (no errors)

**Step 6: Commit**

```bash
git add src/config/site.config.ts
git commit -m "feat(programs): add config types and nav link"
```

---

## Task 2: Mock Program Data

**Files:**
- Modify: `src/config/site.config.ts` (populate program types)
- Modify: `src/providers/mock/data.ts` (add program event types to catalog)

**Step 1: Add sample programs to site config**

In the `programs.types` array:

```typescript
programs: {
  enabled: true,
  types: [
    {
      id: 'summer-camp',
      name: 'Summer Art Camp',
      description: 'A week of creative exploration — painting, pottery, mixed media, and more. Kids build skills and confidence while making friends in a supportive studio environment.',
      enrollmentType: 'per-session',
      pricePerHead: 22500, // $225/child/week
      maxCapacity: 12,
      ageRange: { min: 6, max: 12 },
      schedule: {
        days: 'Mon–Thu',
        time: '9:00 AM – 12:30 PM',
        totalHours: 3.5,
      },
      sessions: [
        { id: 'summer-wk1', name: 'Week 1', startDate: '2026-06-08', endDate: '2026-06-11' },
        { id: 'summer-wk2', name: 'Week 2', startDate: '2026-06-15', endDate: '2026-06-18' },
        { id: 'summer-wk3', name: 'Week 3', startDate: '2026-06-22', endDate: '2026-06-25' },
        { id: 'summer-wk4', name: 'Week 4', startDate: '2026-06-29', endDate: '2026-07-02' },
      ],
      instructorEmail: 'instructor@homegrowncraftstudio.com',
    },
    {
      id: 'homeschool-spring',
      name: 'Homeschool Studio Days',
      description: 'A full semester of weekly art enrichment for homeschool families. Each Thursday brings a new medium and project — from watercolor to weaving.',
      enrollmentType: 'full',
      pricePerHead: 45000, // $450/child/semester
      maxCapacity: 10,
      ageRange: { min: 5, max: 14 },
      schedule: {
        days: 'Every Thursday',
        time: '10:00 AM – 1:00 PM',
        totalHours: 3,
      },
      sessions: [
        { id: 'homeschool-spring-26', name: 'Spring 2026 Semester', startDate: '2026-03-05', endDate: '2026-05-21' },
      ],
      instructorEmail: 'instructor@homegrowncraftstudio.com',
    },
    {
      id: 'winter-break-camp',
      name: 'Winter Break Camp',
      description: 'Creative fun while school is out. Kids stay busy with holiday crafts, ceramics, and collaborative art projects.',
      enrollmentType: 'per-session',
      pricePerHead: 17500, // $175/child/week
      maxCapacity: 12,
      ageRange: { min: 5, max: 12 },
      schedule: {
        days: 'Mon–Fri',
        time: '9:00 AM – 12:00 PM',
        totalHours: 3,
      },
      sessions: [
        { id: 'winter-wk1', name: 'Week 1', startDate: '2026-12-21', endDate: '2026-12-24' },
        { id: 'winter-wk2', name: 'Week 2', startDate: '2026-12-28', endDate: '2026-12-31' },
      ],
      instructorEmail: 'instructor@homegrowncraftstudio.com',
    },
  ],
},
```

**Step 2: Add program event types to mock catalog data**

In `src/providers/mock/data.ts`, add to the `mockEventTypes` array:

```typescript
// Programs
{
  id: 'summer-camp',
  name: 'Summer Art Camp',
  description: 'A week of creative exploration',
  category: 'program',
  duration: 210, // 3.5 hours
  baseCapacity: 12,
  flow: 'booking' as const,
  variations: [
    { id: 'summer-wk1', name: 'Week 1 (Jun 8-11)', priceAmount: 22500, priceCurrency: 'USD' },
    { id: 'summer-wk2', name: 'Week 2 (Jun 15-18)', priceAmount: 22500, priceCurrency: 'USD' },
    { id: 'summer-wk3', name: 'Week 3 (Jun 22-25)', priceAmount: 22500, priceCurrency: 'USD' },
    { id: 'summer-wk4', name: 'Week 4 (Jun 29-Jul 2)', priceAmount: 22500, priceCurrency: 'USD' },
  ],
  modifiers: [],
},
{
  id: 'homeschool-spring',
  name: 'Homeschool Studio Days',
  description: 'Weekly art enrichment for homeschool families',
  category: 'program',
  duration: 180, // 3 hours
  baseCapacity: 10,
  flow: 'booking' as const,
  variations: [
    { id: 'homeschool-spring-26', name: 'Spring 2026 Semester', priceAmount: 45000, priceCurrency: 'USD' },
  ],
  modifiers: [],
},
{
  id: 'winter-break-camp',
  name: 'Winter Break Camp',
  description: 'Creative fun while school is out',
  category: 'program',
  duration: 180,
  baseCapacity: 12,
  flow: 'booking' as const,
  variations: [
    { id: 'winter-wk1', name: 'Week 1 (Dec 21-24)', priceAmount: 17500, priceCurrency: 'USD' },
    { id: 'winter-wk2', name: 'Week 2 (Dec 28-31)', priceAmount: 17500, priceCurrency: 'USD' },
  ],
  modifiers: [],
},
```

**Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: Clean

**Step 4: Commit**

```bash
git add src/config/site.config.ts src/providers/mock/data.ts
git commit -m "feat(programs): add sample program data and mock catalog entries"
```

---

## Task 3: Programs Page

**Files:**
- Create: `src/pages/programs.astro`

**Step 1: Create the programs page**

```astro
---
export const prerender = true

import Layout from '@layouts/StaticLayout.astro'
import { siteConfig } from '@config/site.config'
import ProgramExplorer from '@components/programs/ProgramExplorer'

const programs = siteConfig.features.programs.types
---

<Layout title="Programs" description="Multi-session camps, classes, and creative programs for kids">
  {siteConfig.features.programs.enabled && programs.length > 0 ? (
    <section class="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-28">
      <div class="text-center mb-16 fade-in">
        <p class="uppercase tracking-[0.2em] text-xs font-semibold mb-3" style="color: var(--color-accent);">Enroll Now</p>
        <h1 class="text-4xl sm:text-5xl lg:text-6xl font-heading font-bold" style="color: var(--color-dark);">Programs</h1>
        <p class="text-lg mt-4 max-w-xl mx-auto" style="color: var(--color-muted);">
          Camps, classes, and creative experiences that run for days or weeks at a time
        </p>
      </div>
      <ProgramExplorer client:load programs={programs} />
    </section>
  ) : (
    <section class="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20 text-center">
      <h1 class="text-4xl font-heading font-bold mb-4">Programs</h1>
      <p class="text-lg" style="color: var(--color-muted);">No programs available at this time.</p>
    </section>
  )}
</Layout>
```

**Step 2: Verify the page loads**

Run: `npm run dev` and navigate to `http://localhost:4321/programs`
Expected: Page renders with header (will show nothing below it since ProgramExplorer doesn't exist yet — that's fine, we just want no crash)

**Step 3: Commit**

```bash
git add src/pages/programs.astro
git commit -m "feat(programs): add programs page skeleton"
```

---

## Task 4: ProgramCard Component

**Files:**
- Create: `src/components/programs/ProgramCard.tsx`

**Step 1: Create the ProgramCard component**

This matches the white glassmorphism pattern from WorkshopCard and other inner-page cards.

```tsx
import type { ProgramConfig } from '@config/site.config'

interface ProgramCardProps {
  program: ProgramConfig
  onEnroll: (program: ProgramConfig) => void
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(0)}`
}

function formatAgeRange(range?: { min: number; max: number }): string | null {
  if (!range) return null
  return `Ages ${range.min}–${range.max}`
}

export default function ProgramCard({ program, onEnroll }: ProgramCardProps) {
  const priceLabel = program.enrollmentType === 'per-session'
    ? `${formatPrice(program.pricePerHead)} / child / session`
    : `${formatPrice(program.pricePerHead)} / child`

  const sessionSummary = program.enrollmentType === 'per-session'
    ? `${program.sessions.length} sessions available`
    : program.sessions[0]?.name ?? ''

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        padding: '2rem',
        background: 'linear-gradient(135deg, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0.35) 50%, rgba(255,255,255,0.5) 100%)',
        backdropFilter: 'blur(20px) saturate(1.3)',
        WebkitBackdropFilter: 'blur(20px) saturate(1.3)',
        border: '1px solid rgba(255, 255, 255, 0.5)',
        borderRadius: '1rem',
        boxShadow: '0 4px 16px rgba(150, 112, 91, 0.08), 0 10px 40px rgba(150, 112, 91, 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.7), inset 0 -1px 0 rgba(150, 112, 91, 0.04)',
        transition: 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-4px) scale(1.01)'
        e.currentTarget.style.boxShadow = '0 20px 40px rgba(150, 112, 91, 0.12)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'none'
        e.currentTarget.style.boxShadow = '0 4px 16px rgba(150, 112, 91, 0.08), 0 10px 40px rgba(150, 112, 91, 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.7), inset 0 -1px 0 rgba(150, 112, 91, 0.04)'
      }}
    >
      {/* Schedule badge */}
      <span style={{
        fontSize: '0.6875rem',
        fontWeight: 500,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color: 'var(--color-primary)',
        marginBottom: '0.75rem',
      }}>
        {program.schedule.days} &middot; {program.schedule.time}
      </span>

      {/* Title */}
      <h3 style={{
        fontSize: '1.25rem',
        fontWeight: 600,
        fontFamily: 'var(--font-heading)',
        color: 'var(--color-dark)',
        margin: '0 0 0.5rem 0',
        lineHeight: 1.2,
      }}>
        {program.name}
      </h3>

      {/* Age range */}
      {program.ageRange && (
        <span style={{
          fontSize: '0.75rem',
          color: 'var(--color-muted)',
          marginBottom: '0.625rem',
        }}>
          {formatAgeRange(program.ageRange)}
        </span>
      )}

      {/* Description */}
      <p style={{
        fontSize: '0.875rem',
        lineHeight: 1.6,
        color: 'var(--color-muted)',
        margin: '0 0 1rem 0',
        flex: 1,
      }}>
        {program.description}
      </p>

      {/* Session count + price */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginBottom: '1.25rem',
        paddingTop: '0.75rem',
        borderTop: '1px solid rgba(150, 112, 91, 0.08)',
      }}>
        <span style={{ fontSize: '0.8125rem', color: 'var(--color-muted)' }}>
          {sessionSummary}
        </span>
        <span style={{
          fontSize: '0.9375rem',
          fontWeight: 600,
          color: 'var(--color-dark)',
        }}>
          {priceLabel}
        </span>
      </div>

      {/* Enroll button */}
      <button
        type="button"
        onClick={() => onEnroll(program)}
        style={{
          width: '100%',
          padding: '0.875rem',
          background: 'var(--color-primary)',
          color: '#fff',
          border: 'none',
          borderRadius: '0.75rem',
          fontSize: '0.875rem',
          fontWeight: 600,
          cursor: 'pointer',
          transition: 'filter 0.3s ease, transform 0.3s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.filter = 'brightness(0.9)'
          e.currentTarget.style.transform = 'translateY(-1px)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.filter = 'none'
          e.currentTarget.style.transform = 'none'
        }}
      >
        Enroll Now
      </button>
    </div>
  )
}
```

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: Clean

**Step 3: Commit**

```bash
git add src/components/programs/ProgramCard.tsx
git commit -m "feat(programs): add ProgramCard component"
```

---

## Task 5: ProgramExplorer Component

**Files:**
- Create: `src/components/programs/ProgramExplorer.tsx`

**Step 1: Create the ProgramExplorer**

This is the container that renders program cards and manages the enrollment modal state.

```tsx
import { useState } from 'react'
import type { ProgramConfig } from '@config/site.config'
import ProgramCard from './ProgramCard'
import EnrollmentModal from './EnrollmentModal'

interface ProgramExplorerProps {
  programs: ProgramConfig[]
}

export default function ProgramExplorer({ programs }: ProgramExplorerProps) {
  const [selectedProgram, setSelectedProgram] = useState<ProgramConfig | null>(null)

  return (
    <>
      <div style={{
        display: 'grid',
        gap: '1.5rem',
        gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
      }}>
        {programs.map((program) => (
          <ProgramCard
            key={program.id}
            program={program}
            onEnroll={setSelectedProgram}
          />
        ))}
      </div>

      {selectedProgram && (
        <EnrollmentModal
          program={selectedProgram}
          onClose={() => setSelectedProgram(null)}
        />
      )}
    </>
  )
}
```

**Step 2: Create a placeholder EnrollmentModal**

Create `src/components/programs/EnrollmentModal.tsx` as a minimal placeholder (we'll build it out in Tasks 6-8):

```tsx
import type { ProgramConfig } from '@config/site.config'

interface EnrollmentModalProps {
  program: ProgramConfig
  onClose: () => void
}

export default function EnrollmentModal({ program, onClose }: EnrollmentModalProps) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.4)',
        backdropFilter: 'blur(4px)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '40rem',
          maxHeight: '90vh',
          overflow: 'auto',
          margin: '1rem',
          padding: '2.5rem',
          background: 'linear-gradient(135deg, rgba(255,255,255,0.92) 0%, rgba(255,255,255,0.85) 50%, rgba(255,255,255,0.9) 100%)',
          backdropFilter: 'blur(32px) saturate(1.4)',
          WebkitBackdropFilter: 'blur(32px) saturate(1.4)',
          border: '1px solid rgba(255, 255, 255, 0.6)',
          borderRadius: '1.25rem',
          boxShadow: '0 24px 80px rgba(0, 0, 0, 0.15), 0 8px 24px rgba(150, 112, 91, 0.08)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h2 style={{
            fontSize: '1.5rem',
            fontFamily: 'var(--font-heading)',
            fontWeight: 600,
            color: 'var(--color-dark)',
          }}>
            {program.name}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'none',
              border: 'none',
              fontSize: '1.5rem',
              color: 'var(--color-muted)',
              cursor: 'pointer',
              padding: '0.25rem',
              lineHeight: 1,
            }}
          >
            &times;
          </button>
        </div>
        <p style={{ color: 'var(--color-muted)', fontSize: '0.875rem' }}>
          Enrollment wizard coming soon — placeholder.
        </p>
      </div>
    </div>
  )
}
```

**Step 3: Verify page renders with cards and modal**

Run: `npm run dev`, go to `/programs`, click "Enroll Now" on a card.
Expected: Modal opens with program name and placeholder text.

**Step 4: Commit**

```bash
git add src/components/programs/ProgramExplorer.tsx src/components/programs/EnrollmentModal.tsx
git commit -m "feat(programs): add ProgramExplorer and placeholder EnrollmentModal"
```

---

## Task 6: Enrollment Context (State Management)

**Files:**
- Create: `src/components/programs/EnrollmentContext.tsx`

**Step 1: Create the enrollment state management**

This is the equivalent of WizardContext but for program enrollment.

```tsx
import { createContext, useContext, useReducer, type ReactNode } from 'react'
import type { ProgramConfig, ProgramSessionConfig } from '@config/site.config'
import type { Discount } from '@providers/interfaces/payment'

export interface ChildInfo {
  firstName: string
  lastName: string
  age: string
  allergies: string
  medicalNotes: string
  emergencyContactName: string
  emergencyContactPhone: string
  authorizedPickup: string
}

export interface EnrollmentState {
  currentStep: number
  program: ProgramConfig
  selectedSessions: ProgramSessionConfig[]
  headcount: number
  children: ChildInfo[]
  parentInfo: { firstName: string; lastName: string; email: string; phone: string } | null
  couponCode: string | null
  appliedDiscount: Discount | null
  orderId: string | null
  paymentStatus: 'idle' | 'processing' | 'completed' | 'failed'
  error: string | null
}

export type EnrollmentAction =
  | { type: 'SET_SESSIONS'; payload: ProgramSessionConfig[] }
  | { type: 'SET_HEADCOUNT'; payload: number }
  | { type: 'SET_CHILD_INFO'; payload: { index: number; info: ChildInfo } }
  | { type: 'SET_PARENT_INFO'; payload: { firstName: string; lastName: string; email: string; phone: string } }
  | { type: 'APPLY_COUPON'; payload: { code: string; discount: Discount } }
  | { type: 'SET_ORDER_ID'; payload: string }
  | { type: 'SET_PAYMENT_STATUS'; payload: 'idle' | 'processing' | 'completed' | 'failed' }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'GO_TO_STEP'; payload: number }
  | { type: 'NEXT_STEP' }
  | { type: 'PREV_STEP' }
  | { type: 'RESET' }

export function createInitialState(program: ProgramConfig): EnrollmentState {
  return {
    currentStep: 0,
    program,
    selectedSessions: program.enrollmentType === 'full' ? [...program.sessions] : [],
    headcount: 1,
    children: [emptyChild()],
    parentInfo: null,
    couponCode: null,
    appliedDiscount: null,
    orderId: null,
    paymentStatus: 'idle',
    error: null,
  }
}

export function emptyChild(): ChildInfo {
  return {
    firstName: '',
    lastName: '',
    age: '',
    allergies: '',
    medicalNotes: '',
    emergencyContactName: '',
    emergencyContactPhone: '',
    authorizedPickup: '',
  }
}

export function enrollmentReducer(state: EnrollmentState, action: EnrollmentAction): EnrollmentState {
  switch (action.type) {
    case 'SET_SESSIONS':
      return { ...state, selectedSessions: action.payload }
    case 'SET_HEADCOUNT': {
      const count = action.payload
      const children = [...state.children]
      while (children.length < count) children.push(emptyChild())
      while (children.length > count) children.pop()
      return { ...state, headcount: count, children }
    }
    case 'SET_CHILD_INFO': {
      const children = [...state.children]
      children[action.payload.index] = action.payload.info
      return { ...state, children }
    }
    case 'SET_PARENT_INFO':
      return { ...state, parentInfo: action.payload }
    case 'APPLY_COUPON':
      return { ...state, couponCode: action.payload.code, appliedDiscount: action.payload.discount }
    case 'SET_ORDER_ID':
      return { ...state, orderId: action.payload }
    case 'SET_PAYMENT_STATUS':
      return { ...state, paymentStatus: action.payload }
    case 'SET_ERROR':
      return { ...state, error: action.payload }
    case 'GO_TO_STEP':
      return { ...state, currentStep: action.payload }
    case 'NEXT_STEP':
      return { ...state, currentStep: state.currentStep + 1 }
    case 'PREV_STEP':
      return { ...state, currentStep: Math.max(0, state.currentStep - 1) }
    case 'RESET':
      return createInitialState(state.program)
    default:
      return state
  }
}

interface EnrollmentContextValue {
  state: EnrollmentState
  dispatch: React.Dispatch<EnrollmentAction>
}

const EnrollmentContext = createContext<EnrollmentContextValue | null>(null)

export function EnrollmentProvider({ program, children }: { program: ProgramConfig; children: ReactNode }) {
  const [state, dispatch] = useReducer(enrollmentReducer, createInitialState(program))
  return <EnrollmentContext.Provider value={{ state, dispatch }}>{children}</EnrollmentContext.Provider>
}

export function useEnrollment(): EnrollmentContextValue {
  const ctx = useContext(EnrollmentContext)
  if (!ctx) throw new Error('useEnrollment must be used within an EnrollmentProvider')
  return ctx
}
```

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: Clean

**Step 3: Commit**

```bash
git add src/components/programs/EnrollmentContext.tsx
git commit -m "feat(programs): add enrollment state management context"
```

---

## Task 7: Enrollment Wizard Steps

**Files:**
- Create: `src/components/programs/steps/SessionSelectStep.tsx`
- Create: `src/components/programs/steps/HeadcountStep.tsx`
- Create: `src/components/programs/steps/ChildIntakeStep.tsx`
- Create: `src/components/programs/steps/ParentInfoStep.tsx`
- Create: `src/components/programs/steps/PaymentStep.tsx`
- Create: `src/components/programs/steps/ConfirmationStep.tsx`

**Step 1: Create SessionSelectStep**

```tsx
import { useEnrollment } from '../EnrollmentContext'
import type { ProgramSessionConfig } from '@config/site.config'

function formatDateRange(start: string, end: string): string {
  const s = new Date(start + 'T00:00:00')
  const e = new Date(end + 'T00:00:00')
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  return `${s.toLocaleDateString('en-US', opts)} – ${e.toLocaleDateString('en-US', opts)}`
}

function isSessionPastCutoff(session: ProgramSessionConfig): boolean {
  const cutoff = new Date(session.startDate + 'T00:00:00')
  cutoff.setDate(cutoff.getDate() - 1)
  cutoff.setHours(21, 0, 0, 0) // 9 PM CT night before
  return new Date() >= cutoff
}

export default function SessionSelectStep() {
  const { state, dispatch } = useEnrollment()
  const { program, selectedSessions } = state

  function toggleSession(session: ProgramSessionConfig) {
    const isSelected = selectedSessions.some(s => s.id === session.id)
    const updated = isSelected
      ? selectedSessions.filter(s => s.id !== session.id)
      : [...selectedSessions, session]
    dispatch({ type: 'SET_SESSIONS', payload: updated })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', marginBottom: '0.5rem' }}>
        Select the session(s) you'd like to enroll in:
      </p>

      {program.sessions.map((session) => {
        const closed = isSessionPastCutoff(session)
        const selected = selectedSessions.some(s => s.id === session.id)

        return (
          <button
            key={session.id}
            type="button"
            disabled={closed}
            onClick={() => toggleSession(session)}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '1rem 1.25rem',
              background: selected
                ? 'linear-gradient(135deg, rgba(150, 112, 91, 0.1) 0%, rgba(150, 112, 91, 0.05) 100%)'
                : 'linear-gradient(135deg, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0.35) 50%, rgba(255,255,255,0.5) 100%)',
              backdropFilter: 'blur(20px) saturate(1.3)',
              WebkitBackdropFilter: 'blur(20px) saturate(1.3)',
              border: selected
                ? '1.5px solid var(--color-primary)'
                : '1px solid rgba(255, 255, 255, 0.5)',
              borderRadius: '0.75rem',
              cursor: closed ? 'not-allowed' : 'pointer',
              opacity: closed ? 0.5 : 1,
              boxShadow: '0 4px 16px rgba(150, 112, 91, 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.7)',
              transition: 'all 0.3s ease',
              textAlign: 'left',
            }}
          >
            <div>
              <span style={{
                fontSize: '0.9375rem',
                fontWeight: 500,
                color: 'var(--color-dark)',
              }}>
                {session.name}
              </span>
              <span style={{
                display: 'block',
                fontSize: '0.8125rem',
                color: 'var(--color-muted)',
                marginTop: '0.125rem',
              }}>
                {formatDateRange(session.startDate, session.endDate)}
              </span>
            </div>
            {closed ? (
              <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)', fontStyle: 'italic' }}>
                Enrollment closed
              </span>
            ) : (
              <span style={{
                fontSize: '0.75rem',
                fontWeight: 500,
                color: selected ? 'var(--color-primary)' : 'var(--color-muted)',
              }}>
                {selected ? 'Selected' : 'Select'}
              </span>
            )}
          </button>
        )
      })}

      <button
        type="button"
        disabled={selectedSessions.length === 0}
        onClick={() => dispatch({ type: 'NEXT_STEP' })}
        style={{
          marginTop: '0.5rem',
          padding: '0.875rem',
          background: selectedSessions.length > 0 ? 'var(--color-primary)' : 'rgba(150, 112, 91, 0.3)',
          color: '#fff',
          border: 'none',
          borderRadius: '0.75rem',
          fontSize: '0.875rem',
          fontWeight: 600,
          cursor: selectedSessions.length > 0 ? 'pointer' : 'not-allowed',
          transition: 'filter 0.3s ease',
        }}
        onMouseEnter={(e) => { if (selectedSessions.length > 0) e.currentTarget.style.filter = 'brightness(0.9)' }}
        onMouseLeave={(e) => { e.currentTarget.style.filter = 'none' }}
      >
        Continue
      </button>
    </div>
  )
}
```

**Step 2: Create HeadcountStep**

```tsx
import { useEnrollment } from '../EnrollmentContext'

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(0)}`
}

export default function HeadcountStep() {
  const { state, dispatch } = useEnrollment()
  const { program, headcount, selectedSessions } = state

  const sessionCount = selectedSessions.length
  const perChild = program.pricePerHead * sessionCount
  const total = perChild * headcount

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div>
        <label
          htmlFor="headcount"
          style={{
            display: 'block',
            fontSize: '0.875rem',
            fontWeight: 500,
            color: 'var(--color-dark)',
            marginBottom: '0.5rem',
          }}
        >
          How many children?
        </label>
        <input
          id="headcount"
          type="number"
          min={1}
          max={program.maxCapacity}
          value={headcount}
          onChange={(e) => dispatch({ type: 'SET_HEADCOUNT', payload: Math.max(1, Math.min(program.maxCapacity, Number(e.target.value))) })}
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
        <p style={{ fontSize: '0.8125rem', color: 'var(--color-muted)', marginTop: '0.375rem' }}>
          Max {program.maxCapacity} per session
        </p>
      </div>

      {/* Price summary */}
      <div style={{
        padding: '1rem 1.25rem',
        background: 'linear-gradient(135deg, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0.35) 50%, rgba(255,255,255,0.5) 100%)',
        backdropFilter: 'blur(20px) saturate(1.3)',
        WebkitBackdropFilter: 'blur(20px) saturate(1.3)',
        border: '1px solid rgba(255, 255, 255, 0.5)',
        borderRadius: '0.75rem',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', color: 'var(--color-muted)', marginBottom: '0.375rem' }}>
          <span>{formatPrice(program.pricePerHead)} &times; {headcount} child{headcount > 1 ? 'ren' : ''} &times; {sessionCount} session{sessionCount > 1 ? 's' : ''}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.125rem', fontWeight: 600, color: 'var(--color-dark)' }}>
          <span>Total</span>
          <span>{formatPrice(total)}</span>
        </div>
      </div>

      <button
        type="button"
        onClick={() => dispatch({ type: 'NEXT_STEP' })}
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
        Continue
      </button>
    </div>
  )
}
```

**Step 3: Create ChildIntakeStep**

```tsx
import { useEnrollment, type ChildInfo } from '../EnrollmentContext'

interface ChildIntakeStepProps {
  childIndex: number
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.75rem 1rem',
  background: 'rgba(255, 255, 255, 0.75)',
  backdropFilter: 'blur(12px)',
  border: '1px solid rgba(150, 112, 91, 0.1)',
  borderRadius: '0.75rem',
  fontSize: '0.875rem',
  color: 'var(--color-dark)',
  outline: 'none',
  transition: 'border-color 0.3s ease',
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.8125rem',
  fontWeight: 500,
  color: 'var(--color-dark)',
  marginBottom: '0.375rem',
}

export default function ChildIntakeStep({ childIndex }: ChildIntakeStepProps) {
  const { state, dispatch } = useEnrollment()
  const child = state.children[childIndex]

  function update(field: keyof ChildInfo, value: string) {
    dispatch({
      type: 'SET_CHILD_INFO',
      payload: { index: childIndex, info: { ...child, [field]: value } },
    })
  }

  const isValid = child.firstName.trim() && child.lastName.trim() && child.age.trim()
    && child.emergencyContactName.trim() && child.emergencyContactPhone.trim()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <p style={{ fontSize: '0.8125rem', color: 'var(--color-muted)' }}>
        Child {childIndex + 1} of {state.headcount}
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
        <div>
          <label style={labelStyle}>First Name *</label>
          <input style={inputStyle} value={child.firstName} onChange={(e) => update('firstName', e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Last Name *</label>
          <input style={inputStyle} value={child.lastName} onChange={(e) => update('lastName', e.target.value)} />
        </div>
      </div>

      <div style={{ maxWidth: '8rem' }}>
        <label style={labelStyle}>Age *</label>
        <input style={inputStyle} type="number" min={1} max={18} value={child.age} onChange={(e) => update('age', e.target.value)} />
      </div>

      <div>
        <label style={labelStyle}>Allergies / Dietary Restrictions</label>
        <textarea
          style={{ ...inputStyle, minHeight: '3.5rem', resize: 'vertical' }}
          value={child.allergies}
          onChange={(e) => update('allergies', e.target.value)}
          placeholder="List any food allergies or dietary needs..."
        />
      </div>

      <div>
        <label style={labelStyle}>Medical Notes</label>
        <textarea
          style={{ ...inputStyle, minHeight: '3.5rem', resize: 'vertical' }}
          value={child.medicalNotes}
          onChange={(e) => update('medicalNotes', e.target.value)}
          placeholder="Any medical conditions, medications, or special needs..."
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
        <div>
          <label style={labelStyle}>Emergency Contact Name *</label>
          <input style={inputStyle} value={child.emergencyContactName} onChange={(e) => update('emergencyContactName', e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Emergency Contact Phone *</label>
          <input style={inputStyle} type="tel" value={child.emergencyContactPhone} onChange={(e) => update('emergencyContactPhone', e.target.value)} />
        </div>
      </div>

      <div>
        <label style={labelStyle}>Authorized Pickup Persons</label>
        <textarea
          style={{ ...inputStyle, minHeight: '3rem', resize: 'vertical' }}
          value={child.authorizedPickup}
          onChange={(e) => update('authorizedPickup', e.target.value)}
          placeholder="Names of people authorized to pick up this child..."
        />
      </div>

      <button
        type="button"
        disabled={!isValid}
        onClick={() => dispatch({ type: 'NEXT_STEP' })}
        style={{
          padding: '0.875rem',
          background: isValid ? 'var(--color-primary)' : 'rgba(150, 112, 91, 0.3)',
          color: '#fff',
          border: 'none',
          borderRadius: '0.75rem',
          fontSize: '0.875rem',
          fontWeight: 600,
          cursor: isValid ? 'pointer' : 'not-allowed',
          transition: 'filter 0.3s ease',
        }}
        onMouseEnter={(e) => { if (isValid) e.currentTarget.style.filter = 'brightness(0.9)' }}
        onMouseLeave={(e) => { e.currentTarget.style.filter = 'none' }}
      >
        {childIndex < state.headcount - 1 ? 'Next Child' : 'Continue'}
      </button>
    </div>
  )
}
```

**Step 4: Create ParentInfoStep**

```tsx
import { useState } from 'react'
import { useEnrollment } from '../EnrollmentContext'

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.75rem 1rem',
  background: 'rgba(255, 255, 255, 0.75)',
  backdropFilter: 'blur(12px)',
  border: '1px solid rgba(150, 112, 91, 0.1)',
  borderRadius: '0.75rem',
  fontSize: '0.875rem',
  color: 'var(--color-dark)',
  outline: 'none',
  transition: 'border-color 0.3s ease',
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.8125rem',
  fontWeight: 500,
  color: 'var(--color-dark)',
  marginBottom: '0.375rem',
}

export default function ParentInfoStep() {
  const { state, dispatch } = useEnrollment()
  const [firstName, setFirstName] = useState(state.parentInfo?.firstName ?? '')
  const [lastName, setLastName] = useState(state.parentInfo?.lastName ?? '')
  const [email, setEmail] = useState(state.parentInfo?.email ?? '')
  const [phone, setPhone] = useState(state.parentInfo?.phone ?? '')

  const isValid = firstName.trim() && lastName.trim() && email.trim() && phone.trim()

  function handleContinue() {
    dispatch({
      type: 'SET_PARENT_INFO',
      payload: {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        phone: phone.trim(),
      },
    })
    dispatch({ type: 'NEXT_STEP' })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)' }}>
        Parent or guardian contact information
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
        <div>
          <label style={labelStyle}>First Name *</label>
          <input style={inputStyle} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Last Name *</label>
          <input style={inputStyle} value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </div>
      </div>

      <div>
        <label style={labelStyle}>Email *</label>
        <input style={inputStyle} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>

      <div>
        <label style={labelStyle}>Phone *</label>
        <input style={inputStyle} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </div>

      <button
        type="button"
        disabled={!isValid}
        onClick={handleContinue}
        style={{
          padding: '0.875rem',
          background: isValid ? 'var(--color-primary)' : 'rgba(150, 112, 91, 0.3)',
          color: '#fff',
          border: 'none',
          borderRadius: '0.75rem',
          fontSize: '0.875rem',
          fontWeight: 600,
          cursor: isValid ? 'pointer' : 'not-allowed',
          transition: 'filter 0.3s ease',
        }}
        onMouseEnter={(e) => { if (isValid) e.currentTarget.style.filter = 'brightness(0.9)' }}
        onMouseLeave={(e) => { e.currentTarget.style.filter = 'none' }}
      >
        Continue to Payment
      </button>
    </div>
  )
}
```

**Step 5: Create PaymentStep**

```tsx
import { useState, useEffect, useRef } from 'react'
import { useEnrollment } from '../EnrollmentContext'
import CouponInput from '@components/checkout/CouponInput'
import PaymentForm from '@components/checkout/PaymentForm'
import type { PaymentFormRef } from '@components/checkout/PaymentForm'
import type { LineItem, Discount } from '@providers/interfaces/payment'

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

export default function PaymentStep() {
  const { state, dispatch } = useEnrollment()
  const paymentFormRef = useRef<PaymentFormRef>(null)
  const [processing, setProcessing] = useState(false)

  const { program, selectedSessions, headcount, children, parentInfo } = state

  const sessionCount = selectedSessions.length
  const subtotal = program.pricePerHead * headcount * sessionCount
  const discountAmount = state.appliedDiscount
    ? state.appliedDiscount.type === 'percent'
      ? Math.round((subtotal * state.appliedDiscount.value) / 100)
      : state.appliedDiscount.value
    : 0
  const total = subtotal - discountAmount

  const lineItems: LineItem[] = selectedSessions.map((session) => ({
    name: `${program.name} — ${session.name}`,
    quantity: headcount,
    pricePerUnit: program.pricePerHead,
  }))

  function handleCouponApply(code: string, discount: Discount) {
    dispatch({ type: 'APPLY_COUPON', payload: { code, discount } })
  }

  async function handlePay() {
    if (!parentInfo) return
    dispatch({ type: 'SET_ERROR', payload: null })
    dispatch({ type: 'SET_PAYMENT_STATUS', payload: 'processing' })
    setProcessing(true)

    try {
      // Create customer
      const customerRes = await fetch('/api/customer/find-or-create.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          givenName: parentInfo.firstName,
          familyName: parentInfo.lastName,
          email: parentInfo.email,
          phone: parentInfo.phone,
        }),
      })
      if (!customerRes.ok) throw new Error('Failed to create customer')
      const customerData = await customerRes.json()

      // Build order note with child intake data
      const enrollmentData = {
        programId: program.id,
        programName: program.name,
        sessions: selectedSessions.map(s => ({ id: s.id, name: s.name, startDate: s.startDate, endDate: s.endDate })),
        children: children.map(c => ({
          name: `${c.firstName} ${c.lastName}`,
          age: c.age,
          allergies: c.allergies,
          medicalNotes: c.medicalNotes,
          emergencyContact: `${c.emergencyContactName} (${c.emergencyContactPhone})`,
          authorizedPickup: c.authorizedPickup,
        })),
        parentPhone: parentInfo.phone,
      }

      // Create order
      const orderRes = await fetch('/api/checkout/create-order.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: customerData.data.id,
          lineItems,
          discounts: state.appliedDiscount ? [state.appliedDiscount] : [],
          note: JSON.stringify(enrollmentData),
        }),
      })
      if (!orderRes.ok) throw new Error('Failed to create order')
      const orderData = await orderRes.json()
      dispatch({ type: 'SET_ORDER_ID', payload: orderData.data.id })

      // Tokenize payment
      const token = await paymentFormRef.current!.tokenize()

      // Process payment
      const paymentRes = await fetch('/api/checkout/process-payment.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: orderData.data.id,
          paymentToken: token,
          amount: orderData.data.totalAmount,
          currency: 'USD',
        }),
      })
      if (!paymentRes.ok) throw new Error('Payment failed')

      dispatch({ type: 'SET_PAYMENT_STATUS', payload: 'completed' })
      dispatch({ type: 'NEXT_STEP' })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An error occurred'
      dispatch({ type: 'SET_ERROR', payload: message })
      dispatch({ type: 'SET_PAYMENT_STATUS', payload: 'failed' })
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Order summary */}
      <div style={{
        padding: '1.25rem',
        background: 'linear-gradient(135deg, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0.35) 50%, rgba(255,255,255,0.5) 100%)',
        backdropFilter: 'blur(20px) saturate(1.3)',
        WebkitBackdropFilter: 'blur(20px) saturate(1.3)',
        border: '1px solid rgba(255, 255, 255, 0.5)',
        borderRadius: '0.75rem',
      }}>
        <h3 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-dark)', marginBottom: '0.75rem' }}>
          Order Summary
        </h3>
        {selectedSessions.map((session) => (
          <div key={session.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem', color: 'var(--color-muted)', marginBottom: '0.375rem' }}>
            <span>{session.name} &times; {headcount}</span>
            <span>{formatPrice(program.pricePerHead * headcount)}</span>
          </div>
        ))}
        {state.appliedDiscount && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem', color: 'var(--color-primary)', marginBottom: '0.375rem' }}>
            <span>Discount</span>
            <span>-{formatPrice(discountAmount)}</span>
          </div>
        )}
        <div style={{ borderTop: '1px solid rgba(150, 112, 91, 0.08)', marginTop: '0.5rem', paddingTop: '0.5rem', display: 'flex', justifyContent: 'space-between', fontSize: '1rem', fontWeight: 600, color: 'var(--color-dark)' }}>
          <span>Total</span>
          <span>{formatPrice(total)}</span>
        </div>
      </div>

      <CouponInput onApply={handleCouponApply} />

      <PaymentForm ref={paymentFormRef} />

      {state.error && (
        <p style={{ fontSize: '0.8125rem', color: '#dc2626' }}>{state.error}</p>
      )}

      <button
        type="button"
        onClick={handlePay}
        disabled={processing}
        style={{
          padding: '0.875rem',
          background: processing ? 'rgba(150, 112, 91, 0.5)' : 'var(--color-primary)',
          color: '#fff',
          border: 'none',
          borderRadius: '0.75rem',
          fontSize: '0.875rem',
          fontWeight: 600,
          cursor: processing ? 'not-allowed' : 'pointer',
          transition: 'filter 0.3s ease',
        }}
        onMouseEnter={(e) => { if (!processing) e.currentTarget.style.filter = 'brightness(0.9)' }}
        onMouseLeave={(e) => { e.currentTarget.style.filter = 'none' }}
      >
        {processing ? 'Processing...' : `Pay ${formatPrice(total)}`}
      </button>
    </div>
  )
}
```

**Step 6: Create ConfirmationStep**

```tsx
import { useEnrollment } from '../EnrollmentContext'

export default function ConfirmationStep() {
  const { state } = useEnrollment()

  return (
    <div style={{ textAlign: 'center', padding: '1rem 0' }}>
      <div style={{
        width: '3rem',
        height: '3rem',
        margin: '0 auto 1.25rem',
        borderRadius: '50%',
        background: 'rgba(34, 197, 94, 0.1)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '1.5rem',
      }}>
        &#10003;
      </div>
      <h3 style={{
        fontSize: '1.25rem',
        fontFamily: 'var(--font-heading)',
        fontWeight: 600,
        color: 'var(--color-dark)',
        marginBottom: '0.75rem',
      }}>
        Enrollment Confirmed
      </h3>
      <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', lineHeight: 1.6, maxWidth: '24rem', margin: '0 auto' }}>
        You're enrolled in <strong>{state.program.name}</strong> for{' '}
        {state.headcount} child{state.headcount > 1 ? 'ren' : ''}.
        A confirmation has been sent to <strong>{state.parentInfo?.email}</strong>.
      </p>
      <p style={{ fontSize: '0.8125rem', color: 'var(--color-muted)', marginTop: '1rem' }}>
        The instructor will receive a roster before each session.
      </p>
    </div>
  )
}
```

**Step 7: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: Clean

**Step 8: Commit**

```bash
git add src/components/programs/steps/
git commit -m "feat(programs): add all enrollment wizard steps"
```

---

## Task 8: Wire Up EnrollmentModal

**Files:**
- Modify: `src/components/programs/EnrollmentModal.tsx`

**Step 1: Replace the placeholder with the full wizard**

Replace the entire file content:

```tsx
import { useState, useEffect, useRef } from 'react'
import type { ProgramConfig } from '@config/site.config'
import { EnrollmentProvider, useEnrollment } from './EnrollmentContext'
import SessionSelectStep from './steps/SessionSelectStep'
import HeadcountStep from './steps/HeadcountStep'
import ChildIntakeStep from './steps/ChildIntakeStep'
import ParentInfoStep from './steps/ParentInfoStep'
import PaymentStep from './steps/PaymentStep'
import ConfirmationStep from './steps/ConfirmationStep'

interface EnrollmentModalProps {
  program: ProgramConfig
  onClose: () => void
}

function getStepLabels(program: ProgramConfig, headcount: number): string[] {
  const labels: string[] = []
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

function ModalContent({ program, onClose }: EnrollmentModalProps) {
  const { state, dispatch } = useEnrollment()
  const [visible, setVisible] = useState(true)
  const [displayStep, setDisplayStep] = useState(state.currentStep)
  const prevStep = useRef(state.currentStep)

  // Step transition animation
  useEffect(() => {
    if (state.currentStep !== prevStep.current) {
      setVisible(false)
      const timer = setTimeout(() => {
        setDisplayStep(state.currentStep)
        prevStep.current = state.currentStep
        setVisible(true)
      }, 200)
      return () => clearTimeout(timer)
    }
  }, [state.currentStep])

  const stepLabels = getStepLabels(program, state.headcount)
  const isPerSession = program.enrollmentType === 'per-session'

  // Map currentStep to actual component
  function renderStep() {
    let step = displayStep
    if (!isPerSession) step += 1 // skip session select

    if (isPerSession && step === 0) return <SessionSelectStep />
    const offset = isPerSession ? 1 : 1
    if (step === offset) return <HeadcountStep />

    const childStart = offset + 1
    const childEnd = childStart + state.headcount - 1
    if (step >= childStart && step <= childEnd) {
      return <ChildIntakeStep childIndex={step - childStart} />
    }

    if (step === childEnd + 1) return <ParentInfoStep />
    if (step === childEnd + 2) return <PaymentStep />
    return <ConfirmationStep />
  }

  const isConfirmation = state.paymentStatus === 'completed'
  const progress = isConfirmation ? 100 : (state.currentStep / (stepLabels.length - 1)) * 100

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.4)',
        backdropFilter: 'blur(4px)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isConfirmation) onClose()
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '40rem',
          maxHeight: '90vh',
          overflow: 'auto',
          margin: '1rem',
          padding: '2.5rem',
          background: 'linear-gradient(135deg, rgba(255,255,255,0.92) 0%, rgba(255,255,255,0.85) 50%, rgba(255,255,255,0.9) 100%)',
          backdropFilter: 'blur(32px) saturate(1.4)',
          WebkitBackdropFilter: 'blur(32px) saturate(1.4)',
          border: '1px solid rgba(255, 255, 255, 0.6)',
          borderRadius: '1.25rem',
          boxShadow: '0 24px 80px rgba(0, 0, 0, 0.15), 0 8px 24px rgba(150, 112, 91, 0.08)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h2 style={{
            fontSize: '1.25rem',
            fontFamily: 'var(--font-heading)',
            fontWeight: 600,
            color: 'var(--color-dark)',
          }}>
            {program.name}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'none',
              border: 'none',
              fontSize: '1.5rem',
              color: 'var(--color-muted)',
              cursor: 'pointer',
              padding: '0.25rem',
              lineHeight: 1,
            }}
          >
            &times;
          </button>
        </div>

        {/* Progress bar */}
        {!isConfirmation && (
          <nav aria-label="Enrollment progress" style={{ marginBottom: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.5rem' }}>
              <span style={{
                fontSize: '0.8125rem',
                fontWeight: 500,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'var(--color-dark)',
              }}>
                {stepLabels[state.currentStep]}
              </span>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>
                {state.currentStep + 1} / {stepLabels.length}
              </span>
            </div>
            <div style={{ height: '2px', background: 'rgba(150, 112, 91, 0.1)', borderRadius: '1px', overflow: 'hidden' }}>
              <div
                role="progressbar"
                aria-valuenow={state.currentStep + 1}
                aria-valuemin={1}
                aria-valuemax={stepLabels.length}
                style={{
                  height: '100%',
                  width: `${progress}%`,
                  background: 'linear-gradient(90deg, var(--color-primary), var(--color-accent))',
                  borderRadius: '1px',
                  transition: 'width 0.5s cubic-bezier(0.25, 0.1, 0, 1)',
                }}
              />
            </div>
          </nav>
        )}

        {/* Back button */}
        {state.currentStep > 0 && !isConfirmation && (
          <button
            type="button"
            onClick={() => dispatch({ type: 'PREV_STEP' })}
            style={{
              marginBottom: '1.25rem',
              fontSize: '0.8125rem',
              color: 'var(--color-muted)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
              display: 'flex',
              alignItems: 'center',
              gap: '0.375rem',
              transition: 'color 0.3s ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-dark)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-muted)')}
          >
            <span style={{ fontSize: '0.875rem' }}>&larr;</span>
            Back
          </button>
        )}

        {/* Step content with transition */}
        <div
          style={{
            opacity: visible ? 1 : 0,
            transform: visible ? 'translateY(0)' : 'translateY(12px)',
            transition: 'opacity 0.3s cubic-bezier(0.16, 1, 0.3, 1), transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          {renderStep()}
        </div>

        {/* Close button on confirmation */}
        {isConfirmation && (
          <button
            type="button"
            onClick={onClose}
            style={{
              marginTop: '1.5rem',
              width: '100%',
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
            Done
          </button>
        )}
      </div>
    </div>
  )
}

export default function EnrollmentModal({ program, onClose }: EnrollmentModalProps) {
  // Lock body scroll when modal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  return (
    <EnrollmentProvider program={program}>
      <ModalContent program={program} onClose={onClose} />
    </EnrollmentProvider>
  )
}
```

**Step 2: Verify the full enrollment flow**

Run: `npm run dev`, go to `/programs`, click Enroll on Summer Art Camp.
Expected: Modal opens with session selection → headcount → child intake → parent info → payment → confirmation.

**Step 3: Commit**

```bash
git add src/components/programs/EnrollmentModal.tsx
git commit -m "feat(programs): wire up full enrollment modal with all steps"
```

---

## Task 9: Programs API Route

**Files:**
- Create: `src/pages/api/programs/enroll.json.ts`

**Step 1: Create the enrollment API**

This stores the enrollment note on the order for roster retrieval later.

```typescript
import type { APIRoute } from 'astro'
import { createLogger } from '@lib/logger'
import { providers } from '@config/providers'

export const POST: APIRoute = async ({ request }) => {
  const logger = createLogger('api:programs:enroll')
  const startTime = Date.now()

  try {
    const body = await request.json()
    const { programId, programName, sessions, children, parentPhone, orderId } = body

    // Store enrollment data — the order note already contains the enrollment JSON
    // from the checkout flow. This endpoint is for any additional processing.
    logger.info('Program enrollment recorded', {
      duration_ms: Date.now() - startTime,
      programId,
      programName,
      sessionCount: sessions?.length,
      childCount: children?.length,
      orderId,
    })

    // Send Slack notification
    await providers.notification.send({
      type: 'webhook',
      title: `New program enrollment: ${programName}`,
      details: {
        program: programName,
        sessions: sessions?.map((s: { name: string }) => s.name).join(', '),
        children: children?.length,
        orderId,
      },
      severity: 'info',
      timestamp: new Date().toISOString(),
    })

    return new Response(JSON.stringify({ data: { success: true } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    logger.error('Program enrollment failed', {
      error: error instanceof Error ? error.message : String(error),
      duration_ms: Date.now() - startTime,
    })
    return new Response(
      JSON.stringify({ error: 'Enrollment recording failed' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }
}
```

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: Clean

**Step 3: Commit**

```bash
git add src/pages/api/programs/enroll.json.ts
git commit -m "feat(programs): add enrollment API route"
```

---

## Task 10: Roster Email Scheduled Function

**Files:**
- Create: `netlify/functions/send-rosters.ts`
- Modify: `netlify.toml` (if it exists, add scheduled function config)

**Step 1: Install Resend**

Run: `npm install resend`

**Step 2: Create the scheduled function**

```typescript
import type { Config, Context } from '@netlify/functions'
import { Resend } from 'resend'

// Program session config — duplicated from site config since Netlify functions
// can't import from the Astro src directory easily
interface ProgramSession {
  id: string
  name: string
  startDate: string
  endDate: string
}

interface ProgramForRoster {
  id: string
  name: string
  instructorEmail: string
  schedule: { days: string; time: string }
  sessions: ProgramSession[]
}

// This would normally come from site config; for the scheduled function,
// we fetch it from an internal API or inline it.
// For now, we'll call the site's API to get program data.

interface ChildRoster {
  name: string
  age: string
  allergies: string
  medicalNotes: string
  emergencyContact: string
  authorizedPickup: string
  parentName: string
  parentPhone: string
  parentEmail: string
}

function buildRosterHtml(programName: string, sessionName: string, dates: string, schedule: string, children: ChildRoster[]): string {
  const rows = children.map((c) => `
    <tr>
      <td style="padding:8px;border:1px solid #e5e5e5">${c.name}</td>
      <td style="padding:8px;border:1px solid #e5e5e5">${c.age}</td>
      <td style="padding:8px;border:1px solid #e5e5e5">${c.allergies || '—'}</td>
      <td style="padding:8px;border:1px solid #e5e5e5">${c.medicalNotes || '—'}</td>
      <td style="padding:8px;border:1px solid #e5e5e5">${c.emergencyContact}</td>
      <td style="padding:8px;border:1px solid #e5e5e5">${c.authorizedPickup || '—'}</td>
      <td style="padding:8px;border:1px solid #e5e5e5">${c.parentName}<br/>${c.parentPhone}<br/>${c.parentEmail}</td>
    </tr>
  `).join('')

  return `
    <div style="font-family:sans-serif;max-width:800px;margin:0 auto">
      <h1 style="font-size:20px;color:#3d3229">${programName}</h1>
      <h2 style="font-size:16px;color:#6b7280;font-weight:normal">${sessionName} &mdash; ${dates}</h2>
      <p style="color:#6b7280;font-size:14px">${schedule}</p>
      <p style="margin:16px 0;font-size:14px;color:#374151"><strong>${children.length}</strong> enrolled</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="background:#faf8f5">
            <th style="padding:8px;border:1px solid #e5e5e5;text-align:left">Child</th>
            <th style="padding:8px;border:1px solid #e5e5e5;text-align:left">Age</th>
            <th style="padding:8px;border:1px solid #e5e5e5;text-align:left">Allergies</th>
            <th style="padding:8px;border:1px solid #e5e5e5;text-align:left">Medical</th>
            <th style="padding:8px;border:1px solid #e5e5e5;text-align:left">Emergency</th>
            <th style="padding:8px;border:1px solid #e5e5e5;text-align:left">Pickup Auth</th>
            <th style="padding:8px;border:1px solid #e5e5e5;text-align:left">Parent</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `
}

export default async (req: Request, context: Context) => {
  const resendKey = Netlify.env.get('RESEND_API_KEY')
  if (!resendKey) {
    console.log('RESEND_API_KEY not set, skipping roster emails')
    return new Response('No API key', { status: 200 })
  }

  const siteUrl = Netlify.env.get('URL') || 'http://localhost:4321'
  const resend = new Resend(resendKey)

  // TODO: In production, fetch programs config and orders from Square API.
  // For now, this is a skeleton that demonstrates the pattern.
  // The actual implementation would:
  // 1. Load program configs (from a config endpoint or environment)
  // 2. For each program, check if any session starts tomorrow
  // 3. Query Square Orders API for orders containing that session's line items
  // 4. Parse the enrollment JSON from order notes
  // 5. Compile roster and send email

  console.log('Roster check running at', new Date().toISOString())

  // Placeholder: log that the function ran
  return new Response(JSON.stringify({ message: 'Roster check complete' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const config: Config = {
  // Run at 9:05 PM CT (which is 3:05 AM UTC next day)
  schedule: '5 3 * * *',
}
```

**Step 3: Commit**

```bash
git add netlify/functions/send-rosters.ts package.json package-lock.json
git commit -m "feat(programs): add roster email scheduled function skeleton"
```

---

## Task 11: Add `programs` Feature Flag to Header

**Files:**
- Modify: `src/components/shared/Header.astro`

**Step 1: Add programs nav item to auto-generated nav**

In the Header.astro file, find the block that auto-generates nav items when `siteConfig.nav` is not set. Add after the workshops check:

```astro
if (siteConfig.features.programs?.enabled) {
  navItems.push({ label: 'Programs', href: '/programs' })
}
```

Note: Since nav is already set explicitly in site.config, this is just a safety net. The main nav link was already added in Task 1.

**Step 2: Verify nav shows Programs link**

Run: `npm run dev`, check that "Programs" appears in the nav.
Expected: Programs link visible between Workshops and Book a Party.

**Step 3: Commit**

```bash
git add src/components/shared/Header.astro
git commit -m "feat(programs): add programs to auto-generated nav fallback"
```

---

## Task 12: Tests

**Files:**
- Create: `tests/components/programs/EnrollmentContext.test.tsx`
- Create: `tests/components/programs/ProgramCard.test.tsx`

**Step 1: Write EnrollmentContext tests**

```tsx
import { describe, it, expect } from 'vitest'
import { enrollmentReducer, createInitialState, emptyChild } from '@components/programs/EnrollmentContext'
import type { ProgramConfig } from '@config/site.config'

const mockProgram: ProgramConfig = {
  id: 'test-camp',
  name: 'Test Camp',
  description: 'A test program',
  enrollmentType: 'per-session',
  pricePerHead: 20000,
  maxCapacity: 10,
  schedule: { days: 'Mon-Thu', time: '9 AM - 12 PM', totalHours: 3 },
  sessions: [
    { id: 'wk1', name: 'Week 1', startDate: '2026-06-08', endDate: '2026-06-11' },
    { id: 'wk2', name: 'Week 2', startDate: '2026-06-15', endDate: '2026-06-18' },
  ],
  instructorEmail: 'test@test.com',
}

describe('enrollmentReducer', () => {
  it('initializes with empty sessions for per-session programs', () => {
    const state = createInitialState(mockProgram)
    expect(state.selectedSessions).toEqual([])
    expect(state.headcount).toBe(1)
    expect(state.children).toHaveLength(1)
  })

  it('initializes with all sessions for full programs', () => {
    const fullProgram = { ...mockProgram, enrollmentType: 'full' as const }
    const state = createInitialState(fullProgram)
    expect(state.selectedSessions).toHaveLength(2)
  })

  it('SET_SESSIONS updates selected sessions', () => {
    const state = createInitialState(mockProgram)
    const next = enrollmentReducer(state, {
      type: 'SET_SESSIONS',
      payload: [mockProgram.sessions[0]],
    })
    expect(next.selectedSessions).toHaveLength(1)
    expect(next.selectedSessions[0].id).toBe('wk1')
  })

  it('SET_HEADCOUNT adjusts children array', () => {
    const state = createInitialState(mockProgram)
    const next = enrollmentReducer(state, { type: 'SET_HEADCOUNT', payload: 3 })
    expect(next.headcount).toBe(3)
    expect(next.children).toHaveLength(3)
  })

  it('SET_HEADCOUNT shrinks children array', () => {
    let state = createInitialState(mockProgram)
    state = enrollmentReducer(state, { type: 'SET_HEADCOUNT', payload: 3 })
    state = enrollmentReducer(state, { type: 'SET_HEADCOUNT', payload: 1 })
    expect(state.children).toHaveLength(1)
  })

  it('SET_CHILD_INFO updates specific child', () => {
    let state = createInitialState(mockProgram)
    state = enrollmentReducer(state, { type: 'SET_HEADCOUNT', payload: 2 })
    const childInfo = { ...emptyChild(), firstName: 'Alice', lastName: 'Smith', age: '8' }
    state = enrollmentReducer(state, { type: 'SET_CHILD_INFO', payload: { index: 1, info: childInfo } })
    expect(state.children[1].firstName).toBe('Alice')
    expect(state.children[0].firstName).toBe('') // untouched
  })

  it('NEXT_STEP and PREV_STEP navigate', () => {
    let state = createInitialState(mockProgram)
    state = enrollmentReducer(state, { type: 'NEXT_STEP' })
    expect(state.currentStep).toBe(1)
    state = enrollmentReducer(state, { type: 'PREV_STEP' })
    expect(state.currentStep).toBe(0)
    state = enrollmentReducer(state, { type: 'PREV_STEP' })
    expect(state.currentStep).toBe(0) // doesn't go below 0
  })

  it('RESET returns to initial state', () => {
    let state = createInitialState(mockProgram)
    state = enrollmentReducer(state, { type: 'SET_HEADCOUNT', payload: 5 })
    state = enrollmentReducer(state, { type: 'NEXT_STEP' })
    state = enrollmentReducer(state, { type: 'RESET' })
    expect(state.currentStep).toBe(0)
    expect(state.headcount).toBe(1)
  })
})
```

**Step 2: Write ProgramCard tests**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ProgramCard from '@components/programs/ProgramCard'
import type { ProgramConfig } from '@config/site.config'

const mockProgram: ProgramConfig = {
  id: 'summer-camp',
  name: 'Summer Art Camp',
  description: 'A week of creative exploration',
  enrollmentType: 'per-session',
  pricePerHead: 22500,
  maxCapacity: 12,
  ageRange: { min: 6, max: 12 },
  schedule: { days: 'Mon-Thu', time: '9:00 AM - 12:30 PM', totalHours: 3.5 },
  sessions: [
    { id: 'wk1', name: 'Week 1', startDate: '2026-06-08', endDate: '2026-06-11' },
    { id: 'wk2', name: 'Week 2', startDate: '2026-06-15', endDate: '2026-06-18' },
  ],
  instructorEmail: 'test@test.com',
}

describe('ProgramCard', () => {
  it('renders program name and description', () => {
    render(<ProgramCard program={mockProgram} onEnroll={() => {}} />)
    expect(screen.getByText('Summer Art Camp')).toBeTruthy()
    expect(screen.getByText('A week of creative exploration')).toBeTruthy()
  })

  it('renders schedule', () => {
    render(<ProgramCard program={mockProgram} onEnroll={() => {}} />)
    expect(screen.getByText(/Mon–Thu/)).toBeTruthy()
  })

  it('renders age range', () => {
    render(<ProgramCard program={mockProgram} onEnroll={() => {}} />)
    expect(screen.getByText('Ages 6–12')).toBeTruthy()
  })

  it('renders session count for per-session programs', () => {
    render(<ProgramCard program={mockProgram} onEnroll={() => {}} />)
    expect(screen.getByText('2 sessions available')).toBeTruthy()
  })

  it('renders price per session', () => {
    render(<ProgramCard program={mockProgram} onEnroll={() => {}} />)
    expect(screen.getByText('$225 / child / session')).toBeTruthy()
  })

  it('calls onEnroll when button clicked', () => {
    const onEnroll = vi.fn()
    render(<ProgramCard program={mockProgram} onEnroll={onEnroll} />)
    fireEvent.click(screen.getByText('Enroll Now'))
    expect(onEnroll).toHaveBeenCalledWith(mockProgram)
  })
})
```

**Step 3: Run tests**

Run: `npx vitest run tests/components/programs/`
Expected: All tests pass

**Step 4: Commit**

```bash
git add tests/components/programs/
git commit -m "test(programs): add enrollment context and program card tests"
```

---

## Task 13: Verify Everything

**Step 1: TypeScript check**

Run: `npx tsc --noEmit`
Expected: Clean

**Step 2: Run all tests**

Run: `npx vitest run`
Expected: All tests pass (existing + new)

**Step 3: Manual verification**

Run: `npm run dev`
- Navigate to `/programs` — see 3 program cards
- Click "Enroll Now" on Summer Art Camp — modal opens with session select
- Select Week 1 → Continue → Set headcount to 2 → Continue
- Fill child 1 intake form → Continue → Fill child 2 → Continue
- Fill parent info → Continue → See payment step with order summary
- Close modal, reopen — state resets

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat(programs): complete programs feature with enrollment wizard"
```
