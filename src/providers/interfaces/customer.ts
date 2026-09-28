export interface Customer {
  id: string
  email: string
  givenName: string
  familyName?: string
  phone?: string
}

/** A customer record as the sign-up emails need it: who, and what is written on their record. */
export interface CustomerNote {
  id: string
  email: string
  note: string
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

  /**
   * Keep an email-only contact. `note` (optional) is one dated line saying what
   * they asked to hear about; it is added to the record's notes, newest first.
   */
  subscribe(email: string, note?: string): Promise<void>

  /**
   * Append a line to the customer's note field (newest first). Used for
   * waiver references — custom attribute definitions are at Square's 10-cap,
   * so the note field is the durable place for lookup metadata.
   */
  appendNote(customerId: string, line: string): Promise<void>

  /**
   * Everyone with an email address and something written in their note.
   * The sign-up emails read this to find who is still waiting to hear.
   */
  listWithNotes(): Promise<CustomerNote[]>
}
