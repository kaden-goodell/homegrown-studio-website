export interface SiteConfig {
  name: string
  tagline: string
  logo: string
  contactEmail: string
  contactPhone: string
  address: {
    street: string
    city: string
    state: string
    zip: string
  }
  theme: {
    colors: {
      primary: string
      secondary: string
      accent: string
      background: string
      text: string
      muted: string
    }
    fonts: {
      heading: string
      body: string
    }
    borderRadius: 'none' | 'sm' | 'md' | 'lg' | 'full'
    textures: {
      background: 'linen' | 'paper' | 'clean' | 'none'
      cards: 'soft-shadow' | 'bordered' | 'flat'
    }
    animations: {
      particles: boolean
      fadeIn: boolean
      hoverEffects: 'lift' | 'glow' | 'none'
    }
    style: 'organic' | 'minimal' | 'bold'
  }
  features: {
    workshops: boolean
    parties: {
      enabled: boolean
      types: EventTypeConfig[]
    }
    kits: {
      enabled: boolean
    }
    programs: {
      enabled: boolean
      types: ProgramConfig[]
    }
    newsletter: boolean
    coupons: boolean
    gallery: boolean
  }
  eventTypes: EventTypeConfig[]
  providers: {
    booking: { type: 'square' | 'mock'; config: SquareConfig | Record<string, never> }
    payment: { type: 'square' | 'mock'; config: SquareConfig | Record<string, never> }
    catalog: { type: 'square' | 'mock'; config: SquareConfig | Record<string, never> }
    capacity: { type: 'square-internal' | 'none'; config?: SquareInternalConfig }
    customer: { type: 'square' | 'mock'; config: SquareConfig | Record<string, never> }
    notification: { type: 'slack'; config: SlackConfig }
  }
  analytics: {
    provider: 'posthog' | 'plausible' | 'ga4' | 'none'
    config: Record<string, string>
  }
  testimonials?: {
    heading?: string
    items: { quote: string; name: string; detail: string }[]
  }
  nav?: NavItem[]
  /** Public walk-in hours, displayed in footer / Open Studio / homepage. */
  hours: { days: string; time: string }[]
  /** Grand-opening date (ISO). Drives the pre-launch banner; remove after opening. */
  openingDate: string
  /** Header call-to-action button (rendered as a pill, not a text link). */
  navCta: { label: string; href: string }
  email?: {
    fromAddress: string
    fromName: string
  }
}

export interface ProgramSessionConfig {
  id: string
  name: string
  startDate: string
  endDate: string
  catalogVariationId?: string
}

export interface ProgramConfig {
  id: string
  name: string
  description: string
  image?: string
  enrollmentType: 'per-session' | 'full'
  pricePerHead: number
  maxCapacity: number
  ageRange?: { min: number; max: number }
  schedule: {
    days: string
    time: string
    totalHours: number
  }
  sessions: ProgramSessionConfig[]
  catalogItemId?: string
  programDates: string
}

export interface EventTypeConfig {
  id: string
  name: string
  description: string
  icon?: string
  flow: 'booking' | 'quote'
  baseCapacity?: number
  duration: number
  allowAddOns: boolean
  allowExtraGuests: boolean
  extraGuestPrice?: number
  maxCapacity?: number
  basePrice?: number
  catalogItemId?: string
  catalogCategory?: string
}

export interface SquareConfig {
  accessToken: string
  environment: 'sandbox' | 'production'
  locationId: string
  applicationId: string
}

export interface SquareInternalConfig {
  unitToken: string
}

export interface SlackConfig {
  webhookUrl: string
  channel?: string
}

export interface NavItem {
  label: string
  href: string
  icon?: string
}

// Vite/Astro loads .env into import.meta.env for server-side code;
// process.env is available in production runtimes (Netlify) and scripts.
const env = typeof import.meta !== 'undefined' && (import.meta as any).env
  ? (import.meta as any).env
  : typeof process !== 'undefined' ? process.env : {}

const providerMode = env.PROVIDER_MODE || 'mock'

// Never let demo copy/data ship: a production BUILD without an explicit
// PROVIDER_MODE is a deploy misconfiguration, not a fallback.
// ALLOW_MOCK_PROVIDER=1 is the local escape hatch for `npm run build` without
// Square creds — never set it in Netlify.
if (env.PROD && providerMode === 'mock' && !env.ALLOW_MOCK_PROVIDER) {
  throw new Error('PROVIDER_MODE is unset/mock in a production build — set PROVIDER_MODE=square in the Netlify environment (or ALLOW_MOCK_PROVIDER=1 for a local build).')
}

const isSquare = providerMode === 'square'

const squareConfig: SquareConfig | Record<string, never> = isSquare
  ? {
      accessToken: env.SQUARE_ACCESS_TOKEN || '',
      environment: (env.SQUARE_ENVIRONMENT as 'sandbox' | 'production') || 'sandbox',
      locationId: env.SQUARE_LOCATION_ID || '',
      applicationId: env.SQUARE_APPLICATION_ID || '',
    }
  : {}

const partyTypes: EventTypeConfig[] = [
  {
    id: 'party',
    name: 'Private Party',
    description: 'The whole studio for your group — pick a craft, pick a date, and make something together.',
    icon: 'sparkles',
    flow: 'booking',
    baseCapacity: 10,
    duration: 90,
    allowAddOns: false,
    allowExtraGuests: true,
    extraGuestPrice: 0, // crafts are per-head, settled at the studio
    maxCapacity: 30,
    basePrice: 30000, // $300 flat studio fee — must match partyConfig.basePriceCents
    catalogItemId: 'ZMSLASCRBGJ7JE3MJVOVJUSA',
    catalogCategory: 'party',
  },
]

