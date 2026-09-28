import { useEffect, type ReactNode } from 'react'

/**
 * The top of every confirmation screen, so a party and a workshop look alike:
 * the same mark, the same heading, the same line about the email.
 *
 * Also asks the glitter for one short burst (see Shimmer.tsx). This is the
 * one place it means something.
 */
interface BookingConfirmedProps {
  heading: string
  /** "2 seats for Kinusaiga" */
  what: ReactNode
  email: string
  /** Only true when the server says the email went out. */
  emailSent: boolean
  children?: ReactNode
}

export default function BookingConfirmed({ heading, what, email, emailSent, children }: BookingConfirmedProps) {
  useEffect(() => {
    try {
      window.dispatchEvent(new CustomEvent('hometown:celebrate'))
    } catch {
      /* purely decorative */
    }
  }, [])

  return (
    <div>
      <div style={{ textAlign: 'center' }}>
        <div
          aria-hidden="true"
          style={{
            width: '3.5rem',
            height: '3.5rem',
            margin: '0 auto 1rem',
            borderRadius: '50%',
            background: 'var(--craft-green-soft, #e7f1ea)',
            color: 'var(--craft-green-ink, #2f5d3f)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.75rem',
            fontWeight: 700,
          }}
        >
          &#10003;
        </div>
        <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.5rem', fontFamily: 'var(--font-heading)', fontWeight: 700, color: 'var(--color-dark)' }}>
          {heading}
        </h3>
        <p style={{ margin: 0, fontSize: '1rem', color: 'var(--color-dark)', lineHeight: 1.5 }}>{what}</p>
        <p role="status" style={{ margin: '0.5rem 0 0', fontSize: '0.9375rem', color: 'var(--color-text)', lineHeight: 1.5 }}>
          {emailSent ? (
            <>
              A confirmation is on its way to <strong>{email}</strong>.
            </>
          ) : (
            'We couldn’t send your confirmation email, so please take a screenshot of this page.'
          )}
        </p>
      </div>
      {children}
    </div>
  )
}

/** A labelled block on a confirmation screen: "When", "Where", "Before you come". */
export function ConfirmedBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ padding: '0.875rem 0', borderTop: '1px solid var(--color-line)' }}>
      <p style={{ margin: '0 0 0.25rem', fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-text)' }}>
        {label}
      </p>
      <div style={{ fontSize: '0.9375rem', color: 'var(--color-dark)', lineHeight: 1.5 }}>{children}</div>
    </div>
  )
}
