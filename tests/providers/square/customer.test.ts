import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSearch = vi.fn()
const mockCreate = vi.fn()

vi.mock('square', () => {
  return {
    SquareClient: class {
      customers = {
        search: mockSearch,
        create: mockCreate,
      }
      constructor(_opts: any) {}
    },
    SquareEnvironment: { Production: 'production', Sandbox: 'sandbox' },
  }
})

import { SquareCustomerProvider } from '@providers/square/customer'

const config = {
  accessToken: 'test-token',
  environment: 'sandbox' as const,
  locationId: 'test-location',
  applicationId: 'test-app',
}

describe('SquareCustomerProvider', () => {
  let provider: SquareCustomerProvider

  beforeEach(() => {
    vi.clearAllMocks()
    provider = new SquareCustomerProvider(config)
  })

  describe('findOrCreate', () => {
    it('returns existing customer when search finds a match', async () => {
      mockSearch.mockResolvedValue({
        customers: [
          {
            id: 'sq-cust-123',
            emailAddress: 'alice@example.com',
            givenName: 'Alice',
            familyName: 'Smith',
            phoneNumber: '555-0100',
          },
        ],
      })

      const result = await provider.findOrCreate({
        email: 'alice@example.com',
        givenName: 'Alice',
        familyName: 'Smith',
        phone: '555-0100',
      })

      expect(result).toEqual({
        id: 'sq-cust-123',
        email: 'alice@example.com',
        givenName: 'Alice',
        familyName: 'Smith',
        phone: '555-0100',
      })
      expect(mockSearch).toHaveBeenCalledOnce()
      expect(mockCreate).not.toHaveBeenCalled()
    })

    it('creates a new customer when search returns empty', async () => {
      mockSearch.mockResolvedValue({ customers: [] })
      mockCreate.mockResolvedValue({
        customer: {
          id: 'sq-cust-new',
          emailAddress: 'bob@example.com',
          givenName: 'Bob',
          familyName: 'Jones',
          phoneNumber: '555-0200',
        },
      })

      const result = await provider.findOrCreate({
        email: 'bob@example.com',
        givenName: 'Bob',
        familyName: 'Jones',
        phone: '555-0200',
      })

      expect(result).toEqual({
        id: 'sq-cust-new',
        email: 'bob@example.com',
        givenName: 'Bob',
        familyName: 'Jones',
        phone: '555-0200',
      })
      expect(mockSearch).toHaveBeenCalledOnce()
      expect(mockCreate).toHaveBeenCalledWith({
        givenName: 'Bob',
        familyName: 'Jones',
        emailAddress: 'bob@example.com',
        phoneNumber: '555-0200',
      })
    })

    it('handles race condition: search empty, create fails duplicate, retry search succeeds', async () => {
      // First search returns empty
      mockSearch.mockResolvedValueOnce({ customers: [] })

      // Create fails with duplicate error
      mockCreate.mockRejectedValueOnce({
        errors: [{ code: 'CONFLICT' }],
      })

      // Retry search finds the customer
      mockSearch.mockResolvedValueOnce({
        customers: [
          {
            id: 'sq-cust-race',
            emailAddress: 'carol@example.com',
            givenName: 'Carol',
            familyName: 'White',
            phoneNumber: undefined,
          },
        ],
      })

      const result = await provider.findOrCreate({
        email: 'carol@example.com',
        givenName: 'Carol',
        familyName: 'White',
      })

      expect(result).toEqual({
        id: 'sq-cust-race',
        email: 'carol@example.com',
        givenName: 'Carol',
        familyName: 'White',
        phone: undefined,
      })
      expect(mockSearch).toHaveBeenCalledTimes(2)
      expect(mockCreate).toHaveBeenCalledOnce()
    })

    it('throws non-duplicate errors from create', async () => {
      mockSearch.mockResolvedValue({ customers: [] })
      mockCreate.mockRejectedValue(new Error('Network failure'))

      await expect(
        provider.findOrCreate({
          email: 'fail@example.com',
          givenName: 'Fail',
          familyName: 'Case',
        })
      ).rejects.toThrow('Network failure')
    })

    it('maps Square customer fields correctly', async () => {
      mockSearch.mockResolvedValue({
        customers: [
          {
            id: 'sq-map-test',
            emailAddress: 'map@example.com',
            givenName: 'Map',
            familyName: 'Test',
            phoneNumber: '555-MAP',
            // Extra Square fields should be ignored
            createdAt: '2024-01-01',
            referenceId: 'ref-123',
          },
        ],
      })

      const result = await provider.findOrCreate({
        email: 'map@example.com',
        givenName: 'Map',
        familyName: 'Test',
      })

      expect(result).toEqual({
        id: 'sq-map-test',
        email: 'map@example.com',
        givenName: 'Map',
        familyName: 'Test',
        phone: '555-MAP',
      })
      // Verify no extra fields leaked through
      expect(Object.keys(result)).toEqual(['id', 'email', 'givenName', 'familyName', 'phone'])
    })
  })

  describe('subscribe', () => {
    it('creates customer with email only when not found', async () => {
      mockSearch.mockResolvedValue({ customers: [] })
      mockCreate.mockResolvedValue({
        customer: {
          id: 'sq-sub-1',
          emailAddress: 'newsletter@example.com',
        },
      })

      await provider.subscribe('newsletter@example.com')

      expect(mockSearch).toHaveBeenCalledWith({
        query: {
          filter: {
            emailAddress: { exact: 'newsletter@example.com' },
          },
        },
      })
      expect(mockCreate).toHaveBeenCalledWith({
        emailAddress: 'newsletter@example.com',
      })
    })

    it('skips create when customer already exists', async () => {
      mockSearch.mockResolvedValue({
        customers: [
          {
            id: 'sq-existing',
            emailAddress: 'newsletter@example.com',
          },
        ],
      })

      await provider.subscribe('newsletter@example.com')

      expect(mockSearch).toHaveBeenCalled()
      expect(mockCreate).not.toHaveBeenCalled()
    })
  })
})
