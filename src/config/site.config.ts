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
  nav?: NavItem[]
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
    name: 'Birthday Party',
    description: 'A creative birthday celebration with guided crafting activities',
    icon: 'cake',
    flow: 'booking',
    baseCapacity: 12,
    duration: 120,
    allowAddOns: true,
    allowExtraGuests: true,
    extraGuestPrice: 1500,
  },
]

export const siteConfig: SiteConfig = {
  name: 'Homegrown Craft Studio',
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
      primary: '#7c3aed',
      secondary: '#a78bfa',
      accent: '#f59e0b',
      background: '#faf5ff',
      text: '#1e1b4b',
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
    newsletter: true,
    coupons: true,
    gallery: true,
  },
  eventTypes: [
    ...partyTypes,
    {
      id: 'adult-workshop',
      name: 'Adult Workshop',
      description: 'Hands-on crafting workshops for adults',
      icon: 'palette',
      flow: 'booking',
      baseCapacity: 16,
      duration: 90,
      allowAddOns: true,
      allowExtraGuests: false,
    },
    {
      id: 'corporate',
      name: 'Corporate Event',
      description: 'Team-building and corporate crafting experiences',
      icon: 'briefcase',
      flow: 'quote',
      baseCapacity: 30,
      duration: 180,
      allowAddOns: true,
      allowExtraGuests: true,
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
  nav: [
    { label: 'Home', href: '/' },
    { label: 'Workshops', href: '/workshops' },
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
