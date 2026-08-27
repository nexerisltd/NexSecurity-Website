'use client';

import { useMemo, useState } from 'react';
import { SearchInput } from '@/components/SearchInput';
import { EBookCard } from '@/components/EBookCard';

type Row = {
  id: string;
  title: string;
  thumbnail_url: string | null;
  download_url: string | null;
  format: string;
  price: number;
};

export function EbooksSearch({ groups }: { groups: { boardTitle: string; items: Row[] }[] }) {
  const [query, setQuery] = useState('');

  const filteredGroups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return groups;
    return groups
      .map((g) => ({
        boardTitle: g.boardTitle,
        items: g.items.filter(
          (eb) => eb.title.toLowerCase().includes(needle) || g.boardTitle.toLowerCase().includes(needle)
        ),
      }))
      .filter((g) => g.items.length > 0);
  }, [groups, query]);

  const totalCount = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div>
      {totalCount > 5 && (
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search e-books or boards…"
          className="mt-6 max-w-sm"
        />
      )}

      {filteredGroups.length === 0 ? (
        <p className="mt-10 rounded-xl border border-dashed border-vault-border p-10 text-center text-sm text-ink-faint">
          Nothing matches your search.
        </p>
      ) : (
        filteredGroups.map((group) => (
          <section key={group.boardTitle} className="mt-10">
            <p className="font-mono text-[11px] uppercase tracking-widest text-ink-faint">
              {group.boardTitle}
            </p>
            <div className="mt-4 grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
              {group.items.map((eb) => (
                <EBookCard
                  key={eb.id}
                  title={eb.title}
                  thumbnailUrl={eb.thumbnail_url}
                  downloadUrl={eb.download_url}
                  format={eb.format}
                  price={Number(eb.price)}
                />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
