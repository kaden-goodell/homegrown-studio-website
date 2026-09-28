/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{astro,html,js,jsx,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        heading: ['var(--font-heading)', 'serif'],
        body: ['var(--font-body)', 'sans-serif'],
      },
      colors: {
        primary: {
          DEFAULT: 'var(--color-primary)',
          light: 'color-mix(in srgb, var(--color-primary) 10%, white)',
        },
        secondary: 'var(--color-secondary)',
        accent: 'var(--color-accent)',
        surface: 'var(--color-background)',
        foreground: 'var(--color-text)',
        muted: 'var(--color-muted)',
        dark: 'var(--color-dark)',
        sand: 'var(--color-sand)',
        button: {
          DEFAULT: 'var(--color-button)',
          hover: 'var(--color-button-hover)',
        },
        craft: {
          pink: { DEFAULT: 'var(--craft-pink)', soft: 'var(--craft-pink-soft)', ink: 'var(--craft-pink-ink)' },
          denim: { DEFAULT: 'var(--craft-denim)', soft: 'var(--craft-denim-soft)', ink: 'var(--craft-denim-ink)' },
          green: { DEFAULT: 'var(--craft-green)', soft: 'var(--craft-green-soft)', ink: 'var(--craft-green-ink)' },
          marigold: { DEFAULT: 'var(--craft-marigold)', soft: 'var(--craft-marigold-soft)', ink: 'var(--craft-marigold-ink)' },
          teal: { DEFAULT: 'var(--craft-teal)', soft: 'var(--craft-teal-soft)', ink: 'var(--craft-teal-ink)' },
        },
      },
    },
  },
  plugins: [],
}
