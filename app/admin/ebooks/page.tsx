'use client';

import { useEffect, useMemo, useState } from 'react';
import { ThumbnailUpload } from '@/components/ThumbnailUpload';
import { SearchInput } from '@/components/SearchInput';
import { orderBoardsHierarchically } from '@/lib/boardTree';

type Board = { id: string; title: string; parent_id: string | null; sort_order: number };

type EBook = {
  id: string;
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  download_url: string | null;
  format: string;
  price: number;
  board_id: string;
  sort_order: number;
  board: { id: string; title: string } | null;
};

const FORMATS = ['PDF', 'EPUB', 'DOCX', 'Other'];

export default function AdminEBooksPage() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [ebooks, setEbooks] = useState<EBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [boardId, setBoardId] = useState('');
  const [title, setTitle] = useState('');
  const [thumbnailUrl, setThumbnailUrl] = useState('');
  const [downloadUrl, setDownloadUrl] = useState('');
  const [format, setFormat] = useState('PDF');
  const [price, setPrice] = useState('0');
  const [description, setDescription] = useState('');
  const [search, setSearch] = useState('');

  const orderedBoards = useMemo(() => orderBoardsHierarchically(boards), [boards]);

  const filteredEbooks = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return ebooks;
    return ebooks.filter(
      (eb) => eb.title.toLowerCase().includes(needle) || (eb.board?.title ?? '').toLowerCase().includes(needle)
    );
  }, [ebooks, search]);

  async function load() {
    setLoading(true);
    const [boardsRes, ebooksRes] = await Promise.all([
      fetch('/api/admin/boards'),
      fetch('/api/admin/ebooks'),
    ]);
    const boardsData = await boardsRes.json();
    const ebooksData = await ebooksRes.json();
    if (boardsRes.ok) setBoards(boardsData.boards);
    if (ebooksRes.ok) setEbooks(ebooksData.e_books);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function createEBook(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch('/api/admin/ebooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        board_id: boardId,
        title,
        description: description || null,
        thumbnail_url: thumbnailUrl || null,
        download_url: downloadUrl || null,
        format,
        price: Number(price) || 0,
        sort_order: 0,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'Could not create e-book.');
      return;
    }
    setTitle('');
    setThumbnailUrl('');
    setDownloadUrl('');
    setFormat('PDF');
    setPrice('0');
    setDescription('');
    load();
  }

  async function removeEBook(id: string) {
    if (!confirm('Delete this e-book?')) return;
    setBusyId(id);
    const res = await fetch(`/api/admin/ebooks/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) setError(data.error ?? 'Could not delete e-book.');
    setBusyId(null);
    load();
  }

  return (
    <div>
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-signal-glow">Admin</p>
      <h1 className="mt-2 font-display text-2xl font-semibold text-ink">E-Books</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-dim">
        Attach a downloadable e-book to a board. Thumbnail should be a portrait book-cover image
        (3:4). Leave price at 0 for a free e-book.
      </p>

      <form
        onSubmit={createEBook}
        className="mt-6 grid grid-cols-1 gap-3 rounded-xl border border-vault-border bg-vault-900 p-5 sm:grid-cols-2 backdrop-blur-xl shadow-glass"
      >
        <Field label="Board">
          <select required value={boardId} onChange={(e) => setBoardId(e.target.value)} className="input">
            <option value="">— Select a board —</option>
            {orderedBoards.map((b) => (
              <option key={b.id} value={b.id}>
                {'—'.repeat(b.depth)}
                {b.depth > 0 ? ' ' : ''}
                {b.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Title">
          <input required value={title} onChange={(e) => setTitle(e.target.value)} className="input" />
        </Field>

        <div className="sm:col-span-2">
          <Field label="Thumbnail (portrait, 3:4)">
            <ThumbnailUpload value={thumbnailUrl} onChange={setThumbnailUrl} />
          </Field>
        </div>

        <Field label="Download link (optional, https)">
          <input
            value={downloadUrl}
            onChange={(e) => setDownloadUrl(e.target.value)}
            placeholder="https://..."
            className="input"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Format">
            <select value={format} onChange={(e) => setFormat(e.target.value)} className="input">
              {FORMATS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Price (0 = Free)">
            <input
              type="number"
              min="0"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="input"
            />
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

        <div className="sm:col-span-2">
          <button
            type="submit"
            className="rounded-md bg-signal px-4 py-2 text-sm font-medium text-white transition hover:bg-signal-glow"
          >
            Add e-book
          </button>
        </div>
      </form>

      {error && <p className="mt-3 text-xs text-danger">{error}</p>}

      {ebooks.length > 5 && (
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search e-books or boards…"
          className="mt-4 max-w-sm"
        />
      )}

      <div className="mt-6 space-y-3">
        {loading ? (
          <p className="text-center text-sm text-ink-faint">Loading…</p>
        ) : ebooks.length === 0 ? (
          <p className="rounded-xl border border-dashed border-vault-border p-6 text-center text-sm text-ink-faint">
            No e-books yet.
          </p>
        ) : filteredEbooks.length === 0 ? (
          <p className="rounded-xl border border-dashed border-vault-border p-6 text-center text-sm text-ink-faint">
            No e-books match &ldquo;{search}&rdquo;.
          </p>
        ) : (
          filteredEbooks.map((eb) => (
            <div
              key={eb.id}
              className="flex items-center justify-between rounded-xl border border-vault-border bg-vault-900 px-4 py-3 backdrop-blur-xl shadow-glass"
            >
              <div className="flex items-center gap-3">
                {eb.thumbnail_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={eb.thumbnail_url}
                    alt=""
                    className="h-14 w-11 rounded-md border border-vault-border object-cover"
                  />
                ) : (
                  <div className="flex h-14 w-11 items-center justify-center rounded-md border border-dashed border-vault-border text-[9px] text-ink-faint">
                    No image
                  </div>
                )}
                <div>
                  <p className="text-sm text-ink">{eb.title}</p>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">
                    {eb.board?.title ?? 'Unknown board'} · {eb.format} ·{' '}
                    {eb.price > 0 ? `৳${eb.price}` : 'Free'}
                  </p>
                </div>
              </div>
              <button
                disabled={busyId === eb.id}
                onClick={() => removeEBook(eb.id)}
                className="rounded-md border border-danger/30 px-2.5 py-1 text-xs text-danger transition hover:bg-danger/10 disabled:opacity-50"
              >
                Delete
              </button>
            </div>
          ))
        )}
      </div>
    </div>
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
