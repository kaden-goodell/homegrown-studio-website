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
    // the dashed line in the cropper = the 2" face of the magnet; the outer 10% wraps (0.25" of 2.5")
    safeInset: 0.1,
    /** Filled by `scripts/seed-shop.ts --apply`. Empty = the order endpoint refuses (503). */
    square: {
      // Created 2026-11-09 by scripts/seed-shop.ts --apply (Kaden's go). Proven with orders/calculate:
      // 2 sets + shipping = 4524, tax 324 on magnets, 0 on shipping.
      itemId: 'OQ55HOQUPTO52WO7D2TOTQOH',
      variationId: 'ZD2OIIQVAEU2TGU2KXVBUCNT',
      shippingVariationId: 'MMWCGRPBR7OKBTA6CS3ADSWQ',
    },
  },
  maxPhotoBytes: 400_000,
  /** Room to re-crop: replaced photos still count until cleanup. */
  maxPhotosPerDraft: 120,
  draftRetentionHours: 24,
  photoRetentionDays: 30,
} as const

export type Delivery = 'pickup' | 'ship'

/** The shop shows on the live site only once its Square items exist (scripts/seed-shop.ts --apply). */
export const shopLive = (): boolean => Boolean(shopConfig.magnets.square.variationId && shopConfig.magnets.square.shippingVariationId)
