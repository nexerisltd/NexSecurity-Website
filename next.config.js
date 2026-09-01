/** @type {import('next').NextConfig} */

// Video embeds run in an iframe, so their origin needs an explicit
// frame-src allowance: iframe.mediadelivery.net (Bunny) and
// www.youtube-nocookie.com (YouTube). Adding a THIRD video provider
// later needs its embed domain added here too, or the browser silently
// blocks the iframe with "This content is blocked" — CSP enforcement,
// not a bug in the player — exactly what happened when YouTube support
// was first added and this line wasn't updated alongside it.
//
// media-src additionally allows any https origin: the 'mp4' provider
// (components/VideoPlayer.tsx) plays a plain <video src> pointed at
// whatever URL an admin pasted in — Bunny/Supabase storage today, but
// potentially any host tomorrow — so this can't be a fixed allowlist the
// way frame-src is. It's the same trade-off img-src already makes below
// for thumbnails. Nothing here weakens frame-src/script-src: this only
// widens which origins a <video>/<audio> element may fetch bytes from,
// never which origins may run script or be embedded as a page.
//
// script-src additionally allows www.youtube.com and s.ytimg.com:
// components/VideoPlayer.tsx loads YouTube's official IFrame Player API
// script from there to build a fully custom control bar (see the long
// comment in that file for why — short version: YouTube's policies
// prohibit selectively hiding/blocking parts of their native player, but
// building a complete custom replacement via their own API is the
// sanctioned way to do this).
//
// script-src only gets 'unsafe-eval' in development: Next.js's dev-mode
// Fast Refresh / HMR runtime uses eval() internally, which this CSP
// otherwise blocks outright (breaking ALL client-side JS on the page,
// not just one component — that's why a button can look completely
// dead in `next dev` while working fine in a production build).
// Production keeps the strict policy with no 'unsafe-eval'.
const isDev = process.env.NODE_ENV === 'development';
const ContentSecurityPolicy = `
  default-src 'self';
  script-src 'self' 'unsafe-inline' https://www.youtube.com https://s.ytimg.com${isDev ? " 'unsafe-eval'" : ''};
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob: https:;
  font-src 'self' data:;
  connect-src 'self' https://*.supabase.co wss://*.supabase.co${isDev ? ' ws://localhost:*' : ''};
  media-src 'self' https: blob:;
  frame-src 'self' https://iframe.mediadelivery.net https://www.youtube-nocookie.com;
  frame-ancestors 'none';
  base-uri 'self';
  form-action 'self';
  object-src 'none';
  upgrade-insecure-requests;
`.replace(/\s{2,}/g, ' ').trim();

const securityHeaders = [
  { key: 'Content-Security-Policy', value: ContentSecurityPolicy },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  },
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Thumbnails (boards/classes/ebooks) are uploaded to the "thumbnails"
  // bucket in Supabase Storage and served from https://<project-ref>
  // .supabase.co/storage/v1/object/public/... — allowing the wildcard
  // hostname here (not a hardcoded project ref) means image optimization
  // works out of the box for any Supabase project, in any environment,
  // without editing this file again later.
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '**.supabase.co' }],
    formats: ['image/avif', 'image/webp'],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

module.exports = nextConfig;
