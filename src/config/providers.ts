import type { SiteConfig, SquareConfig } from './site.config'
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
import { SquareBookingProvider } from '@providers/square/booking'
import { SquarePaymentProvider } from '@providers/square/payment'
import { SquareCatalogProvider } from '@providers/square/catalog'
import { SquareInternalCapacityProvider } from '@providers/square/capacity'
import { SquareCustomerProvider } from '@providers/square/customer'

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
  const notification = new SlackNotificationProvider(config.providers.notification.config)

  return {
    booking: useMock
      ? new MockBookingProvider()
      : new SquareBookingProvider(config.providers.booking.config as SquareConfig),
    payment: useMock
      ? new MockPaymentProvider()
      : new SquarePaymentProvider(config.providers.payment.config as SquareConfig),
    catalog: useMock
      ? new MockCatalogProvider()
      : new SquareCatalogProvider(config.providers.catalog.config as SquareConfig),
    capacity: config.providers.capacity.type === 'none'
      ? new NullCapacityProvider()
      : useMock
        ? new MockCapacityProvider()
        : new SquareInternalCapacityProvider(config.providers.capacity.config!, notification),
    customer: useMock
      ? new MockCustomerProvider()
      : new SquareCustomerProvider(config.providers.customer.config as SquareConfig),
    notification,
  }
}

/** Singleton providers instance using the default site config */
export const providers: Providers = createProviders(siteConfig)
