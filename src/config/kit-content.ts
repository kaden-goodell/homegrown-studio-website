export interface KitTheme {
  id: string            // stable slug, used in kitConfig.square.packageVariations keys
  displayName: string
  tagline: string
  scheme: string        // 'gold' | 'rainbow' | ... (styling hook)
  photo: string         // placeholder until Kaden's real shots
  /** Stocked themes are bookable; others render as waitlist cards (notify-me). */
  stocked: boolean
  /** Weekly settings ledger inputs (stocked themes only). */
  ownedSettings: number
  heroSets: number
  /** Contents card lists (draft — Kaden refines in NEEDS-FROM-KADEN). */
  keeps: string[]       // consumables the customer keeps
  returns: string[]     // rental pieces that come back
  /** Styling variant of another theme: shares that theme's ledger (same physical tableware). */
  ledgerThemeId?: string
}

export const kitThemes: KitTheme[] = [
  {
    id: 'gilded', displayName: 'The Gilded Table', tagline: 'Warm gold, candlelight, and celebration',
    scheme: 'gold', photo: '/images/party-hero.jpg', stocked: true, ownedSettings: 45, heroSets: 3,
    keeps: ['Napkins', 'Candles'], returns: ['Liberty-print plates', 'Cake stand', 'Trays', 'Candle holders'],
  },
  {
    id: 'prism', displayName: 'The Prism Table', tagline: 'Every color invited',
    scheme: 'rainbow', photo: '/images/party-hero.jpg', stocked: true, ownedSettings: 45, heroSets: 3,
    keeps: ['Napkins', 'Candles'], returns: ['Liberty-print plates', 'Cake stand', 'Trays', 'Candle holders'],
  },
  {
    id: 'sweet-sixteen', displayName: 'The Sweet Sixteen', tagline: 'Sixteen only happens once',
    scheme: 'sweet-sixteen', photo: '/images/party-hero.jpg', stocked: true, ownedSettings: 0, heroSets: 0,
    keeps: ['Napkins', 'Candles', 'Sweet-sixteen details'], returns: ['Liberty-print plates', 'Cake stand', 'Trays', 'Candle holders'],
    ledgerThemeId: 'gilded', // styling variant: consumes Gilded's tableware
  },
  { id: 'sterling', displayName: 'The Sterling Table', tagline: 'Polished, cool, and effortlessly elegant', scheme: 'silver', photo: '/images/party-hero.jpg', stocked: false, ownedSettings: 0, heroSets: 0, keeps: [], returns: [] },
  { id: 'bluebell', displayName: 'The Bluebell Table', tagline: 'Fresh blues straight out of an English garden', scheme: 'blue', photo: '/images/party-hero.jpg', stocked: false, ownedSettings: 0, heroSets: 0, keeps: [], returns: [] },
  { id: 'linen', displayName: 'The Linen Table', tagline: 'Soft naturals for gatherings that glow quietly', scheme: 'neutral', photo: '/images/party-hero.jpg', stocked: false, ownedSettings: 0, heroSets: 0, keeps: [], returns: [] },
]

export const kitContent = {
  hero: {
    eyebrow: 'Take-Home Party Kits',
    headline: 'The party, boxed and beautiful',
    subline: 'Crafts for everyone, a styled table worth photographing, and nothing to plan. Pick up Thursday — we take it from there.',
  },
  howItWorks: [
    { n: '1', title: 'Book with a $50 deposit', text: 'Kits need 7 days of love and assembly — $50 holds your week, the rest at pickup.' },
    { n: '2', title: 'Pick up Thursday', text: 'Everything packed, styled, and labeled — crafts, table, the works. Settle the balance when you grab it.' },
    { n: '3', title: 'Party, then return the pretties', text: 'Keep the crafts and consumables. Rental pieces come home to us by Wednesday, 4–6 PM.' },
  ],
  depositLine: 'Fully refunded when the rental pieces come home clean by Wednesday.',
  /** Shown inline above the rental-terms checkbox — the customer must be able
   *  to READ what they're agreeing to. Keep in sync with WAIVER.md §6a; the
   *  full agreement rides along with the pickup paperwork. */
  rentalTermsBrief: [
    'The rental pieces (your kit lists them) come home to us by Wednesday, 4–6 PM.',
    'Your $50 deposit is refunded in full when they’re back, clean and complete.',
    'Missing, damaged, or dirty pieces may be deducted from the deposit.',
    'If we have to come collect the pieces, a $25 retrieval fee comes out of the deposit.',
  ],
  earlyDropLine: 'Need a different drop-off time? Reach out and we’ll try — no promises we can make anything work.',
  faq: [] as { q: string; a: string }[], // TODO(Kaden): kit FAQ copy
} as const
