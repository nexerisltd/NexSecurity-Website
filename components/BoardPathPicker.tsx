'use client';

import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { ThumbnailUpload } from '@/components/ThumbnailUpload';
import { ancestorIds, type TreeBoard } from '@/lib/boardTree';

const NEW_BOARD_VALUE = '__new__';

type ChainEntry =
  | { mode: 'existing'; boardId: string }
  | { mode: 'new'; title: string; thumbnailUrl: string; description: string; showAdvanced: boolean };

export type BoardPathPickerHandle = {
  /**
   * Walks the chain the admin built: an 'existing' entry is reused as-
   * is; a 'new' entry gets created via the SAME /api/admin/boards POST
   * + boardSchema every other board-create flow uses (title is the only
   * required field — see lib/validation.ts's boardSchema — so leaving
   * thumbnail/description blank is always fine). Returns the final
   * (leaf) board id to attach the class to, or an error if any create
   * call failed partway through — boards already created before the
   * failure are NOT rolled back.
   */
  resolvePath: () => Promise<{ boardId: string } | { error: string }>;
};

/**
 * A real <select> dropdown of existing boards at each level — same
 * familiar cascading-picker feel as CascadingBoardSelect — with one
 * extra option baked right into that same dropdown: "+ Create new
 * board here". Picking it swaps that level (and, since there's nothing
 * existing to look inside yet, every level below it) into a plain text
 * input for a brand-new board name, optionally with thumbnail/
 * description. Existing-board levels and new-board levels can freely
 * mix in one path — e.g. an existing "Physics" top-level board with a
 * brand-new "Chapter 12" sub-board created under it in the same submit.
 */
export const BoardPathPicker = forwardRef<
  BoardPathPickerHandle,
  { boards: TreeBoard[]; onBoardsCreated?: () => void; initialBoardId?: string }
>(function BoardPathPicker({ boards, onBoardsCreated, initialBoardId }, ref) {
  const [chain, setChain] = useState<ChainEntry[]>([]);
  const [resolving, setResolving] = useState(false);

  const byParent = useMemo(() => {
    const map = new Map<string | null, TreeBoard[]>();
    for (const b of boards) {
      const key = b.parent_id ?? null;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(b);
    }
    for (const list of map.values()) list.sort((a, c) => a.title.localeCompare(c.title));
    return map;
  }, [boards]);

  // Deep-link support (the "+ Class" button on a board's row in the
  // Boards admin page lands here as ?board=<id>) — seeds the picker
  // with that board's real existing path as a chain of 'existing'
  // entries, so the admin doesn't have to re-pick a path they didn't
  // choose to change.
  useEffect(() => {
    if (!initialBoardId) return;
    const board = boards.find((b) => b.id === initialBoardId);
    if (!board) return;
    const ids = [...ancestorIds(boards, initialBoardId), initialBoardId];
    setChain(ids.map((boardId): ChainEntry => ({ mode: 'existing', boardId })));
    // Only ever seed once per id — deliberately excludes `boards` so
    // this doesn't fight the admin's own edits every time the board
    // list refetches (e.g. after this component creates a new one).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialBoardId]);

  useImperativeHandle(ref, () => ({
    async resolvePath() {
      const meaningful = chain.filter((e) => e.mode === 'existing' || e.title.trim());
      if (meaningful.length === 0) return { error: 'Choose or create a top-level board.' };

      setResolving(true);
      try {
        let parentId: string | null = null;
        let createdAny = false;
        for (const entry of meaningful) {
          if (entry.mode === 'existing') {
            parentId = entry.boardId;
            continue;
          }
          const res = await fetch('/api/admin/boards', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              parent_id: parentId,
              title: entry.title.trim(),
              thumbnail_url: entry.thumbnailUrl || null,
              description: entry.description || null,
            }),
          });
          const data = await res.json();
          if (!res.ok) return { error: data.error ?? `Could not create board "${entry.title.trim()}".` };
          parentId = data.board.id as string;
          createdAny = true;
        }
        if (createdAny) onBoardsCreated?.();
        return parentId ? { boardId: parentId } : { error: 'Choose or create a top-level board.' };
      } finally {
        setResolving(false);
      }
    },
  }));

  function setLevel(i: number, entry: ChainEntry) {
    setChain((prev) => [...prev.slice(0, i), entry]);
  }

  function updateNewLevel(i: number, patch: Partial<Extract<ChainEntry, { mode: 'new' }>>) {
    setChain((prev) =>
      prev.map((e, idx) => (idx === i && e.mode === 'new' ? { ...e, ...patch } : e))
    );
  }

  function clearFrom(i: number) {
    setChain((prev) => prev.slice(0, i));
  }

  function addNestedNewLevel() {
    setChain((prev) => [...prev, { mode: 'new', title: '', thumbnailUrl: '', description: '', showAdvanced: false }]);
  }

  // Renders one row per chain entry, PLUS (only while every entry so
  // far is 'existing') one extra pending <select> for the next level —
  // that's what makes drilling into existing sub-boards feel automatic,
  // the same way CascadingBoardSelect's own recursive selects do,
  // without a manual "add level" click for the existing-boards case.
  const rows: React.ReactNode[] = [];
  let parentId: string | null = null;
  let stoppedAtNew = false;

  chain.forEach((entry, i) => {
    if (entry.mode === 'existing') {
      const siblings = byParent.get(parentId) ?? [];
      rows.push(
        <SelectRow
          key={i}
          depth={i}
          siblings={siblings}
          value={entry.boardId}
          onSelect={(val) => {
            if (val === NEW_BOARD_VALUE) setLevel(i, { mode: 'new', title: '', thumbnailUrl: '', description: '', showAdvanced: false });
            else if (val === '') clearFrom(i);
            else setLevel(i, { mode: 'existing', boardId: val });
          }}
        />
      );
      parentId = entry.boardId;
    } else {
      rows.push(
        <NewRow
          key={i}
          depth={i}
          entry={entry}
          removable={i > 0}
          onChange={(patch) => updateNewLevel(i, patch)}
          onRemove={() => clearFrom(i)}
        />
      );
      stoppedAtNew = true;
    }
  });

  if (!stoppedAtNew) {
    const siblings = byParent.get(parentId) ?? [];
    rows.push(
      <SelectRow
        key="pending"
        depth={chain.length}
        siblings={siblings}
        value=""
        onSelect={(val) => {
          if (val === NEW_BOARD_VALUE) setChain((prev) => [...prev, { mode: 'new', title: '', thumbnailUrl: '', description: '', showAdvanced: false }]);
          else if (val) setChain((prev) => [...prev, { mode: 'existing', boardId: val }]);
        }}
      />
    );
  }

  const lastIsUnfilledNew = chain.length > 0 && chain[chain.length - 1].mode === 'new' && !(chain[chain.length - 1] as Extract<ChainEntry, { mode: 'new' }>).title.trim();

  return (
    <div className="space-y-2">
      {rows}
      {stoppedAtNew && (
        <button
          type="button"
          onClick={addNestedNewLevel}
          disabled={lastIsUnfilledNew || resolving}
          className="text-xs text-ink-faint underline underline-offset-2 hover:text-ink-dim disabled:cursor-not-allowed disabled:opacity-40"
        >
          + Add nested board level
        </button>
      )}
    </div>
  );
});

