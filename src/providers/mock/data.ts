import type { EventType } from '@providers/interfaces/catalog'

export const mockEventTypes: EventType[] = [
  {
    id: 'workshop-candle',
    name: 'Candle Making Workshop',
    description: 'Learn to create beautiful hand-poured soy candles with custom scents and colors.',
    category: 'workshop',
    duration: 90,
    baseCapacity: 12,
    flow: 'booking',
    variations: [
      { id: 'candle-standard', name: 'Standard (1 candle)', priceAmount: 4500, priceCurrency: 'USD' },
      { id: 'candle-deluxe', name: 'Deluxe (3 candles)', priceAmount: 7500, priceCurrency: 'USD' },
    ],
    modifiers: [],
  },
  {
    id: 'workshop-pottery',
    name: 'Pottery Basics',
    description: 'Get your hands dirty with wheel-thrown pottery basics. All skill levels welcome.',
    category: 'workshop',
    duration: 120,
    baseCapacity: 8,
    flow: 'booking',
    variations: [
      { id: 'pottery-standard', name: 'Standard', priceAmount: 5500, priceCurrency: 'USD' },
    ],
    modifiers: [],
  },
  {
    id: 'party-birthday',
    name: 'Kids Birthday Party',
    description: 'A fun-filled craft birthday party for kids with a dedicated party host.',
    category: 'birthday',
    duration: 120,
    baseCapacity: 12,
    flow: 'booking',
    variations: [
      { id: 'birthday-base', name: 'Base Package (up to 12 kids)', priceAmount: 35000, priceCurrency: 'USD' },
    ],
    modifiers: [
      { id: 'birthday-extra-child', name: 'Extra Child', priceAmount: 2500, priceCurrency: 'USD' },
      { id: 'birthday-goodie-bag', name: 'Goodie Bags', priceAmount: 800, priceCurrency: 'USD' },
      { id: 'birthday-extra-craft', name: 'Extra Craft Activity', priceAmount: 1200, priceCurrency: 'USD' },
      { id: 'birthday-chocolate-fountain', name: 'Chocolate Fountain', priceAmount: 7500, priceCurrency: 'USD' },
      { id: 'birthday-balloon-arch', name: 'Balloon Arch', priceAmount: 5000, priceCurrency: 'USD' },
      { id: 'birthday-extra-time', name: 'Extra 30 Minutes', priceAmount: 10000, priceCurrency: 'USD' },
    ],
  },
  {
    id: 'party-adult',
    name: 'Adult Workshop Party',
    description: 'Host a private craft workshop for your group with drinks and snacks included.',
    category: 'party',
    duration: 150,
    baseCapacity: 10,
    flow: 'booking',
    variations: [
      { id: 'adult-party-base', name: 'Base Package (up to 10 guests)', priceAmount: 40000, priceCurrency: 'USD' },
    ],
    modifiers: [
      { id: 'adult-extra-guest', name: 'Extra Guest', priceAmount: 3000, priceCurrency: 'USD' },
      { id: 'adult-premium-materials', name: 'Premium Materials Upgrade', priceAmount: 1000, priceCurrency: 'USD' },
      { id: 'adult-chocolate-fountain', name: 'Chocolate Fountain', priceAmount: 7500, priceCurrency: 'USD' },
      { id: 'adult-balloon-arch', name: 'Balloon Arch', priceAmount: 5000, priceCurrency: 'USD' },
      { id: 'adult-extra-time', name: 'Extra 30 Minutes', priceAmount: 10000, priceCurrency: 'USD' },
    ],
  },
  {
    id: 'corporate-event',
    name: 'Corporate Team Building',
    description: 'Custom team-building craft experiences for corporate groups. Contact us for pricing.',
    category: 'corporate',
    duration: 180,
    baseCapacity: 30,
    flow: 'quote',
    variations: [
      { id: 'corporate-placeholder', name: 'Custom Quote', priceAmount: 0, priceCurrency: 'USD' },
    ],
    modifiers: [],
  },
]
