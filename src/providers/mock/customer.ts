import type { Customer, CustomerProvider } from '@providers/interfaces/customer'

export class MockCustomerProvider implements CustomerProvider {
  private customers = new Map<string, Customer>()
  private counter = 0

  async findOrCreate(params: {
    email: string
    givenName: string
    familyName: string
    phone?: string
  }): Promise<Customer> {
    const existing = this.customers.get(params.email)
    if (existing) return existing

    this.counter++
    const customer: Customer = {
      id: `mock-customer-${this.counter}`,
      email: params.email,
      givenName: params.givenName,
      familyName: params.familyName,
      phone: params.phone,
    }
    this.customers.set(params.email, customer)
    return customer
  }

  async subscribe(_email: string): Promise<void> {}
}
