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
  instructorEmail: string
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

const providerMode = (typeof process !== 'undefined' && process.env?.PROVIDER_MODE) || 'mock'
const isSquare = providerMode === 'square'

const squareConfig: SquareConfig | Record<string, never> = isSquare
  ? {
      accessToken: process.env.SQUARE_ACCESS_TOKEN || '',
      environment: (process.env.SQUARE_ENVIRONMENT as 'sandbox' | 'production') || 'sandbox',
      locationId: process.env.SQUARE_LOCATION_ID || '',
      applicationId: process.env.SQUARE_APPLICATION_ID || '',
    }
  : {}

const partyTypes: EventTypeConfig[] = [
  {
    id: 'birthday',
    name: 'Kids Party',
    description: 'A creative party celebration with guided crafting activities for kids',
    icon: 'cake',
    flow: 'booking',
    baseCapacity: 12,
    duration: 120,
    allowAddOns: true,
    allowExtraGuests: true,
    extraGuestPrice: 2500, // $25 per extra child
    maxCapacity: 20,
    basePrice: 40000, // $400
    catalogItemId: 'birthday-party-package',
  },
  {
    id: 'adult-party',
    name: 'Adult Party',
    description: 'Host a private craft workshop for your group with drinks and snacks included',
    icon: 'wine',
    flow: 'booking',
    baseCapacity: 12,
    duration: 150,
    allowAddOns: true,
    allowExtraGuests: true,
    extraGuestPrice: 3000, // $30 per extra guest
    maxCapacity: 36,
    basePrice: 40000, // $400
    catalogItemId: 'adult-party-package',
  },
]

export const siteConfig: SiteConfig = {
  name: 'Homegrown Studio',
  tagline: 'Create. Celebrate. Connect.',
  logo: '/images/logo.svg',
  contactEmail: 'hello@homegrowncraftstudio.com',
  contactPhone: '(555) 123-4567',
  address: {
    street: '123 Main St',
    city: 'Anytown',
    state: 'CA',
    zip: '90210',
  },
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
    programs: {
      enabled: true,
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
          instructorEmail: 'instructor@homegrowncraftstudio.com',
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
          instructorEmail: 'instructor@homegrowncraftstudio.com',
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
          instructorEmail: 'instructor@homegrowncraftstudio.com',
        },
      ],
    },
    newsletter: true,
    coupons: true,
    gallery: true,
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
          unitToken: process.env.SQUARE_UNIT_TOKEN || '',
        },
      }),
    },
    customer: { type: isSquare ? 'square' : 'mock', config: squareConfig },
    notification: {
      type: 'slack',
      config: {
        webhookUrl: (typeof process !== 'undefined' && process.env?.SLACK_WEBHOOK_URL) || '',
        channel: '#bookings',
      },
    },
  },
  analytics: {
    provider: 'posthog',
    config: {
      apiKey: (typeof process !== 'undefined' && process.env?.POSTHOG_API_KEY) || '',
      host: (typeof process !== 'undefined' && process.env?.POSTHOG_HOST) || 'https://app.posthog.com',
    },
  },
  testimonials: {
    heading: 'What Our Guests Say',
    items: [
      {
        quote: 'The kids party was amazing! They had so much fun and the staff was incredible.',
        name: 'Sarah M.',
        detail: 'Kids Party',
      },
      {
        quote: 'Such a relaxing and creative experience. I will definitely be back for more workshops.',
        name: 'Emily R.',
        detail: 'Adult Party',
      },
      {
        quote: 'Our team building event was the best one we have ever had. Everyone loved it.',
        name: 'David L.',
        detail: 'Corporate Event',
      },
    ],
  },
  email: {
    fromAddress: 'hello@homegrowncraftstudio.com',
    fromName: 'Homegrown Studio',
  },
  nav: [
    { label: 'Home', href: '/' },
    { label: 'Workshops', href: '/workshops' },
    { label: 'Programs', href: '/programs' },
    { label: 'Book a Party', href: '/book' },
    { label: 'Gallery', href: '/gallery' },
    { label: 'About', href: '/about' },
  ],
}

export function validateConfig(config: SiteConfig): void {
  if (!config.name) {
    throw new Error('name is required')
  }
}
