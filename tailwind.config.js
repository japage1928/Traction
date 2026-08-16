/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Semantic roles map to the CSS custom properties defined in index.css,
        // so light/dark values swap in exactly one place.
        surface: {
          DEFAULT: 'var(--surface-1)',
          sunken: 'var(--surface-sunken)',
          raised: 'var(--surface-raised)',
        },
        ink: {
          DEFAULT: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted: 'var(--text-muted)',
        },
        line: {
          DEFAULT: 'var(--border)',
          strong: 'var(--baseline)',
          grid: 'var(--gridline)',
        },
        brand: {
          DEFAULT: 'var(--series-1)',
          soft: 'var(--brand-soft)',
        },
        status: {
          good: 'var(--status-good)',
          warning: 'var(--status-warning)',
          serious: 'var(--status-serious)',
          critical: 'var(--status-critical)',
        },
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      borderRadius: {
        card: '12px',
      },
    },
  },
  plugins: [],
};
