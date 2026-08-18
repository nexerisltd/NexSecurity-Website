'use client';

import { useEffect, useState } from 'react';

export function VideoPlayer({ videoId }: { videoId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchPlaybackUrl() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/video/${videoId}/play`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Playback unavailable.');
        if (!cancelled) setUrl(data.url);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Playback unavailable.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchPlaybackUrl();
    return () => {
      cancelled = true;
    };
  }, [videoId]);

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-vault-border bg-vault-800">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-mono text-xs uppercase tracking-widest text-ink-faint">
            Verifying access…
          </span>
        </div>
      )}
      {error && !loading && (
        <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
          <span className="font-mono text-xs uppercase tracking-widest text-danger">
            {error}
          </span>
        </div>
      )}
      {url && !loading && !error && (
        // Signed URL, short expiry, fetched fresh per session — never a
        // permanent link, and it's never present in page source or any
        // board-list API response.
        <video
          src={url}
          controls
          controlsList="nodownload"
          className="h-full w-full"
          onContextMenu={(e) => e.preventDefault()}
        />
      )}
    </div>
  );
}
