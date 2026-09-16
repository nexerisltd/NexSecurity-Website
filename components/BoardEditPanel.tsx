'use client';

import { useEffect, useMemo, useState } from 'react';
import { ThumbnailUpload } from '@/components/ThumbnailUpload';
import { CascadingBoardSelect } from '@/components/CascadingBoardSelect';
import { UserMultiSelect } from '@/components/UserMultiSelect';
import { subtreeIds } from '@/lib/boardTree';

/**
 * Extracted out of the (now nav-hidden, but still reachable at
 * /admin/boards) standalone Boards admin page so the Classes page can
 * embed the exact same "Edit board" experience — full field set,
 * publish/restrict/visibility, per-board access grants — inline,
 * instead of needing a whole separate admin section just to rename a
 * board or restrict who can see it. Both pages render this from the
 * SAME component now; a future change to one no longer risks quietly
 * drifting from the other.
 */
export type EditableBoard = {
  id: string;
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  parent_id: string | null;
  published: boolean;
  sort_order: number;
  board_type: 'normal' | 'routine';
  routine_image_url: string | null;
  visibility: 'universal' | 'restricted';
};

type AdminUser = { email: string; role: 'USER' | 'ADMIN' };

export function BoardEditPanel({
  board,
  boards,
  onSaved,
  onError,
}: {
  board: EditableBoard;
  boards: EditableBoard[];
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const [title, setTitle] = useState(board.title);
  const [description, setDescription] = useState(board.description ?? '');
  const [thumbnailUrl, setThumbnailUrl] = useState(board.thumbnail_url ?? '');
  const [parentId, setParentId] = useState(board.parent_id ?? '');
  const [boardType, setBoardType] = useState<'normal' | 'routine'>(board.board_type ?? 'normal');
  const [routineImageUrl, setRoutineImageUrl] = useState(board.routine_image_url ?? '');
  const [visibility, setVisibility] = useState<'universal' | 'restricted'>(board.visibility ?? 'universal');
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
        visibility,
      }),
    });
    const data = await res.json();
    if (!res.ok) onError(data.error ?? 'Could not update board.');
    setSaving(false);
    onSaved();
  }

  return (
    <form onSubmit={save} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field label="Title">
        <input required value={title} onChange={(e) => setTitle(e.target.value)} className="input" />
      </Field>
      <Field label="Parent board">
        <CascadingBoardSelect boards={boards} value={parentId} onChange={setParentId} excludeIds={disallowed} requireSelection={false} />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Thumbnail">
          <ThumbnailUpload value={thumbnailUrl} onChange={setThumbnailUrl} />
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Field label="Description">
          <input value={description} onChange={(e) => setDescription(e.target.value)} className="input" />
        </Field>
      </div>
      <Field label="Board type">
        <select value={boardType} onChange={(e) => setBoardType(e.target.value as 'normal' | 'routine')} className="input">
          <option value="normal">Normal (boards / classes)</option>
          <option value="routine">Routine (just an image)</option>
        </select>
      </Field>
      <Field label="Visibility">
        <select value={visibility} onChange={(e) => setVisibility(e.target.value as 'universal' | 'restricted')} className="input">
          <option value="universal">Universal — everyone can see it</option>
          <option value="restricted">Restricted — only selected users</option>
        </select>
      </Field>
      {boardType === 'routine' && (
        <div className="sm:col-span-2">
          <Field label="Routine image (16:9 — this IS the routine)">
            <ThumbnailUpload value={routineImageUrl} onChange={setRoutineImageUrl} />
          </Field>
        </div>
      )}
      {visibility === 'restricted' && (
        <div className="sm:col-span-2">
          <Field label="Who can see this board (and everything nested under it)">
            <BoardAccessPicker boardId={board.id} boards={boards} onError={onError} />
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

/**
 * Manages board_user_access for one 'restricted' board — separate from
 * the main save button above (its own fetch, its own save action)
 * because the grant list is a different table/endpoint entirely.
 *
 * ADMIN-role accounts are left out of this checklist entirely — the
 * backend already lets every admin see every board regardless of any
 * grant (see lib/boardAccess.ts), so listing them here as if they also
 * needed picking was pure noise.
 */
function BoardAccessPicker({
  boardId,
  boards,
  onError,
}: {
  boardId: string;
  boards: EditableBoard[];
  onError: (msg: string) => void;
}) {
  const [allUsers, setAllUsers] = useState<AdminUser[]>([]);
  const [adminCount, setAdminCount] = useState(0);
  const [granted, setGranted] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedOnce, setSavedOnce] = useState(false);
  const [copyFromId, setCopyFromId] = useState('');
  const [applyingToSubBoards, setApplyingToSubBoards] = useState(false);
  const [applyResult, setApplyResult] = useState<string | null>(null);

  const otherRestrictedBoards = useMemo(
    () => boards.filter((b) => b.visibility === 'restricted' && b.id !== boardId),
    [boards, boardId]
  );
  const restrictedDescendantIds = useMemo(
    () =>
      Array.from(subtreeIds(boards, boardId)).filter((id) => {
        if (id === boardId) return false;
        const b = boards.find((bb) => bb.id === id);
        return b?.visibility === 'restricted';
      }),
    [boards, boardId]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [usersRes, accessRes] = await Promise.all([fetch('/api/admin/users'), fetch(`/api/admin/boards/${boardId}/access`)]);
      const usersData = await usersRes.json();
      const accessData = await accessRes.json();
      if (cancelled) return;
      if (usersRes.ok) {
        const users = (usersData.users ?? []) as AdminUser[];
        setAllUsers(users.filter((u) => u.role !== 'ADMIN'));
        setAdminCount(users.filter((u) => u.role === 'ADMIN').length);
      }
      if (accessRes.ok) setGranted(new Set((accessData.emails ?? []) as string[]));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [boardId]);

  async function copyFrom(otherBoardId: string) {
    if (!otherBoardId) return;
    const res = await fetch(`/api/admin/boards/${otherBoardId}/access`);
    const data = await res.json();
    if (!res.ok) {
      onError(data.error ?? 'Could not load that board\u2019s access list.');
      return;
    }
    setGranted((prev) => new Set([...prev, ...((data.emails ?? []) as string[])]));
    setSavedOnce(false);
  }

  async function saveAccess() {
    setSaving(true);
    const res = await fetch(`/api/admin/boards/${boardId}/access`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emails: Array.from(granted) }),
    });
    const data = await res.json();
    if (!res.ok) onError(data.error ?? 'Could not update access list.');
    else setSavedOnce(true);
    setSaving(false);
  }

  // Additive only, on purpose: this ADDS the currently-checked people to
  // every restricted board nested under this one, without touching
  // anyone already granted there.
  async function applyToSubBoards() {
    if (restrictedDescendantIds.length === 0 || granted.size === 0) return;
    setApplyingToSubBoards(true);
    setApplyResult(null);
    try {
      for (const id of restrictedDescendantIds) {
        const existingRes = await fetch(`/api/admin/boards/${id}/access`);
        const existingData = await existingRes.json();
        const existingEmails: string[] = existingRes.ok ? existingData.emails ?? [] : [];
        const merged = Array.from(new Set([...existingEmails, ...Array.from(granted)]));
        await fetch(`/api/admin/boards/${id}/access`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ emails: merged }),
        });
      }
      setApplyResult(`Added to ${restrictedDescendantIds.length} nested restricted board${restrictedDescendantIds.length === 1 ? '' : 's'}.`);
    } catch {
      onError('Could not apply access to every nested board — some may not have updated.');
    }
    setApplyingToSubBoards(false);
  }

  if (loading) return <p className="text-xs text-ink-faint">Loading users…</p>;

  return (
    <div>
      {otherRestrictedBoards.length > 0 && (
        <select
          value={copyFromId}
          onChange={(e) => {
            copyFrom(e.target.value);
            setCopyFromId('');
          }}
          className="input mb-2 !w-auto text-[11px]"
        >
          <option value="">Copy access from…</option>
          {otherRestrictedBoards.map((b) => (
            <option key={b.id} value={b.id}>
              {b.title}
            </option>
          ))}
        </select>
      )}
      <UserMultiSelect users={allUsers} selected={granted} onChange={setGranted} emptyLabel="No non-admin users to grant access to yet." />
      {adminCount > 0 && (
        <p className="mt-1.5 text-xs text-ink-faint">
          {adminCount} admin{adminCount === 1 ? '' : 's'} not shown — admins always have access to every board.
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={saveAccess}
          disabled={saving}
          className="rounded-md border border-vault-border px-2.5 py-1 text-xs text-ink-dim transition hover:border-signal hover:text-ink disabled:opacity-50"
        >
          {saving ? 'Saving access…' : 'Save access list'}
        </button>
        {savedOnce && <span className="font-mono text-[10px] uppercase tracking-widest text-ok">saved</span>}
      </div>
      {restrictedDescendantIds.length > 0 && (
        <div className="mt-3 rounded-md border border-vault-border/60 bg-vault-900/40 p-2.5">
          <p className="text-xs text-ink-dim">
            This board has {restrictedDescendantIds.length} restricted board{restrictedDescendantIds.length === 1 ? '' : 's'} nested
            under it. Access doesn&rsquo;t cascade automatically — each one needs its own grant.
          </p>
          <button
            type="button"
            onClick={applyToSubBoards}
            disabled={applyingToSubBoards || granted.size === 0}
            className="mt-1.5 rounded-md border border-signal/30 bg-signal/10 px-2.5 py-1 text-[11px] font-medium text-signal transition hover:bg-signal/20 disabled:opacity-50"
          >
            {applyingToSubBoards ? 'Applying…' : `Also add the ${granted.size} selected user${granted.size === 1 ? '' : 's'} to those`}
          </button>
          {applyResult && <p className="mt-1 text-xs text-ok">{applyResult}</p>}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
