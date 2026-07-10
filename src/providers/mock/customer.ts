import type { Customer, CustomerProvider } from '@providers/interfaces/customer'

export class MockCustomerProvider implements CustomerProvider {
  private customers = new Map<string, Customer>()
  private notes = new Map<string, string[]>()
  private counter = 0

  async findOrCreate(params: {
    email: string
    givenName: string
    familyName: string
    phone?: string
  }): Promise<Customer> {
    const existing = this.customers.get(params.email)
    if (existing) return existing

    // Phone fallback — mirrors the Square provider's email-then-phone lookup.
    if (params.phone) {
      const digits = params.phone.replace(/\D/g, '')
      for (const c of this.customers.values()) {
        if (c.phone && c.phone.replace(/\D/g, '') === digits) return c
      }
    }

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

  async appendNote(customerId: string, line: string): Promise<void> {
    const notes = this.notes.get(customerId) ?? []
    notes.unshift(line)
    this.notes.set(customerId, notes)
  }
}