function SelectRow({
  depth,
  siblings,
  value,
  onSelect,
}: {
  depth: number;
  siblings: TreeBoard[];
  value: string;
  onSelect: (value: string) => void;
}) {
  return (
    <select value={value} onChange={(e) => onSelect(e.target.value)} className="input" required={depth === 0}>
      <option value="">{depth === 0 ? '— Select a top-level board —' : '— Select a sub-board —'}</option>
      {siblings.map((b) => (
        <option key={b.id} value={b.id}>
          {b.title}
        </option>
      ))}
      <option value={NEW_BOARD_VALUE}>+ Create new board here</option>
    </select>
  );
}

function NewRow({
  depth,
  entry,
  removable,
  onChange,
  onRemove,
}: {
  depth: number;
  entry: Extract<ChainEntry, { mode: 'new' }>;
  removable: boolean;
  onChange: (patch: Partial<Extract<ChainEntry, { mode: 'new' }>>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="space-y-1.5 rounded-lg border border-signal/20 bg-signal/5 p-2.5">
      <div className="flex items-center gap-2">
        <input
          autoFocus
          value={entry.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder={depth === 0 ? 'New top-level board name' : 'New sub-board name'}
          className="input min-w-0 flex-1"
          required={depth === 0}
        />
        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 rounded-md border border-vault-border px-2 py-1.5 text-xs text-ink-faint transition hover:border-danger hover:text-danger"
          aria-label={removable ? 'Remove this level' : 'Cancel new board and go back to selecting an existing one'}
        >
          {removable ? '✕' : 'Back'}
        </button>
      </div>
      <p className="font-mono text-[10px] uppercase tracking-widest text-signal-glow">New board — will be created</p>
      <button
        type="button"
        onClick={() => onChange({ showAdvanced: !entry.showAdvanced })}
        className="text-[11px] text-ink-faint underline underline-offset-2 hover:text-ink-dim"
      >
        {entry.showAdvanced ? 'Hide thumbnail/description' : '+ Add thumbnail/description (optional)'}
      </button>
      {entry.showAdvanced && (
        <div className="space-y-2 rounded-lg border border-vault-border bg-vault-900/60 p-3">
          <ThumbnailUpload value={entry.thumbnailUrl} onChange={(url) => onChange({ thumbnailUrl: url })} />
          <textarea
            value={entry.description}
            onChange={(e) => onChange({ description: e.target.value })}
            placeholder="Description (optional)"
            rows={2}
            className="input"
          />
        </div>
      )}
    </div>
  );
}
