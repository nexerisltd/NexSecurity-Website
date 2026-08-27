'use client';

import { useMemo, useState } from 'react';
import { SearchInput } from '@/components/SearchInput';

export function SearchableGrid<T>({
  items,
  getSearchText,
  getKey,
  placeholder = 'Search…',
  emptyMessage,
  noMatchMessage = 'Nothing matches your search.',
  gridClassName,
  renderItem,
}: {
  items: T[];
  getSearchText: (item: T) => string;
  getKey: (item: T) => string;
  placeholder?: string;
  emptyMessage: string;
  noMatchMessage?: string;
  gridClassName: string;
  renderItem: (item: T) => React.ReactNode;
}) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) => getSearchText(item).toLowerCase().includes(needle));
  }, [items, query, getSearchText]);

  if (items.length === 0) {
    return (
      <div className="mt-10 rounded-xl border border-dashed border-vault-border p-10 text-center">
        <p className="text-sm text-ink-dim">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div>
      {items.length > 5 && <SearchInput value={query} onChange={setQuery} placeholder={placeholder} className="mt-6 max-w-sm" />}
      {filtered.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-vault-border p-6 text-center text-sm text-ink-faint">
          {noMatchMessage}
        </p>
      ) : (
        <div className={gridClassName}>
          {filtered.map((item) => (
            <div key={getKey(item)}>{renderItem(item)}</div>
          ))}
        </div>
      )}
    </div>
  );
}
