# NexSecurity stream worker

Serves HLS ('m3u8' provider) playlists/segments directly from
Cloudflare's edge instead of Vercel, so that bandwidth stops counting
against the Vercel plan. 'bunny', 'youtube', and 'mp4' are untouched —
they already bypass Vercel and this Worker never touches them.

See:
- `../lib/streamToken.ts` / `../app/api/video/[id]/stream-token/route.ts`
  — where the real authorization decision still happens, and what mints
  the token this Worker verifies.
- `../lib/m3u8.ts` — the original this Worker's `src/m3u8.ts` was ported
  from.
- `../components/VideoPlayer.tsx` — the client side that calls
  stream-token, builds the Worker URL, and keeps a fresh token flowing
  into hls.js via `xhrSetup`.

## One-time setup

1. Install dependencies:

   ```
   npm install
   ```

2. Log in to Cloudflare:

   ```
   npx wrangler login
   ```

3. Create the KV namespace used for rate limiting:

   ```
   npx wrangler kv namespace create STREAM_RATE_LIMIT
   ```

   Paste the returned `id` into `wrangler.toml`'s `kv_namespaces` entry.

4. Edit `wrangler.toml`'s `routes` entry to point at your real domain —
   replace `example.com` / `stream.example.com`. The zone must already
   exist on this Cloudflare account.

5. Set the shared secret. This MUST be the exact same value as the
   Next.js app's `STREAM_TOKEN_SECRET` env var (Vercel → Project →
   Settings → Environment Variables) — both sides derive the same
   AES-256-GCM key from this one string:

   ```
   npx wrangler secret put STREAM_TOKEN_SECRET
   ```

## Deploy

```
npx wrangler deploy
```

## Env vars to add on the Next.js (Vercel) side

Set both of these in Vercel → Project → Settings → Environment
Variables, for every environment (Production/Preview/Development) the
app actually serves m3u8 video from:

- `STREAM_TOKEN_SECRET` — a long random string, the exact same value
  set as the Worker secret above. Server-only — never exposed to the
  browser.
- `NEXT_PUBLIC_STREAM_WORKER_BASE` — e.g. `https://stream.example.com`
  (no trailing slash). Public on purpose: the browser builds the
  playback URL directly against it (see `VideoPlayer.tsx`), and it's
  also read at build time to add this origin to the app's
  `connect-src` CSP directive (see `../next.config.js`) — without that,
  hls.js's requests to the Worker are silently blocked by the browser.

## Env vars to set in Cloudflare (dashboard → Worker → Settings → Variables)

- `STREAM_TOKEN_SECRET` — set via `wrangler secret put` above (encrypted
  secret, not a plaintext variable). If you ever need to set/rotate it
  from the dashboard instead of the CLI, use the "Encrypt" toggle on
  that variable — never add it as a plaintext var.

## What this Worker intentionally does NOT change

- Bunny/community CDN configuration or expectations — untouched.
- The `referer_header` / secret-Referer protection model itself — this
  only relocates WHERE the header-injection fetch happens (Worker
  instead of a Vercel function), never how it works or what it protects
  against.
- The admin panel — videos/referer_header/board access continue to be
  managed exactly as today via the existing admin routes.
