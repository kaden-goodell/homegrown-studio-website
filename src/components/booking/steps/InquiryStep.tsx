import { useState } from 'react'
import { useWizard } from '@components/booking/WizardContext'

export default function InquiryStep() {
  const { state, dispatch } = useWizard()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [errors, setErrors] = useState<{ name?: string; email?: string }>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  function validate(): boolean {
    const next: { name?: string; email?: string } = {}
    if (!name.trim()) next.name = 'Name is required'
    if (!email.trim()) next.email = 'Email is required'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function handleSubmit() {
    if (!validate()) return

    setSubmitting(true)
    dispatch({ type: 'SET_ERROR', payload: null })

    try {
      const [givenName, ...rest] = name.trim().split(' ')
      const familyName = rest.join(' ')

      await fetch('/api/customer/find-or-create.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          givenName,
          familyName,
          phone: phone.trim() || undefined,
        }),
      })

      const res = await fetch('/api/inquiry/submit.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim() || undefined,
          eventType: state.eventType?.id,
          dates: state.selectedDates,
          duration: state.desiredDuration,
          guestCount: state.guestCount,
          details: state.specialRequests,
        }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to submit inquiry')
      }

      dispatch({ type: 'SET_CUSTOMER_INFO', payload: { name: name.trim(), email: email.trim(), phone: phone.trim() } })
      dispatch({ type: 'SET_PAYMENT_STATUS', payload: 'completed' })
      setSubmitted(true)
    } catch (err) {
      dispatch({ type: 'SET_ERROR', payload: err instanceof Error ? err.message : 'Failed to submit inquiry' })
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <div className="flex flex-col items-center gap-4 py-8 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-green-600">
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <p className="text-lg font-medium text-gray-900">
          Thank you! We'll get back to you within 24 hours.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-gray-700">Contact Information</h3>

        <div className="space-y-1">
          <label htmlFor="inquiry-name" className="block text-sm text-gray-600">
            Name <span className="text-red-500">*</span>
          </label>
          <input
            id="inquiry-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
          {errors.name && <p className="text-sm text-red-600">{errors.name}</p>}
        </div>

        <div className="space-y-1">
          <label htmlFor="inquiry-email" className="block text-sm text-gray-600">
            Email <span className="text-red-500">*</span>
          </label>
          <input
            id="inquiry-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
          {errors.email && <p className="text-sm text-red-600">{errors.email}</p>}
        </div>

        <div className="space-y-1">
          <label htmlFor="inquiry-phone" className="block text-sm text-gray-600">
            Phone
          </label>
          <input
            id="inquiry-phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      <div className="rounded-md bg-primary-light p-4 space-y-2">
        <h3 className="text-sm font-medium text-primary">Review Your Inquiry</h3>
        {state.eventType && (
          <p className="text-sm text-primary">
            Event: {state.eventType.name}
          </p>
        )}
        {state.selectedDates && (
          <p className="text-sm text-primary">
            Date: {state.selectedDates.start}
            {state.selectedDates.end !== state.selectedDates.start && ` – ${state.selectedDates.end}`}
          </p>
        )}
        {state.guestCount > 1 && (
          <p className="text-sm text-primary">
            Guests: {state.guestCount}
          </p>
        )}
        {state.specialRequests && (
          <p className="text-sm text-primary">
            Notes: {state.specialRequests}
          </p>
        )}
      </div>

      {state.error && (
        <p className="text-sm text-red-600">{state.error}</p>
      )}

      <button
        type="button"
        disabled={submitting}
        onClick={handleSubmit}
        className="rounded-md bg-primary px-6 py-2 text-sm font-medium text-white shadow-sm transition hover:brightness-90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:opacity-50"
      >
        {submitting ? 'Submitting...' : 'Submit Inquiry'}
      </button>
    </div>
  )
}
