import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Kept the same token names (vault-*, ink-*, signal-*) that every
        // component already uses — only the values changed, from a dark
        // "vault" palette to a light glassmorphism / Fluent-style one.
        // vault-900/800/700 are translucent whites so backdrop-blur
        // actually reads as glass instead of a flat card.
        vault: {
          950: '#EEF2FB', // page background
          900: 'rgba(255,255,255,0.62)', // primary glass surface
          800: 'rgba(255,255,255,0.46)', // secondary glass surface
          700: 'rgba(255,255,255,0.30)',
          600: 'rgba(15,23,42,0.05)',
          border: 'rgba(15,23,42,0.09)',
        },
        signal: {
          DEFAULT: '#3D6EFF',
          dim: '#2748B5',
          glow: '#6E96FF',
        },
        ok: '#1E9E6A',
        warn: '#B8791A',
        danger: '#D8383F',
        ink: {
          DEFAULT: '#101828',
          dim: '#5B6472',
          faint: '#8A93A3',
        },
      },
      fontFamily: {
        display: ['var(--font-manrope)', 'sans-serif'],
        body: ['var(--font-manrope)', 'sans-serif'],
        mono: ['var(--font-mono)', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(61,110,255,0.18), 0 8px 30px -8px rgba(61,110,255,0.28)',
        glass: '0 8px 32px -8px rgba(16,24,40,0.12), inset 0 1px 0 0 rgba(255,255,255,0.5)',
      },
      backgroundImage: {
        grid: 'linear-gradient(to right, rgba(16,24,40,0.035) 1px, transparent 1px), linear-gradient(to bottom, rgba(16,24,40,0.035) 1px, transparent 1px)',
      },
      backdropBlur: {
        xs: '2px',
      },
    },
  },
  plugins: [],
};

export default config;
