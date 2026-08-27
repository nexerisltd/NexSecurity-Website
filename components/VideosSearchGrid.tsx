'use client';

import { useMemo, useState } from 'react';
import { SearchInput } from '@/components/SearchInput';
import { VideoCard } from '@/components/VideoCard';

type Video = {
  id: string;
  title: string;
  description?: string | null;
  thumbnail_url?: string | null;
  video_resources?: { title: string }[] | null;
};

export function VideosSearchGrid({ videos }: { videos: Video[] }) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return videos;
    return videos.filter((v) => `${v.title} ${v.description ?? ''}`.toLowerCase().includes(needle));
  }, [videos, query]);

  return (
    <div>
      {videos.length > 5 && (
        <SearchInput value={query} onChange={setQuery} placeholder="Search classes…" className="mt-4 max-w-sm" />
      )}
      {filtered.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-vault-border p-6 text-center text-sm text-ink-faint">
          {videos.length === 0 ? 'No classes yet.' : 'No classes match your search.'}
        </p>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((v) => {
            const i = videos.findIndex((x) => x.id === v.id);
            return (
              <VideoCard
                key={v.id}
                href={`/learn/video/${v.id}`}
                partLabel={`#${i + 1}`}
                title={v.title}
                description={v.description}
                thumbnailUrl={v.thumbnail_url}
                resourceLabels={(v.video_resources ?? []).map((r) => r.title)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
