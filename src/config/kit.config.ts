/** Numbers for the take-home kit product. Content/copy lives in kit-content.ts. */
export const kitConfig = {
  /** Assembly fee, always charged, one per order. */
  assemblyFeeCents: 5000,
  /** Package tiers offered at launch. Tier price + deposit by tier size. */
  tiers: [
    { serves: 10, packagePriceCents: 7500, depositCents: 5000 },
    { serves: 15, packagePriceCents: 10000, depositCents: 7500 },
    { serves: 20, packagePriceCents: 12500, depositCents: 10000 },
  ],
  minGuests: 10,
  /** Max guests when a package is selected (largest tier). Crafts-only orders share the cap for assembly sanity. */
  maxGuests: 20,
  /** Order cutoff: days between order time and pickup Thursday. */
  leadTimeDays: 7,
  /** Horizon for the party-date picker. */
  bookingWindowDays: 90,
  /** Wednesday drop-off window (display only). */
  returnWindow: '4–6 PM',
  /** Deducted from deposit if we have to go get the pieces (agreement §6a(b)). */
  retrievalFeeCents: 2500,
  timezone: 'America/Chicago',
  square: {
    // Filled by scripts/seed-kits.ts output; empty string = kits API returns 503 (not seeded yet).
    assemblyItemId: '',
    assemblyVariationId: '',
    packageItemId: '',
    depositItemId: '',
    /** themeId -> { tierServes -> variationId } */
    packageVariations: {} as Record<string, Record<number, string>>,
    /** serves -> deposit variation id */
    depositVariations: {} as Record<number, string>,
  },
} as const
