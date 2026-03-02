/**
 * Scroll-triggered fade-in using IntersectionObserver.
 * Add class="fade-in" to any element to make it fade in when scrolled into view.
 * Respects prefers-reduced-motion.
 *
 * Elements start visible (no FOIC). JS adds the "fade-ready" class to hide them,
 * then the observer adds "visible" to reveal. This avoids the flash-of-invisible-content
 * that happens when CSS hides elements before JS can observe them.
 */

function initFadeIn() {
  if (typeof window === 'undefined') return

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  if (prefersReducedMotion.matches) {
    document.querySelectorAll('.fade-in').forEach((el) => {
      el.classList.remove('fade-ready')
      el.classList.add('visible')
    })
    return
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible')
          observer.unobserve(entry.target)
        }
      }
    },
    { threshold: 0.1 }
  )

  document.querySelectorAll('.fade-in:not(.visible)').forEach((el) => {
    el.classList.add('fade-ready')
    observer.observe(el)
  })
}

// Run on DOMContentLoaded or immediately if already loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initFadeIn)
} else {
  initFadeIn()
}

// Re-run after Astro view transitions
document.addEventListener('astro:page-load', initFadeIn)
