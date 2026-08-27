'use client';

import { useEffect, useMemo, useState } from 'react';
import { ThumbnailUpload } from '@/components/ThumbnailUpload';
import { SearchInput } from '@/components/SearchInput';
import { orderBoardsHierarchically, subtreeIds, type BoardNode } from '@/lib/boardTree';

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
  const [search, setSearch] = useState('');

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

  // Top-Level (parent_id = null) first, then each board's own children
  // directly beneath it, depth-first — this is the "sectioned by level"
  // order used everywhere below: the tree view, and both parent-board
  // dropdowns. See lib/boardTree.ts.
  const ordered = useMemo(() => orderBoardsHierarchically(boards), [boards]);

  // Search matches by title; a match's ancestors are kept too (even if
  // their own title doesn't match) so the result still reads as a
  // section — e.g. searching "physics" keeps "Class 9" visible above it.
  const filteredOrdered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return ordered;
    const byId = new Map(boards.map((b) => [b.id, b]));
    const keep = new Set<string>();
    for (const b of ordered) {
      if (b.title.toLowerCase().includes(needle)) {
        let cur: Board | undefined = b;
        while (cur) {
          keep.add(cur.id);
          cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
        }
      }
    }
    return ordered.filter((b) => keep.has(b.id));
  }, [ordered, search, boards]);

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
        Create top-level boards (leave parent empty) or nest one inside another — including
        inside a board you already nested (e.g. Top-Level → Physics → Chapter 1). Click{' '}
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
          <ParentBoardSelect value={parentId} onChange={setParentId} options={ordered} />
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

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-mono text-[11px] uppercase tracking-widest text-ink-faint">
          All boards, by section
        </h2>
        {boards.length > 5 && (
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search boards…"
            className="w-full sm:w-64"
          />
        )}
      </div>

      <div className="mt-3 space-y-2">
        {loading ? (
          <p className="text-center text-sm text-ink-faint">Loading…</p>
        ) : boards.length === 0 ? (
          <p className="rounded-xl border border-dashed border-vault-border p-6 text-center text-sm text-ink-faint">
            No boards yet.
          </p>
        ) : filteredOrdered.length === 0 ? (
          <p className="rounded-xl border border-dashed border-vault-border p-6 text-center text-sm text-ink-faint">
            No boards match &ldquo;{search}&rdquo;.
          </p>
        ) : (
          filteredOrdered.map((b) => (
            <div
              key={b.id}
              style={{ marginLeft: b.depth * 24 }}
              className="overflow-hidden rounded-xl border border-vault-border bg-vault-900 backdrop-blur-xl shadow-glass"
            >
              <div className="flex items-center justify-between px-4 py-3">
                <div className="flex min-w-0 items-center gap-2">
                  {b.depth > 0 && <span className="shrink-0 text-ink-faint">↳</span>}
                  <div className="min-w-0">
                    <p className="truncate text-sm text-ink">{b.title}</p>
                    <p className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">
                      {b.depth === 0 ? 'Top-Level' : `Sub-Level · depth ${b.depth}`} ·{' '}
                      <span className={b.published ? 'text-ok' : 'text-warn'}>
                        {b.published ? 'Published' : 'Draft'}
                      </span>
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
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
                  ordered={ordered}
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

/** Parent-board <select> with each option indented to match its depth, so
 * Top-Level boards read as section headers and every descendant sits
 * visibly underneath the board it belongs to. */
function ParentBoardSelect({
  value,
  onChange,
  options,
  excludeIds,
}: {
  value: string;
  onChange: (id: string) => void;
  options: BoardNode<Board>[];
  excludeIds?: Set<string>;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="input">
      <option value="">— Top level —</option>
      {options
        .filter((b) => !excludeIds?.has(b.id))
        .map((b) => (
          <option key={b.id} value={b.id}>
            {'—'.repeat(b.depth)} {b.depth > 0 ? ' ' : ''}
            {b.title}
          </option>
        ))}
    </select>
  );
}

function BoardEditPanel({
  board,
  boards,
  ordered,
  onSaved,
  onError,
}: {
  board: Board;
  boards: Board[];
  ordered: BoardNode<Board>[];
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

  // A board can never become its own parent, nor be reparented under one
  // of its own descendants — either would create a cycle the database
  // won't reject for you, silently corrupting the tree.
  const disallowed = useMemo(() => subtreeIds(boards, board.id), [boards, board.id]);

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
        <ParentBoardSelect value={parentId} onChange={setParentId} options={ordered} excludeIds={disallowed} />
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
