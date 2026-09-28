import { describe, it, expect } from 'vitest'
import { createRef, useState } from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import ContactFields, { type ContactFieldsHandle } from '@components/shared/ContactFields'
import { EMPTY_CONTACT, CONTACT_MESSAGES, type Contact } from '@lib/contact-rules'

function Harness({ phoneRequired = true, start = EMPTY_CONTACT, handle }: { phoneRequired?: boolean; start?: Contact; handle?: React.Ref<ContactFieldsHandle> }) {
  const [value, setValue] = useState<Contact>(start)
  return <ContactFields ref={handle} value={value} onChange={setValue} phoneRequired={phoneRequired} />
}

describe('ContactFields', () => {
  it('labels every field and marks it up so a phone can fill it in', () => {
    render(<Harness />)
    const expected = [
      ['First name', 'given-name', 'text'],
      ['Last name', 'family-name', 'text'],
      ['Email', 'email', 'email'],
      ['Phone', 'tel', 'tel'],
    ] as const
    for (const [label, autoComplete, type] of expected) {
      const input = screen.getByLabelText(label) as HTMLInputElement
      expect(input).toHaveAttribute('autocomplete', autoComplete)
      expect(input).toHaveAttribute('type', type)
      expect(input.name).toBe(autoComplete)
      expect(input.id).not.toBe('')
    }
    expect(screen.getByLabelText('Email')).toHaveAttribute('inputmode', 'email')
    expect(screen.getByLabelText('Phone')).toHaveAttribute('inputmode', 'tel')
  })

  it('says "(optional)" on the phone for workshops, and stars nothing', () => {
    render(<Harness phoneRequired={false} />)
    expect(screen.getByLabelText('Phone (optional)')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('*')
  })

  it('says nothing while the customer is still typing', () => {
    render(<Harness />)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@' } })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('checks a field when the customer leaves it, with the message under that field', () => {
    render(<Harness />)
    const email = screen.getByLabelText('Email')
    fireEvent.change(email, { target: { value: 'ada@example' } })
    fireEvent.blur(email)

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(CONTACT_MESSAGES.email)
    expect(email).toHaveAttribute('aria-invalid', 'true')
    expect(email).toHaveAttribute('aria-describedby', alert.id)
    // Only the field that was left is judged.
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })

  it('clears the message as soon as it is fixed', () => {
    render(<Harness />)
    const email = screen.getByLabelText('Email')
    fireEvent.change(email, { target: { value: 'ada@example' } })
    fireEvent.blur(email)
    fireEvent.change(email, { target: { value: 'ada@example.com' } })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(email).not.toHaveAttribute('aria-invalid')
  })

  it('check() shows every problem and moves to the first one', () => {
    const handle = createRef<ContactFieldsHandle>()
    render(<Harness handle={handle} start={{ firstName: 'Ada', lastName: '', email: 'nope', phone: '' }} />)

    let usable = true
    act(() => {
      usable = handle.current!.check()
    })

    expect(usable).toBe(false)
    expect(screen.getAllByRole('alert').map((a) => a.textContent)).toEqual([
      CONTACT_MESSAGES.lastName,
      CONTACT_MESSAGES.email,
      CONTACT_MESSAGES.phone,
    ])
    expect(screen.getByLabelText('Last name')).toHaveFocus()
  })

  it('check() passes usable details and shows nothing', () => {
    const handle = createRef<ContactFieldsHandle>()
    render(<Harness handle={handle} phoneRequired={false} start={{ firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', phone: '' }} />)
    let usable = false
    act(() => {
      usable = handle.current!.check()
    })
    expect(usable).toBe(true)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps what was typed', () => {
    render(<Harness />)
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Ada' } })
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '256' } })
    fireEvent.blur(screen.getByLabelText('Phone'))
    expect(screen.getByLabelText('First name')).toHaveValue('Ada')
    expect(screen.getByLabelText('Phone')).toHaveValue('256')
  })
})
