/**
 * Subtle CSS particle shimmer effect rendered as a background layer.
 * Only active when config.theme.animations.particles is true.
 * Uses pure CSS @keyframes — no heavy JS libraries.
 */
export default function Shimmer({ enabled }: { enabled: boolean }) {
  if (!enabled) return null

  return (
    <div
      className="shimmer-container"
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 0,
        overflow: 'hidden',
      }}
    >
      <style>{`
        @keyframes shimmer-float {
          0%, 100% { transform: translateY(0) scale(1); opacity: 0; }
          10% { opacity: 0.6; }
          90% { opacity: 0.6; }
          50% { transform: translateY(-40vh) scale(1.2); }
        }

        @media (prefers-reduced-motion: reduce) {
          .shimmer-particle { animation: none !important; display: none; }
        }

        .shimmer-particle {
          position: absolute;
          bottom: -10px;
          border-radius: 50%;
          background: radial-gradient(circle, var(--color-accent, #d4a574) 0%, transparent 70%);
          animation: shimmer-float linear infinite;
          will-change: transform, opacity;
        }
      `}</style>
      {Array.from({ length: 8 }, (_, i) => (
        <div
          key={i}
          className="shimmer-particle"
          style={{
            left: `${10 + i * 12}%`,
            width: `${3 + (i % 3) * 2}px`,
            height: `${3 + (i % 3) * 2}px`,
            animationDuration: `${8 + i * 2}s`,
            animationDelay: `${i * 1.5}s`,
          }}
        />
      ))}
    </div>
  )
}
