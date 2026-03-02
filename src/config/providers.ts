import type { SiteConfig } from './site.config'
import { siteConfig } from './site.config'
import type { BookingProvider } from '@providers/interfaces/booking'
import type { PaymentProvider } from '@providers/interfaces/payment'
import type { CatalogProvider } from '@providers/interfaces/catalog'
import type { CapacityProvider } from '@providers/interfaces/capacity'
import type { CustomerProvider } from '@providers/interfaces/customer'
import type { NotificationProvider } from '@providers/interfaces/notification'
import { MockBookingProvider } from '@providers/mock/booking'
import { MockPaymentProvider } from '@providers/mock/payment'
import { MockCatalogProvider } from '@providers/mock/catalog'
import { MockCapacityProvider, NullCapacityProvider } from '@providers/mock/capacity'
import { MockCustomerProvider } from '@providers/mock/customer'
import { SlackNotificationProvider } from '@providers/slack/notification'

export interface Providers {
  booking: BookingProvider
  payment: PaymentProvider
  catalog: CatalogProvider
  capacity: CapacityProvider
  customer: CustomerProvider
  notification: NotificationProvider
}

export function createProviders(config: SiteConfig): Providers {
  const useMock = config.providers.booking.type === 'mock'

  return {
    booking: useMock
      ? new MockBookingProvider()
      : new MockBookingProvider(), // Square provider will replace this
    payment: useMock
      ? new MockPaymentProvider()
      : new MockPaymentProvider(), // Square provider will replace this
    catalog: useMock
      ? new MockCatalogProvider()
      : new MockCatalogProvider(), // Square provider will replace this
    capacity: config.providers.capacity.type === 'none'
      ? new NullCapacityProvider()
      : useMock
        ? new MockCapacityProvider()
        : new MockCapacityProvider(), // Square provider will replace this
    customer: useMock
      ? new MockCustomerProvider()
      : new MockCustomerProvider(), // Square provider will replace this
    notification: new SlackNotificationProvider(config.providers.notification.config),
  }
}

/** Singleton providers instance using the default site config */
export const providers: Providers = createProviders(siteConfig)
