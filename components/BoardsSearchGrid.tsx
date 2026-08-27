'use client';

import { useMemo, useState } from 'react';
import { SearchInput } from '@/components/SearchInput';
import { BoardCard } from '@/components/BoardCard';

type Board = {
  id: string;
  title: string;
  description?: string | null;
  thumbnail_url?: string | null;
};

export function BoardsSearchGrid({
  boards,
  placeholder = 'Search…',
  emptyMessage,
}: {
  boards: Board[];
  placeholder?: string;
  emptyMessage: string;
}) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return boards;
    return boards.filter((b) => `${b.title} ${b.description ?? ''}`.toLowerCase().includes(needle));
  }, [boards, query]);

  if (boards.length === 0) {
    return (
      <div className="mt-10 rounded-xl border border-dashed border-vault-border p-10 text-center">
        <p className="text-sm text-ink-dim">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div>
      {boards.length > 5 && <SearchInput value={query} onChange={setQuery} placeholder={placeholder} className="mt-6 max-w-sm" />}
      {filtered.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-vault-border p-6 text-center text-sm text-ink-faint">
          Nothing matches your search.
        </p>
      ) : (
        <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((b) => (
            <BoardCard
              key={b.id}
              href={`/learn/board/${b.id}`}
              title={b.title}
              description={b.description}
              thumbnailUrl={b.thumbnail_url}
            />
          ))}
        </div>
      )}
    </div>
  );
}
