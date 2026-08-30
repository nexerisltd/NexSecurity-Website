/**
 * Builds a YouTube embed URL for a video id, using youtube-nocookie.com
 * (YouTube's own "privacy-enhanced mode" domain — no tracking cookies set
 * until playback starts) with the deterrent params YouTube actually
 * allows disabling.
 *
 * Important: this is NOT protection. Unlike Bunny's signed, short-lived
 * embed token (see lib/bunny.ts), a YouTube video id never expires and
 * works forever for anyone who has it, from anywhere — that's an
 * inherent limitation of using YouTube for free hosting, not something
 * fixable with URL parameters. See app/api/video/[id]/play/route.ts for
 * the full reasoning.
 */
export function buildYoutubeEmbedUrl(videoGuid: string): string {
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoGuid)}?modestbranding=1&rel=0&iv_load_policy=3&playsinline=1`;
}

/** The inverse of buildYoutubeEmbedUrl — pulls the bare video id back out
 * of an embed URL built by it. Used by VideoPlayer.tsx to bootstrap the
 * IFrame Player API (which wants a bare video id, not a URL) from the
 * same `url` the server already sent, instead of a separate field. */
export function extractYoutubeId(embedUrl: string): string | null {
  const match = embedUrl.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}
