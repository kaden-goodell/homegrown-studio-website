import type { Customer, CustomerNote, CustomerProvider } from '@providers/interfaces/customer'
import type { SquareConfig } from '@config/site.config'
import { createLogger } from '@lib/logger'
import { createSquareClient } from './client'

const logger = createLogger('square-customer')

export class SquareCustomerProvider implements CustomerProvider {
  private client: ReturnType<typeof createSquareClient>

  constructor(config: SquareConfig) {
    this.client = createSquareClient(config)
  }

  async createGuest(params: { givenName: string; familyName: string; note: string }): Promise<Customer> {
    const res = await this.client.customers.create({ givenName: params.givenName, familyName: params.familyName, note: params.note })
    logger.info('Created guest customer', { id: res.customer?.id })
    return mapSquareCustomer(res.customer!)
  }

  async findOrCreate(params: {
    email: string
    givenName: string
    familyName?: string
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

    // Step 1b: No email match — try phone, so a returning customer using a
    // different email still resolves to their existing profile.
    const e164 = toE164(params.phone)
    if (e164) {
      const phoneResult = await this.client.customers.search({
        query: {
          filter: {
            phoneNumber: { exact: e164 },
          },
        },
      })
      if (phoneResult.customers && phoneResult.customers.length > 0) {
        const existing = phoneResult.customers[0]
        logger.info('Found existing customer by phone', { phone: e164, id: existing.id })
        return mapSquareCustomer(existing)
      }
    }

    // Step 2: Create new customer
    try {
      const createResult = await this.client.customers.create({
        givenName: params.givenName,
        ...(params.familyName ? { familyName: params.familyName } : {}),
        emailAddress: params.email,
        ...(params.phone ? { phoneNumber: params.phone } : {}),
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

  async subscribe(email: string, note?: string): Promise<void> {
    // Search for existing customer first, only create if not found
    const searchResult = await this.client.customers.search({
      query: {
        filter: {
          emailAddress: { exact: email },
        },
      },
    })

    const existing = searchResult.customers?.[0]
    if (existing) {
      logger.info('Customer already exists for subscription', { email })
      // Keep what they asked about on the record they already have.
      if (note && existing.id) await this.appendNote(existing.id, note)
      return
    }

    // Create a minimal customer record for the sign-up
    await this.client.customers.create({
      emailAddress: email,
      ...(note ? { note: note.slice(0, 4000) } : {}),
    })
    logger.info('Subscribed customer', { email })
  }

  async listWithNotes(): Promise<CustomerNote[]> {
    const found: CustomerNote[] = []
    // v44: customers.list returns a paginator; iterating it walks every page.
    const pages = await this.client.customers.list({ limit: 100, sortField: 'DEFAULT', sortOrder: 'ASC' })
    for await (const c of pages as AsyncIterable<any>) {
      if (c?.id && c.emailAddress && c.note) found.push({ id: c.id, email: c.emailAddress, note: c.note })
    }
    return found
  }

  async appendNote(customerId: string, line: string): Promise<void> {
    // Read-modify-write: newest line first so staff see the latest at a glance.
    const current = await this.client.customers.get({ customerId })
    const existingNote = current.customer?.note ?? ''
    const note = existingNote ? `${line}\n${existingNote}` : line

    await this.client.customers.update({
      customerId,
      // Square caps the note field; keep the newest ~4k characters.
      note: note.slice(0, 4000),
    })
    logger.info('Appended customer note', { customerId, line })
  }
}

/** "2565551234" / "(256) 555-1234" → "+12565551234"; passes through +E.164; null if unusable. */
function toE164(phone?: string): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  if (phone.trim().startsWith('+') && digits.length > 7) return `+${digits}`
  return null
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
