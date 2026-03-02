# Specific Party Types Design

## Goal

Add specific party types (pottery, slime, knitting, etc.) as catalog-driven items within each party category (Kids / Adult). Users select date & time first, then pick their specific party type from the catalog before seeing full details and completing the booking.

## Current State

- Landing page shows 3 cards: Kids Party, Adult Party, Corporate Event (from `EventTypeConfig` in site.config)
- Clicking a card opens BookingModal: Details → Date → Time Slot → Customize → Checkout
- Party pricing, capacity, and add-ons all come from `EventTypeConfig` (static config)
- Workshops and programs already pull rich `EventType` data from the catalog provider

## Design

### Data Model

**Category-level config** (`EventTypeConfig` in site.config) defines:
- Capacity limits (base 12, max 20 for kids / max 36 for adults)
- Extra guest pricing ($25 kids / $30 adults)
- Add-on availability (modifier lists shared across the category)
- Flow type (booking vs quote)
- Duration

**Specific party types** are `EventType` objects from the catalog provider:
- Two new categories: `kids-party` and `adult-party`
- Each item has: name, description, image, one variation (base price)
- No modifiers on individual items — add-ons stay at the category level
- All start at $400 base price, but stored per-item for future flexibility

**Source of truth for pricing:** The catalog item's variation price, NOT `EventTypeConfig.basePrice`. This ensures the Square order references the actual catalog item/variation for proper reconciliation.

### Modal Flow (7 steps)

| Step | Component | Source |
|------|-----------|--------|
| 1 | DateSelectionStep | Existing, no changes |
| 2 | AvailableSlotsStep | Existing, no changes |
| 3 | **PartyTypeStep** (new) | Fetches catalog items by category, shows grid of cards |
| 4 | DetailsStep | Existing shared component, reads from selected party type |
| 5 | CustomizeStep | Existing, base price from catalog variation |
| 6 | CheckoutStep / InquiryStep | Existing, order uses catalog item ID + variation ID |

### WizardContext Changes

New state field: `selectedPartyType: EventType | null`

- `eventType` (existing) — category-level `EventTypeConfig` (Kids Party / Adult Party)
- `selectedPartyType` (new) — specific catalog item (Slime Party, Pottery Party, etc.)

New action: `SET_PARTY_TYPE` — stores the selected `EventType` from catalog.

### Data Flow

1. Landing page → user picks category → `SET_EVENT_TYPE` stores `EventTypeConfig`
2. Modal opens at Date step (step 1)
3. PartyTypeStep → `GET /api/catalog/event-types.json?category=kids-party` → user picks → `SET_PARTY_TYPE`
4. DetailsStep → reads `state.selectedPartyType` (name, description, image from catalog)
5. CustomizeStep → base price from `state.selectedPartyType.variations[0].priceAmount`, capacity/extras from `state.eventType`
6. CheckoutStep → order line item uses catalog item ID + variation ID from `selectedPartyType`
7. Add-ons → `GET /api/catalog/add-ons.json?eventTypeId=<category-id>` (shared per category)

### Mock Data

New catalog items in `src/providers/mock/data.ts`:

**Kids parties** (category `kids-party`):
- Slime Party
- Painting Party
- Pottery Party
- Jewelry Making Party

**Adult parties** (category `adult-party`):
- Pottery Party
- Candle Making Party
- Knitting Party
- Watercolor Party

Each: one variation at $400 (40000 cents), no modifiers, placeholder imageUrl.

### Out of Scope

- Corporate party types / "Something Else" option (future pass)
- Per-type add-ons (all shared per category for now)
- Per-type capacity limits (all shared per category for now)
