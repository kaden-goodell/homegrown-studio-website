import { describe, it, expect } from 'vitest'
import { MockCustomerProvider } from '@providers/mock/customer'

describe('MockCustomerProvider', () => {
  it('creates a new customer with generated ID', async () => {
    const provider = new MockCustomerProvider()
    const customer = await provider.findOrCreate({
      email: 'alice@example.com',
      givenName: 'Alice',
      familyName: 'Smith',
    })
    expect(customer.id).toBeTruthy()
    expect(customer.id).toContain('mock-customer-')
  })

  it('returns existing customer if same email', async () => {
    const provider = new MockCustomerProvider()
    const first = await provider.findOrCreate({
      email: 'bob@example.com',
      givenName: 'Bob',
      familyName: 'Jones',
    })
    const second = await provider.findOrCreate({
      email: 'bob@example.com',
      givenName: 'Bob',
      familyName: 'Jones',
    })
    expect(second.id).toBe(first.id)
  })

  it('stores correct name and email', async () => {
    const provider = new MockCustomerProvider()
    const customer = await provider.findOrCreate({
      email: 'carol@example.com',
      givenName: 'Carol',
      familyName: 'White',
      phone: '555-1234',
    })
    expect(customer.email).toBe('carol@example.com')
    expect(customer.givenName).toBe('Carol')
    expect(customer.familyName).toBe('White')
    expect(customer.phone).toBe('555-1234')
  })

  it('subscribe does not throw', async () => {
    const provider = new MockCustomerProvider()
    await expect(provider.subscribe('test@example.com')).resolves.toBeUndefined()
  })
})
