'use client';

import { useMemo, useState } from 'react';
import { SearchInput } from '@/components/SearchInput';
import { ancestorTitles, type BoardNode, type TreeBoard } from '@/lib/boardTree';

/**
 * Searchable checklist of restricted boards (breadcrumb + title), used
 * anywhere an admin needs to pick "which boards" a person should see —
 * a user's access edit, or the access section on the add-user form. The
 * counterpart to UserMultiSelect, same controlled-Set pattern.
 */
export function BoardMultiSelect<T extends TreeBoard>({
  boards,
  restrictedOrdered,
  selected,
  onChange,
}: {
  /** Full flat board list — needed to resolve breadcrumb ancestry. */
  boards: T[];
  /** Restricted boards only, already depth-first ordered. */
  restrictedOrdered: BoardNode<T>[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [search, setSearch] = useState('');

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return restrictedOrdered;
    return restrictedOrdered.filter(
      (b) => b.title.toLowerCase().includes(needle) || ancestorTitles(boards, b.id).some((t) => t.toLowerCase().includes(needle))
    );
  }, [restrictedOrdered, search, boards]);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  }

  if (restrictedOrdered.length === 0) {
    return <p className="text-xs text-ink-faint">No restricted boards exist yet — everything is universal.</p>;
  }

  return (
    <div>
      {restrictedOrdered.length > 5 && (
        <SearchInput value={search} onChange={setSearch} placeholder="Filter boards…" className="mb-2" />
      )}
      <div className="max-h-48 overflow-y-auto rounded-md border border-vault-border bg-vault-900 p-2">
        {visible.length === 0 ? (
          <p className="px-1.5 py-1 text-xs text-ink-faint">No boards match.</p>
        ) : (
          visible.map((b) => {
            const breadcrumb = ancestorTitles(boards, b.id).join(' › ');
            return (
              <label
                key={b.id}
                className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm text-ink hover:bg-vault-800/60"
              >
                <input type="checkbox" checked={selected.has(b.id)} onChange={() => toggle(b.id)} className="accent-signal" />
                <span className="min-w-0">
                  {breadcrumb && (
                    <span className="block truncate font-mono text-[10px] uppercase tracking-widest text-ink-faint/70">
                      {breadcrumb}
                    </span>
                  )}
                  <span className="block truncate">{b.title}</span>
                </span>
              </label>
            );
          })
        )}
      </div>
      <p className="mt-1.5 font-mono text-[10px] uppercase tracking-widest text-ink-faint">
        {selected.size} of {restrictedOrdered.length} selected
      </p>
    </div>
  );
}
