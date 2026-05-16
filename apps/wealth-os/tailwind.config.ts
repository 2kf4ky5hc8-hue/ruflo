import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/app/**/*.{ts,tsx}', './src/components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink:    '#0b1020',
        paper:  '#fafaf9',
        muted:  '#6b7280',
        line:   '#e5e7eb',
        ok:     '#16a34a',
        warn:   '#d97706',
        bad:    '#dc2626',
        accent: '#0891b2',
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
