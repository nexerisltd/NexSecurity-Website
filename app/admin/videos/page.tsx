'use client';

import { useEffect, useState } from 'react';
import { ThumbnailUpload } from '@/components/ThumbnailUpload';

type Board = { id: string; title: string; parent_id: string | null };
type Video = {
  id: string;
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  provider: string;
  source_ref: string;
  board_id: string;
  board: { id: string; title: string } | null;
};

// Accepts a full Bunny embed URL and pulls out "{libraryId}/{videoGuid}",
// which is the only part we store — nothing else from the pasted URL
// (query params, tokens, etc.) is kept.
function parseBunnyEmbedUrl(input: string): string | null {
  const match = input.trim().match(/mediadelivery\.net\/embed\/([^/]+)\/([a-f0-9-]+)/i);
  if (!match) return null;
  return `${match[1]}/${match[2]}`;
}

export default function AdminVideosPage() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [boardId, setBoardId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [thumbnailUrl, setThumbnailUrl] = useState('');
  const [embedInput, setEmbedInput] = useState('');

  async function load() {
    setLoading(true);
    const [videosRes, boardsRes] = await Promise.all([
      fetch('/api/admin/videos'),
      fetch('/api/admin/boards'),
    ]);
    const videosData = await videosRes.json();
    const boardsData = await boardsRes.json();
    if (videosRes.ok) setVideos(videosData.videos);
    if (boardsRes.ok) setBoards(boardsData.boards);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function createVideo(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const sourceRef = parseBunnyEmbedUrl(embedInput);
    if (!sourceRef) {
      setError(
        "Couldn't read that as a Bunny embed URL. It should look like https://iframe.mediadelivery.net/embed/LIBRARY_ID/VIDEO_ID"
      );
      return;
    }
    if (!boardId) {
      setError('Choose which board this class belongs to.');
      return;
    }

    const res = await fetch('/api/admin/videos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        board_id: boardId,
        title,
        description: description || null,
        thumbnail_url: thumbnailUrl || null,
        provider: 'bunny',
        source_ref: sourceRef,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'Could not add class.');
      return;
    }
    setBoardId('');
    setTitle('');
    setDescription('');
    setThumbnailUrl('');
    setEmbedInput('');
    load();
  }

  async function removeVideo(id: string) {
    if (!confirm('Remove this class? Members will no longer be able to play it.')) return;
    setBusyId(id);
    const res = await fetch(`/api/admin/videos/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) setError(data.error ?? 'Could not remove class.');
    setBusyId(null);
    load();
  }

  return (
    <div>
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-signal-glow">Admin</p>
      <h1 className="mt-2 font-display text-2xl font-semibold text-ink">Classes</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-dim">
        Attach a class (video) to a leaf board — one with no sub-boards of its own. The Bunny
        embed URL is never shown to members directly; it's converted into a short-lived, signed
        playback link every time someone opens the class.
      </p>

      <form
        onSubmit={createVideo}
        className="mt-6 grid grid-cols-1 gap-3 rounded-xl border border-vault-border bg-vault-900 p-5 sm:grid-cols-2"
      >
        <Field label="Board">
          <select value={boardId} onChange={(e) => setBoardId(e.target.value)} className="input" required>
            <option value="">— Select a board —</option>
            {boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Title">
          <input required value={title} onChange={(e) => setTitle(e.target.value)} className="input" />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Bunny embed URL">
            <input
              required
              value={embedInput}
              onChange={(e) => setEmbedInput(e.target.value)}
              placeholder="https://iframe.mediadelivery.net/embed/503487/df2a65b4-…"
              className="input font-mono text-xs"
            />
          </Field>
          <p className="mt-1 text-[11px] text-ink-faint">
            Paste the raw embed URL from Bunny — only the library ID and video ID are kept.
          </p>
        </div>
        <div className="sm:col-span-2">
          <Field label="Thumbnail">
            <ThumbnailUpload value={thumbnailUrl} onChange={setThumbnailUrl} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Description">
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="input"
            />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <button
            type="submit"
            className="rounded-md bg-signal px-4 py-2 text-sm font-medium text-white transition hover:bg-signal-glow"
          >
            Add class
          </button>
        </div>
      </form>

      {error && <p className="mt-3 text-xs text-danger">{error}</p>}

      <div className="mt-6 overflow-hidden rounded-xl border border-vault-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-vault-900 font-mono text-[10px] uppercase tracking-widest text-ink-faint">
            <tr>
              <th className="px-4 py-3">Title</th>
              <th className="px-4 py-3">Board</th>
              <th className="px-4 py-3">Provider</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-ink-faint">
                  Loading…
                </td>
              </tr>
            ) : videos.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-ink-faint">
                  No classes yet.
                </td>
              </tr>
            ) : (
              videos.map((v) => (
                <tr key={v.id} className="border-t border-vault-border bg-vault-900/50">
                  <td className="px-4 py-3 text-ink">{v.title}</td>
                  <td className="px-4 py-3 text-ink-dim">{v.board?.title ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-[10px] uppercase tracking-widest text-ink-dim">
                      {v.provider}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button
                        disabled={busyId === v.id}
                        onClick={() => removeVideo(v.id)}
                        className="rounded-md border border-danger/30 px-2.5 py-1 text-xs text-danger transition hover:bg-danger/10 disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">
        {label}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
