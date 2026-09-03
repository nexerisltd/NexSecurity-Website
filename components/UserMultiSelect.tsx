'use client';

import { useMemo, useState } from 'react';
import { SearchInput } from '@/components/SearchInput';

export type SelectableUser = { email: string };

/**
 * Searchable checklist of user emails with select-all/clear-shown, used
 * anywhere an admin needs to pick "which people" — a board's access
 * list, or the access list being set up while creating a brand-new
 * board. Deliberately dumb (controlled `selected` Set in, `onChange`
 * out) so both call sites can decide what "save" means for themselves.
 */
export function UserMultiSelect({
  users,
  selected,
  onChange,
  emptyLabel = 'No users to choose from yet.',
}: {
  users: SelectableUser[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  emptyLabel?: string;
}) {
  const [search, setSearch] = useState('');

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return users;
    return users.filter((u) => u.email.toLowerCase().includes(needle));
  }, [users, search]);

  function toggle(email: string) {
    const next = new Set(selected);
    if (next.has(email)) next.delete(email);
    else next.add(email);
    onChange(next);
  }

  function selectAllVisible() {
    const next = new Set(selected);
    for (const u of visible) next.add(u.email);
    onChange(next);
  }

  function clearVisible() {
    const next = new Set(selected);
    for (const u of visible) next.delete(u.email);
    onChange(next);
  }

  if (users.length === 0) return <p className="text-xs text-ink-faint">{emptyLabel}</p>;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {users.length > 5 && (
          <SearchInput value={search} onChange={setSearch} placeholder="Search users…" className="w-full sm:w-56" />
        )}
        <button
          type="button"
          onClick={selectAllVisible}
          className="rounded-md border border-vault-border px-2 py-1 text-[11px] text-ink-dim transition hover:border-signal hover:text-ink"
        >
          Select all{search ? ' shown' : ''}
        </button>
        <button
          type="button"
          onClick={clearVisible}
          className="rounded-md border border-vault-border px-2 py-1 text-[11px] text-ink-dim transition hover:border-signal hover:text-ink"
        >
          Clear{search ? ' shown' : ' all'}
        </button>
      </div>
      <div className="max-h-48 overflow-y-auto rounded-md border border-vault-border bg-vault-900 p-2">
        {visible.length === 0 ? (
          <p className="px-1.5 py-1 text-xs text-ink-faint">No users match.</p>
        ) : (
          visible.map((u) => (
            <label
              key={u.email}
              className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm text-ink hover:bg-vault-800/60"
            >
              <input type="checkbox" checked={selected.has(u.email)} onChange={() => toggle(u.email)} className="accent-signal" />
              <span className="truncate">{u.email}</span>
            </label>
          ))
        )}
      </div>
      <p className="mt-1.5 font-mono text-[10px] uppercase tracking-widest text-ink-faint">
        {selected.size} of {users.length} selected
      </p>
    </div>
  );
}
