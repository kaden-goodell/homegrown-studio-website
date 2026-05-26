import type { ReactNode } from 'react'

export interface DetailsStepProps {
  imageUrl?: string
  /**
   * How to render the image:
   *  - "card" (default): fixed 14rem height, object-fit: cover (crops). Use for 16:9 card images.
   *  - "natural": preserve natural aspect ratio (e.g. tall flyers); width 100%, max-height caps growth so the modal stays usable.
   */
  imageAspect?: 'card' | 'natural'
  title: string
  description: string
  tags: { icon?: ReactNode; label: string }[]
  buttonText?: string
  onContinue: () => void
}

export default function DetailsStep({
  imageUrl,
  imageAspect = 'card',
  title,
  description,
  tags,
  buttonText = 'Continue',
  onContinue,
}: DetailsStepProps) {
  const paragraphs = description.split(/\n\n|\n/).filter(Boolean)

  const imageStyle: React.CSSProperties =
    imageAspect === 'natural'
      ? {
          width: '100%',
          height: 'auto',
          borderRadius: '0.75rem',
          marginBottom: '1.25rem',
          display: 'block',
        }
      : {
          width: '100%',
          height: '14rem',
          objectFit: 'cover',
          borderRadius: '0.75rem',
          marginBottom: '1.25rem',
        }

  return (
    <div>
      {imageUrl && (
        <img src={imageUrl} alt={title} style={imageStyle} />
      )}

      <h3
        style={{
          fontSize: '1.25rem',
          fontFamily: 'var(--font-heading)',
          fontWeight: 700,
          color: 'var(--color-dark, #3d3229)',
          marginBottom: '0.75rem',
        }}
      >
        {title}
      </h3>

      {tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
          {tags.map((tag, i) => (
            <span
              key={i}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.375rem',
                fontSize: '0.75rem',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                padding: '0.375rem 0.75rem',
                borderRadius: '9999px',
                background: 'rgba(150, 112, 91, 0.08)',
                color: 'var(--color-primary)',
              }}
            >
              {tag.icon}
              {tag.label}
            </span>
          ))}
        </div>
      )}

      <div
        data-testid="description"
        style={{ fontSize: '0.875rem', lineHeight: 1.7, color: 'var(--color-muted)', marginBottom: '1.5rem' }}
      >
        {paragraphs.map((p, i) => (
          <p key={i} style={{ marginBottom: i < paragraphs.length - 1 ? '0.75rem' : 0 }}>
            {p}
          </p>
        ))}
      </div>

      <button
        type="button"
        onClick={onContinue}
        style={{
          display: 'block',
          width: '100%',
          textAlign: 'center',
          borderRadius: '0.75rem',
          padding: '0.875rem 1.5rem',
          color: 'white',
          fontWeight: 600,
          fontSize: '0.875rem',
          background: 'linear-gradient(135deg, var(--color-primary), var(--color-accent))',
          boxShadow: '0 4px 15px rgba(150, 112, 91, 0.2)',
          border: 'none',
          cursor: 'pointer',
          transition: 'all 0.3s ease',
        }}
      >
        {buttonText}
      </button>
    </div>
  )
}
