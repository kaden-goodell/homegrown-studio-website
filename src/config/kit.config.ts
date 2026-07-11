/** Numbers for the take-home kit product. Content/copy lives in kit-content.ts. */
export const kitConfig = {
  /** Assembly fee, always charged, one per order. */
  assemblyFeeCents: 5000,
  /** Package tiers offered at launch. Tier price + deposit by tier size. */
  // Two package prices per tier, on purpose:
  //  - packagePriceCents: the IN-STUDIO themed-table add-on (party flow +
  //    shared Square variations) — staff set the table, no packing happens.
  //  - kitPackagePriceCents: the TAKE-HOME price, $50 higher — packing/labels/
  //    prep folded in so the kit receipt carries no separate service line
  //    (Kaden + wife, 2026-07-11 late: "include it in the cost").
  // Deposit scales with the tableware lent (~$15/setting replacement): losing
  // a serves-20 costs ~$300 in settings AND a third of a theme's fleet, so the
  // return incentive grows with kit size.
  tiers: [
    { serves: 10, packagePriceCents: 7500, kitPackagePriceCents: 12500, depositCents: 5000 },
    { serves: 15, packagePriceCents: 10000, kitPackagePriceCents: 15000, depositCents: 7500 },
    { serves: 20, packagePriceCents: 12500, kitPackagePriceCents: 17500, depositCents: 10000 },
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
    // Seeded 2026-07-11 by scripts/seed-kits.ts (idempotent — re-run after price/theme edits).
    assemblyItemId: 'EBNQG4CCE7MSIMB46XLPEX6Q',
    assemblyVariationId: '55KMJXR64K5KQ6DQ7ND6PTFO',
    packageItemId: 'WPHWAZ4KMBWFQDLIZMJZBV3B',
    depositItemId: 'UWYGIKNJ2S2QPF2RVX7FANLW',
    /** themeId -> { tierServes -> variationId } */
    packageVariations: {
      'gilded': { 10: 'A37CUKG2PWIK5V6S2PXE2ZJD', 15: '44BTSJOQIPMN6SBVUK3Q5EZH', 20: '2F2GAE2ICW7IKZVTYEDXBSPP' },
      'prism': { 10: '5KDVKBTS3DC2G5WJYWOBWAAI', 15: 'O5RIATOPVNARTSA7S6NZAWIQ', 20: 'ZBHSPDA4KKY4U4K62BO5CN7R' },
      'sweet-sixteen': { 10: 'QLTWFALFUYBMKUXGSUVB2BTL', 15: 'AYCOZL4CNEIMDDLD2ICNI2OH', 20: 'V45PVQT7CDTRS6C4JDFWRRVD' },
    } as Record<string, Record<number, string>>,
    /** serves -> deposit variation id */
    depositVariations: { 10: 'ZP6ZYPUZ44R4SP2XWTYZV6TE', 15: 'NEOM4WKIYS6QTDCFBDKVXZCB', 20: 'YLLVFK73DTVWODC3ETAFEGAF' } as Record<number, string>,
  },
} as const
