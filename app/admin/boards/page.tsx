'use client';

import { useEffect, useState } from 'react';
import { ThumbnailUpload } from '@/components/ThumbnailUpload';

type Board = {
  id: string;
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  parent_id: string | null;
  published: boolean;
  sort_order: number;
  board_type: 'normal' | 'routine';
  routine_image_url: string | null;
};

export default function AdminBoardsPage() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [thumbnailUrl, setThumbnailUrl] = useState('');
  const [parentId, setParentId] = useState('');
  const [boardType, setBoardType] = useState<'normal' | 'routine'>('normal');
  const [routineImageUrl, setRoutineImageUrl] = useState('');

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
        board_type: boardType,
        routine_image_url: boardType === 'routine' ? routineImageUrl || null : null,
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
    setBoardType('normal');
    setRoutineImageUrl('');
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
        Create top-level boards (leave parent empty) or nest one inside another. Click{' '}
        <strong className="text-ink">Edit</strong> on an existing board to update its title,
        description, thumbnail, or parent.
      </p>

      <form
        onSubmit={createBoard}
        className="mt-6 grid grid-cols-1 gap-3 rounded-xl border border-vault-border bg-vault-900 p-5 sm:grid-cols-2 backdrop-blur-xl shadow-glass"
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
        <div className="sm:col-span-2">
          <Field label="Thumbnail">
            <ThumbnailUpload value={thumbnailUrl} onChange={setThumbnailUrl} />
          </Field>
        </div>
        <Field label="Description">
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="input"
          />
        </Field>
        <Field label="Board type">
          <select
            value={boardType}
            onChange={(e) => setBoardType(e.target.value as 'normal' | 'routine')}
            className="input"
          >
            <option value="normal">Normal (boards / classes)</option>
            <option value="routine">Routine (just an image)</option>
          </select>
        </Field>
        {boardType === 'routine' && (
          <div className="sm:col-span-2">
            <Field label="Routine image (16:9 — this IS the routine)">
              <ThumbnailUpload value={routineImageUrl} onChange={setRoutineImageUrl} />
            </Field>
          </div>
        )}
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

      <div className="mt-6 space-y-3">
        {loading ? (
          <p className="text-center text-sm text-ink-faint">Loading…</p>
        ) : boards.length === 0 ? (
          <p className="rounded-xl border border-dashed border-vault-border p-6 text-center text-sm text-ink-faint">
            No boards yet.
          </p>
        ) : (
          boards.map((b) => (
            <div key={b.id} className="overflow-hidden rounded-xl border border-vault-border bg-vault-900 backdrop-blur-xl shadow-glass">
              <div className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm text-ink">{b.title}</p>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">
                    {boards.find((p) => p.id === b.parent_id)?.title ?? 'Top level'} ·{' '}
                    <span className={b.published ? 'text-ok' : 'text-warn'}>
                      {b.published ? 'Published' : 'Draft'}
                    </span>
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    disabled={busyId === b.id}
                    onClick={() => togglePublished(b)}
                    className="rounded-md border border-vault-border px-2.5 py-1 text-xs text-ink-dim transition hover:border-signal hover:text-ink disabled:opacity-50"
                  >
                    {b.published ? 'Unpublish' : 'Publish'}
                  </button>
                  <button
                    onClick={() => setEditingId(editingId === b.id ? null : b.id)}
                    className="rounded-md border border-vault-border px-2.5 py-1 text-xs text-ink-dim transition hover:border-signal hover:text-ink"
                  >
                    {editingId === b.id ? 'Close' : 'Edit'}
                  </button>
                  <button
                    disabled={busyId === b.id}
                    onClick={() => removeBoard(b.id)}
                    className="rounded-md border border-danger/30 px-2.5 py-1 text-xs text-danger transition hover:bg-danger/10 disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              </div>

              {editingId === b.id && (
                <BoardEditPanel
                  board={b}
                  boards={boards}
                  onSaved={load}
                  onError={setError}
                />
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function BoardEditPanel({
  board,
  boards,
  onSaved,
  onError,
}: {
  board: Board;
  boards: Board[];
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const [title, setTitle] = useState(board.title);
  const [description, setDescription] = useState(board.description ?? '');
  const [thumbnailUrl, setThumbnailUrl] = useState(board.thumbnail_url ?? '');
  const [parentId, setParentId] = useState(board.parent_id ?? '');
  const [boardType, setBoardType] = useState<'normal' | 'routine'>(board.board_type ?? 'normal');
  const [routineImageUrl, setRoutineImageUrl] = useState(board.routine_image_url ?? '');
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await fetch(`/api/admin/boards/${board.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        description: description || null,
        thumbnail_url: thumbnailUrl || null,
        parent_id: parentId || null,
        board_type: boardType,
        routine_image_url: boardType === 'routine' ? routineImageUrl || null : null,
      }),
    });
    const data = await res.json();
    if (!res.ok) onError(data.error ?? 'Could not update board.');
    setSaving(false);
    onSaved();
  }

  return (
    <form
      onSubmit={save}
      className="grid grid-cols-1 gap-3 border-t border-vault-border bg-vault-800/50 p-5 sm:grid-cols-2"
    >
      <Field label="Title">
        <input required value={title} onChange={(e) => setTitle(e.target.value)} className="input" />
      </Field>
      <Field label="Parent board">
        <select value={parentId} onChange={(e) => setParentId(e.target.value)} className="input">
          <option value="">— Top level —</option>
          {boards
            .filter((b) => b.id !== board.id)
            .map((b) => (
              <option key={b.id} value={b.id}>
                {b.title}
              </option>
            ))}
        </select>
      </Field>
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
      <Field label="Board type">
        <select
          value={boardType}
          onChange={(e) => setBoardType(e.target.value as 'normal' | 'routine')}
          className="input"
        >
          <option value="normal">Normal (boards / classes)</option>
          <option value="routine">Routine (just an image)</option>
        </select>
      </Field>
      {boardType === 'routine' && (
        <div className="sm:col-span-2">
          <Field label="Routine image (16:9 — this IS the routine)">
            <ThumbnailUpload value={routineImageUrl} onChange={setRoutineImageUrl} />
          </Field>
        </div>
      )}
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
