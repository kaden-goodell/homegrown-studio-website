import { describe, it, expect } from 'vitest'
import { searchCustomers, isGuestSeatCustomer } from '@lib/customer-directory'

const ashley = { id: 'A', givenName: 'Ashley', familyName: 'Singleton', email: 'kashley.singleton@gmail.com', phone: '+12519794753' }
const maxie = { id: 'M', givenName: 'Maxie', familyName: 'Gardner', email: 'maxie.gardner@gmail.com', phone: '+12565859819' }
const guest = { id: 'G', givenName: 'Maxie', familyName: 'Gardner (guest 2 of 2)', email: '' }
const named = { id: 'N', givenName: 'Flynn', familyName: '(with Ashley Singleton)', email: '' }
const list = [ashley, maxie, guest, named]

describe('searchCustomers', () => {
  it('matches any part of the name, case-insensitive', () => {
    expect(searchCustomers(list, 'sing').map((c) => c.id)).toEqual(['A'])
    expect(searchCustomers(list, 'maxie g').map((c) => c.id)).toEqual(['M'])
  })
  it('matches email and phone digits', () => {
    expect(searchCustomers(list, 'gardner@').map((c) => c.id)).toEqual(['M'])
    expect(searchCustomers(list, '585-98').map((c) => c.id)).toEqual(['M'])
  })
  it('leaves out the extra-seat customers', () => {
    expect(isGuestSeatCustomer(guest)).toBe(true)
    expect(isGuestSeatCustomer(named)).toBe(true)
    expect(searchCustomers(list, 'flynn')).toEqual([])
    expect(searchCustomers(list, 'maxie').map((c) => c.id)).toEqual(['M'])
  })
  it('caps the list and ignores a blank search', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: String(i), givenName: 'Sam', familyName: `Lee${i}`, email: '' }))
    expect(searchCustomers(many, 'sam')).toHaveLength(8)
    expect(searchCustomers(many, '  ')).toEqual([])
  })
})
