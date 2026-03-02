# Programs Feature Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Programs page for multi-session offerings (summer camps, homeschool days, winter camps) with per-head enrollment, child intake forms, Square payment, and automated roster emails.

**Architecture:** Programs are catalog products in Square (not bookings). Each program has sessions (enrollable units). Enrollment creates a Square Order with child details. A nightly scheduled function emails rosters to the instructor before each session.

**Tech Stack:** Astro, React, Square Catalog + Orders + Payments APIs, Resend (email), Netlify Scheduled Functions

---

## Naming

These offerings are called **Programs** throughout the UI and codebase.

## Data Model

### Site Config (`site.config.ts`)

New `programs` feature flag and configuration:

```typescript
interface ProgramConfig {
  id: string
  name: string                        // "Summer Art Camp"
  description: string
  image?: string
  enrollmentType: 'per-session' | 'full'
  pricePerHead: number                // cents — per session or per program
  maxCapacity: number                 // per session
  ageRange?: { min: number; max: number }
  schedule: {
    days: string                      // "Mon-Thu" or "Every Thursday"
    time: string                      // "9:00 AM - 12:30 PM"
    totalHours: number                // per day
  }
  sessions: ProgramSessionConfig[]
  catalogItemId?: string              // Square catalog link
  instructorEmail: string             // roster recipient
}

interface ProgramSessionConfig {
  id: string
  name: string                        // "Week 1" or "Spring Semester"
  startDate: string                   // "2026-06-02"
  endDate: string                     // "2026-06-05"
  catalogVariationId?: string         // Square variation link
}
```

Added to `features`:
```typescript
features: {
  // ... existing
  programs: boolean
}
```

### Square Mapping

- **Program** → Square Catalog Item
- **Session** → Square Catalog Variation (e.g., "Week 1 - Jun 2-5" at $150)
- **Enrollment** → Square Order with line items (price x headcount)
- **Child intake data** → Stored as structured JSON in the order note field

For `full` enrollment programs, there is one variation for the entire program.
For `per-session` programs, each session is a separate variation.

No new Square APIs needed — uses existing Catalog + Orders + Payments integration.

## User-Facing Flow

### Programs Page (`/programs`)

- Nav link: "Programs" (between Workshops and Gallery)
- Page header with tagline (same pattern as Workshops/Gallery pages)
- Program cards in a grid — white glassmorphism styling matching workshop cards
- Each card shows: name, description, schedule summary (days + time), age range, price, remaining capacity
- "Enroll" button on each card opens enrollment modal
- Programs past their last session or fully enrolled show appropriate status

### Enrollment Modal

Multi-step wizard inside a modal overlay. Same aesthetic as the booking wizard — glassmorphism panels, CSS variable colors, custom inputs.

**Step 1 — Session Selection** (per-session programs only):
- List of available sessions with dates, price, remaining spots
- Checkboxes to select one or more sessions
- Sessions past cutoff (9 PM CT night before) show "Enrollment closed"
- Full-commitment programs skip this step

**Step 2 — Headcount**:
- "How many children?" number input
- Shows per-head price and subtotal
- Validates against remaining capacity

**Step 3 — Child Intake Form** (repeats per child):
- Child's first & last name
- Age
- Allergies / dietary restrictions (textarea)
- Medical notes (textarea)
- Emergency contact name + phone
- Authorized pickup persons (textarea)
- Progress indicator: "Child 1 of 3"

**Step 4 — Parent/Guardian Info**:
- First name, last name
- Email
- Phone number

**Step 5 — Payment**:
- Order summary (sessions selected, headcount, total)
- Coupon input (reuses existing CouponInput component)
- Square Web Payments SDK card form (same as checkout)

**Step 6 — Confirmation**:
- Success message
- Summary of enrollment
- "You'll receive a confirmation email and a roster will be sent to the instructor before the session."

## Enrollment Logic

- **Pricing**: Flat rate per child per session (or per program for full-commitment). Coupons supported via existing coupon system.
- **Capacity**: Tracked per session. Derived from orders — sum of line item quantities for that session's catalog variation. Compared against `maxCapacity`.
- **Cutoff**: 9 PM CT the night before a session's `startDate`. After cutoff, enrollment closes for that session.
- **Payment**: Same flow as workshops — create Square Order → process payment via Square Web Payments SDK.

## Roster System

### Nightly Scheduled Function

- **Trigger**: Netlify Scheduled Function, runs at 9:05 PM CT daily
- **Logic**:
  1. Check all program sessions — find any with `startDate` = tomorrow
  2. For each matching session, query orders with that session's catalog variation ID
  3. Parse child intake data from order notes
  4. Compile roster: child name, age, allergies, medical notes, emergency contact, parent name + phone
  5. Send formatted HTML email via Resend to the program's `instructorEmail`
  6. Send Slack notification via existing notification provider

### Roster Email Format

- **To**: Instructor email (from program config)
- **Subject**: "Roster: {Program Name} — {Session Name} ({dates})"
- **Body**: Clean HTML table with columns: Child Name, Age, Allergies/Dietary, Medical Notes, Emergency Contact, Parent Name, Parent Phone
- **Footer**: Total enrolled count, max capacity, program schedule info

### Email Provider

- **Service**: Resend (free tier = 100 emails/month, sufficient for this use case)
- **Config**: `RESEND_API_KEY` env var, sender address configured in site config
- **Integration**: New `EmailProvider` interface alongside existing notification provider

## Mock Provider

For local development:
- Mock programs data with 2-3 sample programs (summer camp per-session, homeschool semester full)
- Mock enrollment that stores data in memory
- Mock capacity tracking
- No actual email sending — logs to console

## What's NOT Included (YAGNI)

- No waitlist
- No sibling discounts or tiered pricing
- No recurring billing / subscriptions
- No admin page for rosters (email handles this)
- No calendar view on programs page
- No refund flow (handled manually via Square Dashboard)
- No program editing UI (configured in site.config.ts)
