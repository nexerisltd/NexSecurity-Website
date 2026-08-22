import 'server-only';
import crypto from 'crypto';

/**
 * Required env vars (Vercel Project Settings → Environment Variables,
 * server-side only — never exposed with a NEXT_PUBLIC_ prefix):
 *
 *   BUNNY_STREAM_LIBRARY_ID        e.g. "123456"
 *   BUNNY_STREAM_API_KEY           Stream API key (dashboard → Stream → API)
 *   BUNNY_PULL_ZONE_HOSTNAME       e.g. "vz-abc123-xyz.b-cdn.net" (no https://)
 *   BUNNY_TOKEN_AUTH_ENABLED       "true" if the pull zone has Token
 *                                  Authentication turned on, otherwise omit
 *   BUNNY_TOKEN_AUTH_SECURITY_KEY  the pull zone's token auth security key
 *                                  (only needed if the above is "true")
 *
 * Note: BUNNY_STREAM_LIBRARY_ID here is a fallback/default — the actual
 * library ID used for a given video is read from that video's own
 * source_ref ("{libraryId}/{videoGuid}", same field /api/video/[id]/play
 * already uses), so this still works correctly even with videos spread
 * across multiple libraries.
 */

const API_KEY = process.env.BUNNY_STREAM_API_KEY;
const PULL_ZONE_HOSTNAME = process.env.BUNNY_PULL_ZONE_HOSTNAME;
const TOKEN_AUTH_ENABLED = process.env.BUNNY_TOKEN_AUTH_ENABLED === 'true';
const TOKEN_AUTH_SECURITY_KEY = process.env.BUNNY_TOKEN_AUTH_SECURITY_KEY;

export function bunnyDownloadConfigured(): boolean {
  return Boolean(API_KEY && PULL_ZONE_HOSTNAME && (!TOKEN_AUTH_ENABLED || TOKEN_AUTH_SECURITY_KEY));
}

/**
 * GET /library/{libraryId}/videos/{videoId} — availableResolutions comes
 * back as a comma-separated string like "240p,360p,480p,1080p" (only
 * resolutions actually finished encoding are listed, which is what keeps
 * generated download links from ever 404ing).
 */
export async function getAvailableResolutions(
  libraryId: string,
  bunnyVideoId: string
): Promise<string[]> {
  if (!API_KEY) return [];
  const res = await fetch(`https://video.bunnycdn.com/library/${libraryId}/videos/${bunnyVideoId}`, {
    headers: { AccessKey: API_KEY, Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) return [];
  const data = await res.json();
  const raw = typeof data.availableResolutions === 'string' ? data.availableResolutions : '';
  return raw
    .split(',')
    .map((r: string) => r.trim())
    .filter(Boolean);
}

/**
 * BunnyCDN (basic) Token Authentication:
 *   token = Base64( SHA256_RAW(security_key + url_path + expires) )
 * then URL-safe-encoded (+/= replaced, no padding). See
 * https://support.bunny.net/hc/en-us/articles/360016055099
 */
function signPath(path: string, expires: number): string {
  const hashable = `${TOKEN_AUTH_SECURITY_KEY}${path}${expires}`;
  const raw = crypto.createHash('sha256').update(hashable).digest('base64');
  return raw.replace(/\n/g, '').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Builds a downloadable MP4 URL for one resolution. Short-lived (default
 * 5 minutes) when Token Authentication is on, so a copied/shared link
 * stops working almost immediately — this is generated fresh, on demand,
 * per click, never stored or reused.
 */
export function buildDownloadUrl(bunnyVideoId: string, resolution: string, ttlSeconds = 300): string {
  const path = `/${bunnyVideoId}/play_${resolution}.mp4`;
  const base = `https://${PULL_ZONE_HOSTNAME}${path}`;
  if (!TOKEN_AUTH_ENABLED) return base;
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const token = signPath(path, expires);
  return `${base}?token=${token}&expires=${expires}`;
}
