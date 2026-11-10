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
      // Created 2026-11-09 by scripts/seed-shop.ts --apply (Kaden's go). Proven with orders/calculate:
      // 2 sets + shipping = 4524, tax 324 on magnets, 0 on shipping.
      itemId: 'OQ55HOQUPTO52WO7D2TOTQOH',
      variationId: 'ZD2OIIQVAEU2TGU2KXVBUCNT',
      shippingVariationId: 'MMWCGRPBR7OKBTA6CS3ADSWQ',
    },
  },
  /**
   * Framed silhouette portraits (Kaden, 2026-11-10): $25 each in a gold frame, decorating the
   * frame in the studio is optional and included. The site cuts the child out of a side-profile
   * photo in the browser and prints a black silhouette on white, 2"×3" for a mini photo printer.
   */
  silhouettes: {
    name: 'Framed Silhouette',
    priceCents: 2500,
    maxCount: 6,
    taxPercent: 9,
    taxId: 'XKZ3OIRJ3SPPO4TO64UUDFA4',
    readyDays: 7,
    /** 2"×3" portrait at 400 dpi. */
    outputW: 800,
    outputH: 1200,
    /** Kept clear on every side so the frame's lip never covers the silhouette or the name, inches. */
    safeInsetIn: 0.125,
    /**
     * Created 2026-11-10 by scripts/seed-shop.ts --apply. Proven with orders/calculate: 2 + shipping = 6050,
     * tax 450 on silhouettes, 0 on shipping. Set = silhouettes go live with the next prod push.
     */
    square: { itemId: 'DPEZPIIIHFDKGQMG6XR2CXLV', variationId: '67RT4IYJNH3W7L7DUVQVY3O5' },
  },
  maxPhotoBytes: 400_000,
  /** Room to re-crop: replaced photos still count until cleanup. */
  maxPhotosPerDraft: 120,
  draftRetentionHours: 24,
  photoRetentionDays: 30,
} as const

export type Delivery = 'pickup' | 'ship'
export type ShopProduct = 'magnets' | 'silhouettes'

/** The shop shows on the live site only once its Square items exist (scripts/seed-shop.ts --apply). */
export const shopLive = (): boolean => Boolean(shopConfig.magnets.square.variationId && shopConfig.magnets.square.shippingVariationId)

/** Silhouettes show on the live site only once their Square item exists (shipping reuses the magnets' item). */
export const silhouettesLive = (): boolean => shopLive() && Boolean(shopConfig.silhouettes.square.variationId)
