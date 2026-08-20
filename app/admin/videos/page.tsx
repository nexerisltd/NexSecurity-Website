'use client';

import { useEffect, useState } from 'react';
import { ThumbnailUpload } from '@/components/ThumbnailUpload';

type Board = { id: string; title: string; parent_id: string | null };
type Resource = { id: string; title: string; url: string; sort_order: number };
type Video = {
  id: string;
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  provider: string;
  source_ref: string;
  board_id: string;
  board: { id: string; title: string } | null;
  video_resources: Resource[];
  sort_order: number;
  download_url: string | null;
};

const RESOURCE_PRESETS = ['Lecture Sheet', 'Exam Sheet', 'Practice Sheet'];

// Accepts a full Bunny embed URL and pulls out "{libraryId}/{videoGuid}".
function parseBunnyEmbedUrl(input: string): string | null {
  const match = input.trim().match(/mediadelivery\.net\/embed\/([^/]+)\/([a-f0-9-]+)/i);
  if (!match) return null;
  return `${match[1]}/${match[2]}`;
}

function bunnyEmbedUrlFromSourceRef(sourceRef: string): string {
  return `https://iframe.mediadelivery.net/embed/${sourceRef}`;
}

export default function AdminVideosPage() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Create form
  const [boardId, setBoardId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [thumbnailUrl, setThumbnailUrl] = useState('');
  const [embedInput, setEmbedInput] = useState('');
  const [sortOrder, setSortOrder] = useState(0);
  const [downloadUrl, setDownloadUrl] = useState('');

  // Which video row is expanded for editing
  const [editingId, setEditingId] = useState<string | null>(null);

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
        sort_order: sortOrder,
        download_url: downloadUrl || null,
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
    setSortOrder(0);
    setDownloadUrl('');
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
        Attach a class (video) to a leaf board. After adding one, click{' '}
        <strong className="text-ink">Edit</strong> on it below to update details or attach a
        Lecture Sheet, Exam Sheet, or Practice Sheet.
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
        <Field label="Part number (order within this board)">
          <input
            type="number"
            min={0}
            value={sortOrder}
            onChange={(e) => setSortOrder(Number(e.target.value))}
            className="input"
          />
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
        </div>
        <div className="sm:col-span-2">
          <Field label="Thumbnail">
            <ThumbnailUpload value={thumbnailUrl} onChange={setThumbnailUrl} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Download link (optional, https)">
            <input
              value={downloadUrl}
              onChange={(e) => setDownloadUrl(e.target.value)}
              placeholder="https://…"
              className="input"
            />
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

      <div className="mt-6 space-y-3">
        {loading ? (
          <p className="text-center text-sm text-ink-faint">Loading…</p>
        ) : videos.length === 0 ? (
          <p className="rounded-xl border border-dashed border-vault-border p-6 text-center text-sm text-ink-faint">
            No classes yet.
          </p>
        ) : (
          videos.map((v) => (
            <div key={v.id} className="overflow-hidden rounded-xl border border-vault-border bg-vault-900">
              <div className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm text-ink">
                    <span className="mr-2 font-mono text-[10px] text-signal-glow">
                      #{v.sort_order}
                    </span>
                    {v.title}
                  </p>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">
                    {v.board?.title ?? '—'} · {v.video_resources?.length ?? 0} resource
                    {v.video_resources?.length === 1 ? '' : 's'}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setEditingId(editingId === v.id ? null : v.id)}
                    className="rounded-md border border-vault-border px-2.5 py-1 text-xs text-ink-dim transition hover:border-signal hover:text-ink"
                  >
                    {editingId === v.id ? 'Close' : 'Edit'}
                  </button>
                  <button
                    disabled={busyId === v.id}
                    onClick={() => removeVideo(v.id)}
                    className="rounded-md border border-danger/30 px-2.5 py-1 text-xs text-danger transition hover:bg-danger/10 disabled:opacity-50"
                  >
                    Remove
                  </button>
                </div>
              </div>

              {editingId === v.id && (
                <VideoEditPanel video={v} onSaved={load} onError={setError} />
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function VideoEditPanel({
  video,
  onSaved,
  onError,
}: {
  video: Video;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const [title, setTitle] = useState(video.title);
  const [description, setDescription] = useState(video.description ?? '');
  const [thumbnailUrl, setThumbnailUrl] = useState(video.thumbnail_url ?? '');
  const [embedInput, setEmbedInput] = useState(bunnyEmbedUrlFromSourceRef(video.source_ref));
  const [sortOrder, setSortOrder] = useState(video.sort_order ?? 0);
  const [downloadUrl, setDownloadUrl] = useState(video.download_url ?? '');
  const [saving, setSaving] = useState(false);

  const [resourceTitle, setResourceTitle] = useState('');
  const [resourceUrl, setResourceUrl] = useState('');
  const [addingResource, setAddingResource] = useState(false);
  const [resources, setResources] = useState<Resource[]>(video.video_resources ?? []);

  async function saveDetails(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const patch: Record<string, unknown> = {
      title,
      description: description || null,
      thumbnail_url: thumbnailUrl || null,
      sort_order: sortOrder,
      download_url: downloadUrl || null,
    };
    const sourceRef = parseBunnyEmbedUrl(embedInput);
    if (sourceRef) patch.source_ref = sourceRef;

    const res = await fetch(`/api/admin/videos/${video.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (!res.ok) onError(data.error ?? 'Could not update class.');
    setSaving(false);
    onSaved();
  }

  async function addResource(e: React.FormEvent) {
    e.preventDefault();
    if (!resourceTitle || !resourceUrl) return;
    setAddingResource(true);
    const res = await fetch('/api/admin/resources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        video_id: video.id,
        title: resourceTitle,
        url: resourceUrl,
        sort_order: resources.length,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      onError(data.error ?? 'Could not add resource.');
    } else {
      setResources([...resources, data.resource]);
      setResourceTitle('');
      setResourceUrl('');
    }
    setAddingResource(false);
    onSaved();
  }

  async function removeResource(id: string) {
    setResources(resources.filter((r) => r.id !== id));
    const res = await fetch(`/api/admin/resources/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) onError(data.error ?? 'Could not remove resource.');
    onSaved();
  }

  return (
    <div className="border-t border-vault-border bg-vault-800/50 p-5">
      <form onSubmit={saveDetails} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Title">
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="input" required />
        </Field>
        <Field label="Bunny embed URL">
          <input
            value={embedInput}
            onChange={(e) => setEmbedInput(e.target.value)}
            className="input font-mono text-xs"
          />
        </Field>
        <Field label="Part number (order within this board)">
          <input
            type="number"
            min={0}
            value={sortOrder}
            onChange={(e) => setSortOrder(Number(e.target.value))}
            className="input"
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Thumbnail">
            <ThumbnailUpload value={thumbnailUrl} onChange={setThumbnailUrl} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Download link (optional, https)">
            <input
              value={downloadUrl}
              onChange={(e) => setDownloadUrl(e.target.value)}
              placeholder="https://…"
              className="input"
            />
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
            disabled={saving}
            className="rounded-md bg-signal px-4 py-2 text-sm font-medium text-white transition hover:bg-signal-glow disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>

      <div className="mt-6 border-t border-vault-border pt-5">
        <p className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">
          Resources (Lecture Sheet, Exam Sheet, Practice Sheet…)
        </p>

        {resources.length > 0 && (
          <ul className="mt-3 space-y-2">
            {resources.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between rounded-md border border-vault-border bg-vault-900 px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <span className="text-ink">{r.title}</span>
                  <span className="ml-2 truncate font-mono text-[10px] text-ink-faint">{r.url}</span>
                </div>
                <button
                  onClick={() => removeResource(r.id)}
                  className="ml-3 shrink-0 text-xs text-danger hover:underline"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={addResource} className="mt-4 flex flex-wrap items-end gap-2">
          <div>
            <span className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">
              Name
            </span>
            <input
              value={resourceTitle}
              onChange={(e) => setResourceTitle(e.target.value)}
              placeholder="Lecture Sheet"
              className="input mt-1 w-40"
            />
            <div className="mt-1 flex gap-1">
              {RESOURCE_PRESETS.map((preset) => (
                <button
                  type="button"
                  key={preset}
                  onClick={() => setResourceTitle(preset)}
                  className="rounded border border-vault-border px-1.5 py-0.5 text-[10px] text-ink-faint hover:border-signal hover:text-ink"
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>
          <div className="min-w-[240px] flex-1">
            <span className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">
              Link (https)
            </span>
            <input
              value={resourceUrl}
              onChange={(e) => setResourceUrl(e.target.value)}
              placeholder="https://…"
              className="input mt-1"
            />
          </div>
          <button
            type="submit"
            disabled={addingResource}
            className="rounded-md border border-vault-border px-3 py-2 text-xs text-ink-dim transition hover:border-signal hover:text-ink disabled:opacity-50"
          >
            {addingResource ? 'Adding…' : 'Add resource'}
          </button>
        </form>
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
