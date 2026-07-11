export interface Customer {
  id: string
  email: string
  givenName: string
  familyName?: string
  phone?: string
}

export interface CustomerProvider {
  /**
   * Find an existing customer by email, then by phone, before creating one —
   * a returning customer who signs up with a different email but the same
   * phone (or vice versa) must resolve to the same profile.
   */
  findOrCreate(params: {
    email: string
    givenName: string
    familyName?: string
    phone?: string
  }): Promise<Customer>

  subscribe(email: string): Promise<void>

  /**
   * Append a line to the customer's note field (newest first). Used for
   * waiver references — custom attribute definitions are at Square's 10-cap,
   * so the note field is the durable place for lookup metadata.
   */
  appendNote(customerId: string, line: string): Promise<void>
}
