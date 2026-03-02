import { SquareClient } from 'square'
import type { Customer, CustomerProvider } from '@providers/interfaces/customer'
import type { SquareConfig } from '@config/site.config'
import { createLogger } from '@lib/logger'

const logger = createLogger('square-customer')

export class SquareCustomerProvider implements CustomerProvider {
  private client: SquareClient

  constructor(config: SquareConfig) {
    this.client = new SquareClient({
      token: config.accessToken,
    })
  }

  async findOrCreate(params: {
    email: string
    givenName: string
    familyName: string
    phone?: string
  }): Promise<Customer> {
    // Step 1: Search for existing customer by email
    const searchResult = await this.client.customers.search({
      query: {
        filter: {
          emailAddress: {
            exact: params.email,
          },
        },
      },
    })

    if (searchResult.customers && searchResult.customers.length > 0) {
      const existing = searchResult.customers[0]
      logger.info('Found existing customer', { email: params.email, id: existing.id })
      return mapSquareCustomer(existing)
    }

    // Step 2: Create new customer
    try {
      const createResult = await this.client.customers.create({
        givenName: params.givenName,
        familyName: params.familyName,
        emailAddress: params.email,
        phoneNumber: params.phone,
      })

      logger.info('Created new customer', { email: params.email, id: createResult.customer?.id })
      return mapSquareCustomer(createResult.customer!)
    } catch (error: any) {
      // Step 3: Handle race condition — new profiles can take up to 30s to be searchable.
      // If create fails with a duplicate error, retry search once.
      if (isDuplicateError(error)) {
        logger.warn('Duplicate customer detected, retrying search', { email: params.email })

        const retryResult = await this.client.customers.search({
          query: {
            filter: {
              emailAddress: {
                exact: params.email,
              },
            },
          },
        })

        if (retryResult.customers && retryResult.customers.length > 0) {
          const found = retryResult.customers[0]
          logger.info('Found customer on retry', { email: params.email, id: found.id })
          return mapSquareCustomer(found)
        }
      }

      throw error
    }
  }

  async subscribe(email: string): Promise<void> {
    // Search for existing customer first, only create if not found
    const searchResult = await this.client.customers.search({
      query: {
        filter: {
          emailAddress: { exact: email },
        },
      },
    })

    if (searchResult.customers && searchResult.customers.length > 0) {
      logger.info('Customer already exists for subscription', { email })
      return
    }

    // Create a minimal customer record for newsletter subscription
    await this.client.customers.create({
      emailAddress: email,
    })
    logger.info('Subscribed customer', { email })
  }
}

function mapSquareCustomer(sq: any): Customer {
  return {
    id: sq.id,
    email: sq.emailAddress,
    givenName: sq.givenName,
    familyName: sq.familyName,
    phone: sq.phoneNumber,
  }
}

function isDuplicateError(error: any): boolean {
  // Square API returns error codes for duplicate customers
  if (error?.errors) {
    return error.errors.some(
      (e: any) => e.code === 'CONFLICT' || e.code === 'DUPLICATE_ENTRY'
    )
  }
  // Also check status code
  if (error?.statusCode === 409) {
    return true
  }
  return false
}
