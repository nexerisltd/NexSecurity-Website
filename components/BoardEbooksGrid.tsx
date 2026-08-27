'use client';

import { useMemo, useState } from 'react';
import { SearchInput } from '@/components/SearchInput';
import { EBookCard } from '@/components/EBookCard';

type EbookRow = {
  id: string;
  title: string;
  thumbnail_url: string | null;
  download_url: string | null;
  format: string;
  price: number;
};

export function BoardEbooksGrid({ ebooks }: { ebooks: EbookRow[] }) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return ebooks;
    return ebooks.filter((eb) => eb.title.toLowerCase().includes(needle));
  }, [ebooks, query]);

  return (
    <div>
      {ebooks.length > 5 && (
        <SearchInput value={query} onChange={setQuery} placeholder="Search e-books…" className="mt-4 max-w-sm" />
      )}
      {filtered.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-vault-border p-6 text-center text-sm text-ink-faint">
          {ebooks.length === 0 ? 'No e-books yet.' : 'No e-books match your search.'}
        </p>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
          {filtered.map((eb) => (
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
      )}
    </div>
  );
}
