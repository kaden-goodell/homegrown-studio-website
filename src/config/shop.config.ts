/**
 * The online shop (Kaden, 2026-11-09). First product: 2"×2" photo magnets,
 * sold in sets of 6. The server prices every order from here — never from
 * the browser.
 */
export const shopConfig = {
  magnets: {
    name: 'Photo Magnets',
    setSize: 6,
    setPriceCents: 1800,
    maxSets: 10,
    shippingCents: 600,
    /** The 9% tax on the Square item (XKZ3OIRJ3SPPO4TO64UUDFA4). Shipping is untaxed. */
    taxPercent: 9,
    taxId: 'XKZ3OIRJ3SPPO4TO64UUDFA4',
    readyDays: 7,
    /** Each finished magnet photo: 2" at 300 dpi. */
    outputPx: 600,
    /** Below this many source pixels across the crop the print may look soft. */
    minSharpSourcePx: 400,
    /** Dashed safe-area line, as a fraction of the square kept clear on each side. */
    safeInset: 0.08,
    /** Filled by `scripts/seed-shop.ts --apply`. Empty = the order endpoint refuses (503). */
    square: {
      itemId: '',
      variationId: '',
      shippingVariationId: '',
    },
  },
  maxPhotoBytes: 400_000,
  maxPhotosPerDraft: 60,
  draftRetentionHours: 24,
  photoRetentionDays: 30,
} as const

export type Delivery = 'pickup' | 'ship'
