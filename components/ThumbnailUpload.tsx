'use client';

import { useState } from 'react';
import { compressImageFile } from '@/lib/imageCompress';

export function ThumbnailUpload({
  value,
  onChange,
}: {
  value: string;
  onChange: (url: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);
    try {
      // Shrink/re-encode BEFORE it ever leaves the browser — see
      // lib/imageCompress.ts for why this replaced relying on Vercel's
      // (metered, quota-limited) on-the-fly image optimization.
      const toUpload = await compressImageFile(file);
      const formData = new FormData();
      formData.append('file', toUpload);
      const res = await fetch('/api/admin/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Upload failed.');
      onChange(data.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  return (
    <div>
      <div className="flex items-center gap-3">
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="" className="h-14 w-24 rounded-md object-cover border border-vault-border" />
        ) : (
          <div className="flex h-14 w-24 items-center justify-center rounded-md border border-dashed border-vault-border text-[10px] text-ink-faint">
            No image
          </div>
        )}
        <label className="cursor-pointer rounded-md border border-vault-border px-3 py-1.5 text-xs text-ink-dim transition hover:border-signal hover:text-ink">
          {uploading ? 'Uploading…' : value ? 'Replace image' : 'Upload image'}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={handleFile}
            disabled={uploading}
          />
        </label>
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="text-xs text-ink-faint underline hover:text-danger"
          >
            Remove
          </button>
        )}
      </div>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
