import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Same token names (vault-*, ink-*, signal-*) every component
        // already uses — only the values changed. Now a dark navy
        // glassmorphism palette: vault-900/800/700 are translucent
        // NAVY-BLUE tints (not white) so backdrop-blur panels read as
        // tinted glass floating over the dark page background, matching
        // the reference design's depth — not flat dark cards.
        vault: {
          950: '#050E1F', // page background (deepest navy, near-black)
          900: 'rgba(30,58,95,0.42)', // primary glass surface (nav, cards)
          800: 'rgba(30,58,95,0.30)', // secondary glass surface
          700: 'rgba(30,58,95,0.20)',
          600: 'rgba(255,255,255,0.06)', // subtle hover tint on dark
          border: 'rgba(255,255,255,0.12)', // light-catching edge on dark glass
        },
        signal: {
          DEFAULT: '#417AF8',
          dim: '#2E5FD9',
          glow: '#79A0FF',
        },
        ok: '#2FBE82',
        warn: '#E3A63D',
        danger: '#F2555C',
        ink: {
          DEFAULT: '#F3F6FC', // headings — near-white on dark
          dim: '#B7BECF', // body text — muted blue-grey
          faint: '#8A93AC', // labels/meta — dimmer still
        },
      },
      fontFamily: {
        display: ['var(--font-manrope)', 'sans-serif'],
        body: ['var(--font-manrope)', 'sans-serif'],
        mono: ['var(--font-mono)', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(65,122,248,0.28), 0 8px 30px -8px rgba(65,122,248,0.4)',
        // Dark glass needs a real cast shadow (not just a light-bevel
        // ring) to actually read as "floating" — the inset highlight is
        // now a faint light catch along the top edge instead of a bright
        // white bevel, which is what "Fluent" depth looks like on dark.
        glass: '0 20px 50px -14px rgba(0,0,0,0.55), inset 0 1px 0 0 rgba(255,255,255,0.09)',
      },
      backgroundImage: {
        grid: 'linear-gradient(to right, rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.035) 1px, transparent 1px)',
        // Soft ambient glow blobs behind the hero — the ellipses of color
        // visible in the reference design's background. Layered radial
        // gradients rather than an image so it scales/recolors for free.
        glow: 'radial-gradient(ellipse 900px 500px at 15% -10%, rgba(65,122,248,0.22), transparent 60%), radial-gradient(ellipse 700px 500px at 100% 10%, rgba(122,89,255,0.14), transparent 60%)',
      },
      backdropBlur: {
        xs: '2px',
      },
      backdropSaturate: {
        150: '1.5',
        180: '1.8',
      },
    },
  },
  plugins: [],
};

export default config;
