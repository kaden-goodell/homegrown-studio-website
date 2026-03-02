/**
 * Scroll-triggered fade-in using IntersectionObserver.
 * Add class="fade-in" to any element to make it fade in when scrolled into view.
 * Respects prefers-reduced-motion.
 *
 * Load in Layout.astro:
 *   <script>import '@lib/fade-in'</script>
 */

function initFadeIn() {
  if (typeof window === 'undefined') return

  // Respect prefers-reduced-motion
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  if (prefersReducedMotion.matches) {
    // Show everything immediately
    document.querySelectorAll('.fade-in').forEach((el) => {
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

  document.querySelectorAll('.fade-in').forEach((el) => {
    observer.observe(el)
  })
}

// Run on DOMContentLoaded or immediately if already loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initFadeIn)
} else {
  initFadeIn()
}
