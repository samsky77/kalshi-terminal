import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    borderRadius: { none: '0', DEFAULT: '0' },
    extend: {
      colors: {
        bg: '#0A0A0A',
        panel: '#141414',
        line: '#2A2A2A',
        line2: '#1E1E1E',
        ink: '#E8E6E0',
        muted: '#9A968C',
        amber: '#FFB000',
        fair: '#5AB0FF',
        noedge: '#8A867D',
      },
      fontFamily: {
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config;
