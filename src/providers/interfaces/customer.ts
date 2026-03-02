export interface Customer {
  id: string
  email: string
  givenName: string
  familyName: string
  phone?: string
}

export interface CustomerProvider {
  findOrCreate(params: {
    email: string
    givenName: string
    familyName: string
    phone?: string
  }): Promise<Customer>

  subscribe(email: string): Promise<void>
}
