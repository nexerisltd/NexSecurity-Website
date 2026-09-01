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

// Accepts any common YouTube URL shape (watch?v=, youtu.be/, /embed/,
// /shorts/) or a bare 11-character video id pasted directly, and returns
// just the id — what videos.source_ref stores for provider='youtube'.
function parseYoutubeVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtube-nocookie\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /youtube(?:-nocookie)?\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const re of patterns) {
    const match = trimmed.match(re);
    if (match) return match[1];
  }
  return null;
}

function youtubeWatchUrlFromSourceRef(sourceRef: string): string {
  return `https://www.youtube.com/watch?v=${sourceRef}`;
}

// mp4: source_ref *is* the playable URL — nothing to parse out of an
// embed page, just make sure it's a real https URL before it's saved.
function parseMp4Url(input: string): string | null {
  const trimmed = input.trim();
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') return null;
  } catch {
    return null;
  }
  return trimmed;
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
  const [createProvider, setCreateProvider] = useState<'bunny' | 'youtube' | 'mp4'>('bunny');
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

    const sourceRef =
      createProvider === 'bunny'
        ? parseBunnyEmbedUrl(embedInput)
        : createProvider === 'youtube'
          ? parseYoutubeVideoId(embedInput)
          : parseMp4Url(embedInput);
    if (!sourceRef) {
      setError(
        createProvider === 'bunny'
          ? "Couldn't read that as a Bunny embed URL. It should look like https://iframe.mediadelivery.net/embed/LIBRARY_ID/VIDEO_ID"
          : createProvider === 'youtube'
            ? "Couldn't read that as a YouTube link. Paste the full video URL (youtube.com/watch?v=... or youtu.be/...) or just the 11-character video id."
            : "Couldn't read that as a direct video URL. It needs to be a full https link straight to the .mp4 file."
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
        provider: createProvider,
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
    setCreateProvider('bunny');
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
        className="mt-6 grid grid-cols-1 gap-3 rounded-xl border border-vault-border bg-vault-900 p-5 sm:grid-cols-2 backdrop-blur-xl shadow-glass"
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
          <Field label="Video source">
            <div className="flex gap-4">
              <label className="flex items-center gap-1.5 text-sm text-ink">
                <input
                  type="radio"
                  name="create-provider"
                  checked={createProvider === 'bunny'}
                  onChange={() => {
                    setCreateProvider('bunny');
                    setEmbedInput('');
                  }}
                />
                Bunny (protected)
              </label>
              <label className="flex items-center gap-1.5 text-sm text-ink">
                <input
                  type="radio"
                  name="create-provider"
                  checked={createProvider === 'youtube'}
                  onChange={() => {
                    setCreateProvider('youtube');
                    setEmbedInput('');
                  }}
                />
                YouTube (free, unlisted)
              </label>
              <label className="flex items-center gap-1.5 text-sm text-ink">
                <input
                  type="radio"
                  name="create-provider"
                  checked={createProvider === 'mp4'}
                  onChange={() => {
                    setCreateProvider('mp4');
                    setEmbedInput('');
                  }}
                />
                Direct MP4 URL
              </label>
            </div>
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field
            label={
              createProvider === 'bunny'
                ? 'Bunny embed URL'
                : createProvider === 'youtube'
                  ? 'YouTube video URL'
                  : 'Direct video URL (.mp4)'
            }
          >
            <input
              required
              value={embedInput}
              onChange={(e) => setEmbedInput(e.target.value)}
              placeholder={
                createProvider === 'bunny'
                  ? 'https://iframe.mediadelivery.net/embed/503487/df2a65b4-…'
                  : createProvider === 'youtube'
                    ? 'https://www.youtube.com/watch?v=… (make sure it is Unlisted, not Public)'
                    : 'https://example.com/path/video.mp4'
              }
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
            <div key={v.id} className="overflow-hidden rounded-xl border border-vault-border bg-vault-900 backdrop-blur-xl shadow-glass">
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
                    {v.video_resources?.length === 1 ? '' : 's'} ·{' '}
                    <span
                      className={
                        v.provider === 'youtube'
                          ? 'text-warn'
                          : v.provider === 'mp4'
                            ? 'text-signal-glow'
                            : 'text-ok'
                      }
                    >
                      {v.provider === 'youtube' ? 'YouTube' : v.provider === 'mp4' ? 'Direct MP4' : 'Bunny'}
                    </span>
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
  const [editProvider, setEditProvider] = useState<'bunny' | 'youtube' | 'mp4'>(
    video.provider === 'youtube' ? 'youtube' : video.provider === 'mp4' ? 'mp4' : 'bunny'
  );
  const [embedInput, setEmbedInput] = useState(
    video.provider === 'youtube'
      ? youtubeWatchUrlFromSourceRef(video.source_ref)
      : video.provider === 'mp4'
        ? video.source_ref
        : bunnyEmbedUrlFromSourceRef(video.source_ref)
  );
  const [sortOrder, setSortOrder] = useState(video.sort_order ?? 0);
  const [downloadUrl, setDownloadUrl] = useState(video.download_url ?? '');
  const [saving, setSaving] = useState(false);

  const [resourceTitle, setResourceTitle] = useState('');
  const [resourceUrl, setResourceUrl] = useState('');
  const [addingResource, setAddingResource] = useState(false);
  const [resources, setResources] = useState<Resource[]>(video.video_resources ?? []);

  async function saveDetails(e: React.FormEvent) {
    e.preventDefault();
    const sourceRef =
      editProvider === 'bunny'
        ? parseBunnyEmbedUrl(embedInput)
        : editProvider === 'youtube'
          ? parseYoutubeVideoId(embedInput)
          : parseMp4Url(embedInput);

    // Switching provider (or re-pasting the URL) requires a URL that
    // actually parses — otherwise this would silently keep the OLD
    // provider's source_ref while the provider field itself changes,
    // breaking playback with no visible error until a student hits it.
    if (editProvider !== video.provider && !sourceRef) {
      onError(
        editProvider === 'bunny'
          ? "Couldn't read that as a Bunny embed URL. Paste the full embed URL to switch providers."
          : editProvider === 'youtube'
            ? "Couldn't read that as a YouTube link. Paste the video URL or id to switch providers."
            : "Couldn't read that as a direct video URL. Paste a full https .mp4 link to switch providers."
      );
      return;
    }

    setSaving(true);
    const patch: Record<string, unknown> = {
      title,
      description: description || null,
      thumbnail_url: thumbnailUrl || null,
      sort_order: sortOrder,
      download_url: downloadUrl || null,
      provider: editProvider,
    };
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
        <div className="sm:col-span-2">
          <Field label="Video source">
            <div className="flex gap-4">
              <label className="flex items-center gap-1.5 text-sm text-ink">
                <input
                  type="radio"
                  name={`edit-provider-${video.id}`}
                  checked={editProvider === 'bunny'}
                  onChange={() => {
                    setEditProvider('bunny');
                    setEmbedInput(video.provider === 'bunny' ? bunnyEmbedUrlFromSourceRef(video.source_ref) : '');
                  }}
                />
                Bunny (protected)
              </label>
              <label className="flex items-center gap-1.5 text-sm text-ink">
                <input
                  type="radio"
                  name={`edit-provider-${video.id}`}
                  checked={editProvider === 'youtube'}
                  onChange={() => {
                    setEditProvider('youtube');
                    setEmbedInput(video.provider === 'youtube' ? youtubeWatchUrlFromSourceRef(video.source_ref) : '');
                  }}
                />
                YouTube (free, unlisted)
              </label>
              <label className="flex items-center gap-1.5 text-sm text-ink">
                <input
                  type="radio"
                  name={`edit-provider-${video.id}`}
                  checked={editProvider === 'mp4'}
                  onChange={() => {
                    setEditProvider('mp4');
                    setEmbedInput(video.provider === 'mp4' ? video.source_ref : '');
                  }}
                />
                Direct MP4 URL
              </label>
            </div>
          </Field>
        </div>
        <Field
          label={
            editProvider === 'bunny'
              ? 'Bunny embed URL'
              : editProvider === 'youtube'
                ? 'YouTube video URL'
                : 'Direct video URL (.mp4)'
          }
        >
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
                className="flex items-center justify-between rounded-md border border-vault-border bg-vault-900 px-3 py-2 text-sm backdrop-blur-xl shadow-glass"
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
