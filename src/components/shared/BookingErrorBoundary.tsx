import { Component, type ReactNode } from 'react'
import { reportBookingTrouble, type TroubleKind } from '@lib/booking-trouble'

/**
 * If a booking step crashes, the customer sees a plain way out instead of a
 * blank panel, and Kaden's phone hears about it (src/lib/booking-trouble.ts).
 */
export default class BookingErrorBoundary extends Component<{ kind?: TroubleKind; children: ReactNode }, { broken: boolean }> {
  state = { broken: false }

  static getDerivedStateFromError() {
    return { broken: true }
  }

  componentDidCatch(error: unknown) {
    reportBookingTrouble(this.props.kind ?? null, 'crash', error)
  }

  render() {
    if (!this.state.broken) return this.props.children
    return (
      <div role="alert" style={{ padding: '1rem 0', color: 'var(--color-dark)' }}>
        <p style={{ margin: '0 0 0.5rem', fontWeight: 600 }}>Something broke on our end.</p>
        <p style={{ margin: 0 }}>
          Nothing more will be charged from this screen. Text us at{' '}
          <a href="sms:+12564641710">(256) 464-1710</a> and we’ll get you booked.
        </p>
      </div>
    )
  }
}
