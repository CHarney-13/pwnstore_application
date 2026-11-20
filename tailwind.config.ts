import type { Config } from 'tailwindcss';

export default {
  content: ['./src/renderer/**/*.{html,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'brand-purple': '#6D36B5',
        'brand-purple-hover': '#582994',
        'brand-lavender': '#F3EFFA',
        'brand-lavender-text': '#5B2C98',
        'surface-white': '#FFFFFF',
        'surface-subtle': '#F8F7FA',
        'ink-primary': '#1E1B24',
        'ink-muted': '#5E5A68',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config;
