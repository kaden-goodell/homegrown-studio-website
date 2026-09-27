import { forwardRef, useId, useImperativeHandle, useRef, useState } from 'react'
import {
  CONTACT_FIELDS,
  contactProblems,
  problemWith,
  type Contact,
  type ContactField,
} from '@lib/contact-rules'
import '../../styles/booking-panel.css'

/**
 * Name, email and phone, the same in both booking flows.
 *
 * - Each field is labelled, named and marked up so a phone can fill it in.
 * - A field is checked when the customer leaves it, not while they type, and
 *   its message clears as soon as it is fixed.
 * - `check()` (called by the Pay button) marks every problem, moves to the
 *   first one, and says whether the details are usable.
 */
export interface ContactFieldsHandle {
  /** Shows every problem and focuses the first. True when there are none. */
  check: () => boolean
}

interface ContactFieldsProps {
  value: Contact
  onChange: (next: Contact) => void
  /** Parties need a number to reach the host on the day; workshops don't. */
  phoneRequired: boolean
  disabled?: boolean
}

const SETTINGS: Record<ContactField, { label: string; type: string; autoComplete: string; inputMode?: 'email' | 'tel'; name: string }> = {
  firstName: { label: 'First name', type: 'text', autoComplete: 'given-name', name: 'given-name' },
  lastName: { label: 'Last name', type: 'text', autoComplete: 'family-name', name: 'family-name' },
  email: { label: 'Email', type: 'email', autoComplete: 'email', inputMode: 'email', name: 'email' },
  phone: { label: 'Phone', type: 'tel', autoComplete: 'tel', inputMode: 'tel', name: 'tel' },
}

const ContactFields = forwardRef<ContactFieldsHandle, ContactFieldsProps>(function ContactFields(
  { value, onChange, phoneRequired, disabled },
  ref,
) {
  const id = useId()
  const inputs = useRef<Partial<Record<ContactField, HTMLInputElement | null>>>({})
  // A field's message shows once it has been left, or once Pay was tapped.
  const [checked, setChecked] = useState<Partial<Record<ContactField, boolean>>>({})

  useImperativeHandle(ref, () => ({
    check() {
      const problems = contactProblems(value, { phoneRequired })
      setChecked({ firstName: true, lastName: true, email: true, phone: true })
      const first = CONTACT_FIELDS.find((f) => problems[f])
      if (!first) return true
      const input = inputs.current[first]
      input?.focus()
      input?.scrollIntoView?.({ block: 'center' })
      return false
    },
  }))

  function field(name: ContactField) {
    const settings = SETTINGS[name]
    const optional = name === 'phone' && !phoneRequired
    const problem = checked[name] ? problemWith(name, value, { phoneRequired }) : ''
    const inputId = `${id}-${name}`
    const errorId = `${inputId}-error`
    return (
      <div className="field">
        <label className="field-label" htmlFor={inputId}>
          {settings.label}
          {optional && <span className="field-optional"> (optional)</span>}
        </label>
        <input
          ref={(el) => {
            inputs.current[name] = el
          }}
          id={inputId}
          name={settings.name}
          className="field-input"
          type={settings.type}
          inputMode={settings.inputMode}
          autoComplete={settings.autoComplete}
          autoCapitalize={name === 'email' ? 'none' : undefined}
          spellCheck={false}
          required={!optional}
          disabled={disabled}
          value={value[name]}
          onChange={(e) => onChange({ ...value, [name]: e.target.value })}
          onBlur={() => setChecked((c) => ({ ...c, [name]: true }))}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? errorId : undefined}
        />
        {problem && (
          <p id={errorId} role="alert" className="field-error">
            {problem}
          </p>
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div className="field-pair">
        {field('firstName')}
        {field('lastName')}
      </div>
      {field('email')}
      {field('phone')}
    </div>
  )
})

export default ContactFields