export const siteConfig: SiteConfig = {
  name: 'Homegrown Studio',
  tagline: 'Create. Celebrate. Connect.',
  logo: '/images/logo.svg',
  contactEmail: 'contact@homegrowncraftstudio.com', // real Workspace alias; hello@ does not exist
  contactPhone: '(256) 464-1710',
  address: {
    street: '525 Hughes Rd, Suite F',
    city: 'Madison',
    state: 'AL',
    zip: '35758',
  },
  hours: [
    { days: 'Thursday & Friday', time: '4 – 9 PM' },
    { days: 'Saturday', time: '9 AM – 9 PM' },
    { days: 'Sunday', time: '2 – 8 PM' },
  ],
  openingDate: '2026-09-01',
  theme: {
    colors: {
      primary: '#96705B',
      secondary: '#c4a882',
      accent: '#d4a574',
      background: '#faf8f5',
      text: '#374151',
      muted: '#6b7280',
    },
    fonts: {
      heading: 'Playfair Display',
      body: 'Inter',
    },
    borderRadius: 'md',
    textures: {
      background: 'linen',
      cards: 'soft-shadow',
    },
    animations: {
      particles: true,
      fadeIn: true,
      hoverEffects: 'lift',
    },
    style: 'organic',
  },
  features: {
    workshops: true,
    parties: {
      enabled: true,
      types: partyTypes,
    },
    kits: {
      enabled: false,
    },
    programs: {
      enabled: false,
      types: [
        {
          id: 'summer-camp',
          name: 'Summer Art Camp',
          description:
            'A week of creative exploration — painting, pottery, mixed media, and more. Kids build skills and confidence while making friends in a supportive studio environment.',
          enrollmentType: 'per-session',
          pricePerHead: 22500,
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
          programDates: '',
        },
        {
          id: 'homeschool-spring',
          name: 'Homeschool Studio Days',
          description:
            'A full semester of weekly art enrichment for homeschool families. Each Thursday brings a new medium and project — from watercolor to weaving.',
          enrollmentType: 'full',
          pricePerHead: 45000,
          maxCapacity: 10,
          ageRange: { min: 5, max: 14 },
          schedule: {
            days: 'Every Thursday',
            time: '10:00 AM – 1:00 PM',
            totalHours: 3,
          },
          sessions: [
            {
              id: 'homeschool-spring-26',
              name: 'Spring 2026 Semester',
              startDate: '2026-03-05',
              endDate: '2026-05-21',
            },
          ],
          programDates: '',
        },
        {
          id: 'winter-break-camp',
          name: 'Winter Break Camp',
          description:
            'Creative fun while school is out. Kids stay busy with holiday crafts, ceramics, and collaborative art projects.',
          enrollmentType: 'per-session',
          pricePerHead: 17500,
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
          programDates: '',
        },
      ],
    },
    newsletter: true,
    coupons: true,
    gallery: false,
  },
  eventTypes: [
    ...partyTypes,
    {
      id: 'corporate',
      name: 'Corporate Event',
      description: 'Custom team-building craft experiences for corporate groups',
      icon: 'briefcase',
      flow: 'quote',
      baseCapacity: 30,
      duration: 180,
      allowAddOns: true,
      allowExtraGuests: true,
      catalogItemId: undefined,
    },
  ],
  providers: {
    booking: { type: isSquare ? 'square' : 'mock', config: squareConfig },
    payment: { type: isSquare ? 'square' : 'mock', config: squareConfig },
    catalog: { type: isSquare ? 'square' : 'mock', config: squareConfig },
    capacity: {
      type: isSquare ? 'square-internal' : 'none',
      ...(isSquare && {
        config: {
          unitToken: env.SQUARE_UNIT_TOKEN || '',
        },
      }),
    },
    customer: { type: isSquare ? 'square' : 'mock', config: squareConfig },
    notification: {
      type: 'slack',
      config: {
        webhookUrl: env.SLACK_WEBHOOK_URL || '',
        channel: '#bookings',
      },
    },
  },
  analytics: {
    provider: 'posthog',
    config: {
      apiKey: env.POSTHOG_API_KEY || '',
      host: env.POSTHOG_HOST || 'https://app.posthog.com',
    },
  },
  testimonials: {
    heading: 'What Our Guests Say',
    items: [],
  },
  email: {
    fromAddress: 'contact@homegrowncraftstudio.com', // display-only; actual SMTP sender is GMAIL_USER
    fromName: 'Homegrown Studio',
  },
  nav: [
    { label: 'Open Studio', href: '/open-studio' },
    { label: 'Workshops', href: '/workshops' },
    { label: 'Parties', href: '/book' },
    { label: "What's On", href: '/calendar' },
    { label: 'About', href: '/about' },
  ],
  navCta: { label: 'Book a Party', href: '/book' },
}

export function validateConfig(config: SiteConfig): void {
  if (!config.name) {
    throw new Error('name is required')
  }
}

/**
 * Square's published buyer-facing class-booking widget app ID. Required by
 * the buyer `class_bookings` API to accept Web Payments SDK tokens — the
 * merchant app ID is rejected (see square-class-bookings memory).
 * Used by WorkshopBookingModal and the reservations PaymentStep.
 * Set unconditionally so mock/dev mode still passes it to PaymentForm.
 */
export const CLASS_BOOKING_APP_ID = 'sq0idp-0WpGrONcXfCcfav3Lkd9Jg'
