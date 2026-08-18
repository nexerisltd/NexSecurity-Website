import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        vault: {
          950: '#08090B',
          900: '#0B0D10',
          800: '#12151A',
          700: '#1A1E25',
          600: '#262B34',
          border: '#22262E',
        },
        signal: {
          DEFAULT: '#5B6CFF',
          dim: '#3D46A8',
          glow: '#8B95FF',
        },
        ok: '#3ECF8E',
        warn: '#E5A94D',
        danger: '#E5484D',
        ink: {
          DEFAULT: '#F2F3F5',
          dim: '#9AA0AC',
          faint: '#5B616E',
        },
      },
      fontFamily: {
        display: ['var(--font-manrope)', 'sans-serif'],
        body: ['var(--font-manrope)', 'sans-serif'],
        mono: ['var(--font-mono)', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(91,108,255,0.35), 0 0 40px -8px rgba(91,108,255,0.45)',
      },
      backgroundImage: {
        grid: 'linear-gradient(to right, rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.03) 1px, transparent 1px)',
      },
    },
  },
  plugins: [],
};

export default config;
