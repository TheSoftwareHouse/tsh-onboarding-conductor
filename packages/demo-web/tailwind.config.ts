import type { Config } from 'tailwindcss';

/**
 * TSH design tokens, taken from the admin panel's `src/app/tailwind.css` (palette, font stack,
 * radii) so the two apps read as one product. Loaded into Tailwind 4 from `src/index.css` with
 * `@config`. The shadcn/ui semantic colours (`primary`, `muted`, ...) point at CSS variables
 * defined in `src/index.css`, so a palette change happens in one place.
 */
const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        tsh: {
          black: '#000000',
          ink: { 1: '#1d1f20', 2: '#282a2b' },
          gray: {
            900: '#313435',
            800: '#3b3e3f',
            700: '#444849',
            600: '#62686a',
            500: '#8f9094',
            400: '#a0a5a7',
            300: '#bfc3c4',
            200: '#cfd8dd',
            100: '#edf1f4',
            50: '#f7f9fa',
          },
          white: '#ffffff',
          purple: { 500: '#8785ff', 300: '#b5b4ff', 100: '#c6c6fa' },
          blue: {
            500: '#2e98e6',
            400: '#5cc0ff',
            300: '#8dd4ff',
            200: '#acdaf6',
            100: '#d1e8ff',
          },
          yellow: { 500: '#ffb84a', 400: '#ffc269', 300: '#ffce85', 200: '#fee8c8' },
          teal: '#30ded8',
          red: '#ee1313',
        },
        border: 'var(--border)',
        input: 'var(--input)',
        ring: 'var(--ring)',
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        primary: { DEFAULT: 'var(--primary)', foreground: 'var(--primary-foreground)' },
        secondary: { DEFAULT: 'var(--secondary)', foreground: 'var(--secondary-foreground)' },
        muted: { DEFAULT: 'var(--muted)', foreground: 'var(--muted-foreground)' },
        accent: { DEFAULT: 'var(--accent)', foreground: 'var(--accent-foreground)' },
        destructive: { DEFAULT: 'var(--destructive)', foreground: 'var(--destructive-foreground)' },
        card: { DEFAULT: 'var(--card)', foreground: 'var(--card-foreground)' },
        success: { DEFAULT: 'var(--success)', foreground: 'var(--success-foreground)' },
        warning: { DEFAULT: 'var(--warning)', foreground: 'var(--warning-foreground)' },
      },
      fontFamily: {
        sans: [
          'TWK Everett',
          'Everett',
          'Inter Tight Variable',
          'Inter Tight',
          'Inter',
          'system-ui',
          '-apple-system',
          'sans-serif',
        ],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      letterSpacing: {
        display: '-0.04em',
        brand: '-0.02em',
      },
    },
  },
};

export default config;
