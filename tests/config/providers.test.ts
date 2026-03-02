import { describe, it, expect } from 'vitest'
import { createProviders } from '@config/providers'
import { siteConfig } from '@config/site.config'
import type { SiteConfig } from '@config/site.config'
import { MockBookingProvider } from '@providers/mock/booking'
import { MockPaymentProvider } from '@providers/mock/payment'
import { MockCatalogProvider } from '@providers/mock/catalog'
import { MockCapacityProvider } from '@providers/mock/capacity'
import { NullCapacityProvider } from '@providers/mock/capacity'
import { MockCustomerProvider } from '@providers/mock/customer'
import { SlackNotificationProvider } from '@providers/slack/notification'

describe('createProviders', () => {
  it('returns all mock providers with default config', () => {
    const providers = createProviders(siteConfig)
    expect(providers.booking).toBeInstanceOf(MockBookingProvider)
    expect(providers.payment).toBeInstanceOf(MockPaymentProvider)
    expect(providers.catalog).toBeInstanceOf(MockCatalogProvider)
    expect(providers.customer).toBeInstanceOf(MockCustomerProvider)
    expect(providers.notification).toBeInstanceOf(SlackNotificationProvider)
  })

  it('returns NullCapacityProvider when capacity type is none', () => {
    const config: SiteConfig = {
      ...siteConfig,
      providers: {
        ...siteConfig.providers,
        capacity: { type: 'none' },
      },
    }
    const providers = createProviders(config)
    expect(providers.capacity).toBeInstanceOf(NullCapacityProvider)
  })

  it('returns MockCapacityProvider when capacity type is square-internal and booking is mock', () => {
    const config: SiteConfig = {
      ...siteConfig,
      providers: {
        ...siteConfig.providers,
        capacity: { type: 'square-internal' },
      },
    }
    const providers = createProviders(config)
    expect(providers.capacity).toBeInstanceOf(MockCapacityProvider)
  })

  it('all providers have the correct methods', () => {
    const providers = createProviders(siteConfig)
    // booking
    expect(typeof providers.booking.searchAvailability).toBe('function')
    expect(typeof providers.booking.createBooking).toBe('function')
    expect(typeof providers.booking.getBooking).toBe('function')
    expect(typeof providers.booking.cancelBooking).toBe('function')
    // payment
    expect(typeof providers.payment.createOrder).toBe('function')
    expect(typeof providers.payment.processPayment).toBe('function')
    expect(typeof providers.payment.getClientConfig).toBe('function')
    // catalog
    expect(typeof providers.catalog.getEventTypes).toBe('function')
    expect(typeof providers.catalog.getAddOns).toBe('function')
    expect(typeof providers.catalog.getPricing).toBe('function')
    // capacity
    expect(typeof providers.capacity.getAvailableCapacity).toBe('function')
    // customer
    expect(typeof providers.customer.findOrCreate).toBe('function')
    expect(typeof providers.customer.subscribe).toBe('function')
    // notification
    expect(typeof providers.notification.send).toBe('function')
  })
})
