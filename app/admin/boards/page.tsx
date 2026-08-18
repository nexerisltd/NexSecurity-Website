'use client';

import { useEffect, useState } from 'react';

type Board = {
  id: string;
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  parent_id: string | null;
  published: boolean;
  sort_order: number;
};

export default function AdminBoardsPage() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [thumbnailUrl, setThumbnailUrl] = useState('');
  const [parentId, setParentId] = useState('');

  async function load() {
    setLoading(true);
    const res = await fetch('/api/admin/boards');
    const data = await res.json();
    if (res.ok) setBoards(data.boards);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function createBoard(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch('/api/admin/boards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        description: description || null,
        thumbnail_url: thumbnailUrl || null,
        parent_id: parentId || null,
        published: false,
        sort_order: 0,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'Could not create board.');
      return;
    }
    setTitle('');
    setDescription('');
    setThumbnailUrl('');
    setParentId('');
    load();
  }

  async function togglePublished(board: Board) {
    setBusyId(board.id);
    const res = await fetch(`/api/admin/boards/${board.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ published: !board.published }),
    });
    const data = await res.json();
    if (!res.ok) setError(data.error ?? 'Could not update board.');
    setBusyId(null);
    load();
  }

  async function removeBoard(id: string) {
    if (!confirm('Delete this board? Child boards will also be removed.')) return;
    setBusyId(id);
    const res = await fetch(`/api/admin/boards/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) setError(data.error ?? 'Could not delete board.');
    setBusyId(null);
    load();
  }

  return (
    <div>
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-signal-glow">Admin</p>
      <h1 className="mt-2 font-display text-2xl font-semibold text-ink">Boards</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-dim">
        Create top-level boards (leave parent empty) or nest one inside another. A board with no
        children and no attached video shows as empty on Learn until you add a video from here in
        a future pass, or wire one up directly via the <code className="text-ink">videos</code>{' '}
        table for now.
      </p>

      <form
        onSubmit={createBoard}
        className="mt-6 grid grid-cols-1 gap-3 rounded-xl border border-vault-border bg-vault-900 p-5 sm:grid-cols-2"
      >
        <Field label="Title">
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="input"
          />
        </Field>
        <Field label="Parent board (optional)">
          <select value={parentId} onChange={(e) => setParentId(e.target.value)} className="input">
            <option value="">— Top level —</option>
            {boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Thumbnail URL (https)">
          <input
            value={thumbnailUrl}
            onChange={(e) => setThumbnailUrl(e.target.value)}
            placeholder="https://…"
            className="input"
          />
        </Field>
        <Field label="Description">
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="input"
          />
        </Field>
        <div className="sm:col-span-2">
          <button
            type="submit"
            className="rounded-md bg-signal px-4 py-2 text-sm font-medium text-white transition hover:bg-signal-glow"
          >
            Create board (unpublished)
          </button>
        </div>
      </form>

      {error && <p className="mt-3 text-xs text-danger">{error}</p>}

      <div className="mt-6 overflow-hidden rounded-xl border border-vault-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-vault-900 font-mono text-[10px] uppercase tracking-widest text-ink-faint">
            <tr>
              <th className="px-4 py-3">Title</th>
              <th className="px-4 py-3">Parent</th>
              <th className="px-4 py-3">Status</th>
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
            ) : boards.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-ink-faint">
                  No boards yet.
                </td>
              </tr>
            ) : (
              boards.map((b) => (
                <tr key={b.id} className="border-t border-vault-border bg-vault-900/50">
                  <td className="px-4 py-3 text-ink">{b.title}</td>
                  <td className="px-4 py-3 text-ink-dim">
                    {boards.find((p) => p.id === b.parent_id)?.title ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`font-mono text-[10px] uppercase tracking-widest ${
                        b.published ? 'text-ok' : 'text-warn'
                      }`}
                    >
                      {b.published ? 'Published' : 'Draft'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button
                        disabled={busyId === b.id}
                        onClick={() => togglePublished(b)}
                        className="rounded-md border border-vault-border px-2.5 py-1 text-xs text-ink-dim transition hover:border-signal hover:text-ink disabled:opacity-50"
                      >
                        {b.published ? 'Unpublish' : 'Publish'}
                      </button>
                      <button
                        disabled={busyId === b.id}
                        onClick={() => removeBoard(b.id)}
                        className="rounded-md border border-danger/30 px-2.5 py-1 text-xs text-danger transition hover:bg-danger/10 disabled:opacity-50"
                      >
                        Delete
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
