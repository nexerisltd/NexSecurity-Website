'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { SearchInput } from '@/components/SearchInput';
import { ancestorTitles, orderBoardsHierarchically, type BoardNode } from '@/lib/boardTree';

type Board = {
  id: string;
  title: string;
  parent_id: string | null;
  visibility: 'universal' | 'restricted';
};

type AdminUser = { id: string; email: string; role: 'USER' | 'ADMIN' };

/**
 * The one screen for "who can see what". Everywhere else in the admin
 * panel, access is set per-board (open a board, pick the people). Here
 * it's per-PERSON: pick someone, see every restricted board as one
 * checklist, flip whichever ones should change, save once. This is what
 * replaces clicking into 6 different boards to give one teacher access
 * to their whole section.
 */
export default function AdminAccessPage() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedEmail, setSelectedEmail] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [boardSearch, setBoardSearch] = useState('');
  const [initialGranted, setInitialGranted] = useState<Set<string>>(new Set());
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [loadingGrants, setLoadingGrants] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [boardsRes, usersRes, summaryRes] = await Promise.all([
        fetch('/api/admin/boards'),
        fetch('/api/admin/users'),
        fetch('/api/admin/access-summary'),
      ]);
      const boardsData = await boardsRes.json();
      const usersData = await usersRes.json();
      const summaryData = await summaryRes.json();
      if (boardsRes.ok) setBoards(boardsData.boards);
      if (usersRes.ok) setUsers((usersData.users ?? []).filter((u: AdminUser) => u.role !== 'ADMIN'));
      if (summaryRes.ok) setCounts(summaryData.counts ?? {});
      setLoading(false);
    })();
  }, []);

  const ordered = useMemo(() => orderBoardsHierarchically(boards), [boards]);
  const restrictedOrdered = useMemo(
    () => ordered.filter((b) => b.visibility === 'restricted'),
    [ordered]
  );

  const filteredUsers = useMemo(() => {
    const needle = userSearch.trim().toLowerCase();
    if (!needle) return users;
    return users.filter((u) => u.email.toLowerCase().includes(needle));
  }, [users, userSearch]);

  const filteredRestrictedBoards = useMemo(() => {
    const needle = boardSearch.trim().toLowerCase();
    if (!needle) return restrictedOrdered;
    return restrictedOrdered.filter(
      (b) =>
        b.title.toLowerCase().includes(needle) ||
        ancestorTitles(boards, b.id).some((t) => t.toLowerCase().includes(needle))
    );
  }, [restrictedOrdered, boardSearch, boards]);

  async function selectUser(email: string) {
    setSelectedEmail(email);
    setSaveResult(null);
    setLoadingGrants(true);
    const res = await fetch(`/api/admin/access-summary?email=${encodeURIComponent(email)}`);
    const data = await res.json();
    if (res.ok) {
      const ids = new Set((data.grantedBoardIds ?? []) as string[]);
      setInitialGranted(ids);
      setChecked(new Set(ids));
    } else {
      setError(data.error ?? 'Could not load this user\u2019s access.');
    }
    setLoadingGrants(false);
  }

  function toggle(boardId: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(boardId)) next.delete(boardId);
      else next.add(boardId);
      return next;
    });
    setSaveResult(null);
  }

  const changedIds = useMemo(() => {
    const changed: string[] = [];
    for (const b of restrictedOrdered) {
      if (checked.has(b.id) !== initialGranted.has(b.id)) changed.push(b.id);
    }
    return changed;
  }, [checked, initialGranted, restrictedOrdered]);

  async function saveChanges() {
    if (!selectedEmail || changedIds.length === 0) return;
    setSaving(true);
    setError(null);
    let done = 0;
    try {
      for (const boardId of changedIds) {
        // The access endpoint replaces a board's FULL grant list, so we
        // have to fetch its current list, add/remove just this one
        // person, and PUT the whole thing back — never touching anyone
        // else already granted on that board.
        const existingRes = await fetch(`/api/admin/boards/${boardId}/access`);
        const existingData = await existingRes.json();
        const existingEmails: string[] = existingRes.ok ? existingData.emails ?? [] : [];
        const willGrant = checked.has(boardId);
        const nextEmails = willGrant
          ? Array.from(new Set([...existingEmails, selectedEmail]))
          : existingEmails.filter((e) => e.toLowerCase() !== selectedEmail.toLowerCase());
        await fetch(`/api/admin/boards/${boardId}/access`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ emails: nextEmails }),
        });
        done += 1;
      }
      setInitialGranted(new Set(checked));
      setSaveResult(`Updated ${done} board${done === 1 ? '' : 's'} for ${selectedEmail}.`);
      const summaryRes = await fetch('/api/admin/access-summary');
      const summaryData = await summaryRes.json();
      if (summaryRes.ok) setCounts(summaryData.counts ?? {});
    } catch {
      setError('Something went wrong partway through saving — please check the list and try again.');
    }
    setSaving(false);
  }

  return (
    <div>
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-signal-glow">Admin</p>
      <h1 className="mt-2 font-display text-2xl font-semibold text-ink">Access</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-dim">
        Manage what one person can see across every restricted board at once — instead of opening
        each board separately. Pick a user, tick the boards they should have, save.
      </p>
      <p className="mt-1 max-w-2xl text-xs text-ink-faint">
        Admins always see every board and never appear here. If a restricted board sits inside
        another restricted board, both need their own tick — restriction doesn&rsquo;t cascade
        automatically.
      </p>

      {error && <p className="mt-3 text-xs text-danger">{error}</p>}

      {loading ? (
        <p className="mt-8 text-center text-sm text-ink-faint">Loading…</p>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]">
          <div className="rounded-xl border border-vault-border bg-vault-900 p-4 backdrop-blur-xl shadow-glass lg:max-h-[32rem] lg:overflow-y-auto">
            <p className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">User</p>
            {users.length > 5 && (
              <SearchInput
                value={userSearch}
                onChange={setUserSearch}
                placeholder="Search users…"
                className="mt-2"
              />
            )}
            {users.length === 0 ? (
              <p className="mt-3 text-xs text-ink-faint">No non-admin users yet.</p>
            ) : (
              <ul className="mt-2 space-y-0.5">
                {filteredUsers.map((u) => (
                  <li key={u.id}>
                    <button
                      onClick={() => selectUser(u.email)}
                      className={`w-full truncate rounded-md px-2.5 py-1.5 text-left text-sm transition ${
                        selectedEmail === u.email
                          ? 'bg-signal/10 text-signal'
                          : 'text-ink-dim hover:bg-vault-800 hover:text-ink'
                      }`}
                    >
                      {u.email}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-xl border border-vault-border bg-vault-900 p-4 backdrop-blur-xl shadow-glass">
            {!selectedEmail ? (
              <p className="text-sm text-ink-faint">Pick a user on the left to see and edit their board access.</p>
            ) : restrictedOrdered.length === 0 ? (
              <p className="text-sm text-ink-faint">No restricted boards exist yet — everything is universal.</p>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-ink">
                    Editing access for <span className="font-medium text-ink">{selectedEmail}</span>
                  </p>
                  {restrictedOrdered.length > 5 && (
                    <SearchInput
                      value={boardSearch}
                      onChange={setBoardSearch}
                      placeholder="Filter boards…"
                      className="w-full sm:w-56"
                    />
                  )}
                </div>

                {loadingGrants ? (
                  <p className="mt-4 text-sm text-ink-faint">Loading current access…</p>
                ) : (
                  <div className="mt-3 max-h-96 overflow-y-auto rounded-md border border-vault-border">
                    {filteredRestrictedBoards.length === 0 ? (
                      <p className="p-3 text-xs text-ink-faint">No restricted boards match.</p>
                    ) : (
                      filteredRestrictedBoards.map((b: BoardNode<Board>) => {
                        const breadcrumb = ancestorTitles(boards, b.id).join(' › ');
                        return (
                          <label
                            key={b.id}
                            className="flex cursor-pointer items-center justify-between gap-3 border-b border-vault-border/60 px-3 py-2 last:border-b-0 hover:bg-vault-800/60"
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <input
                                type="checkbox"
                                checked={checked.has(b.id)}
                                onChange={() => toggle(b.id)}
                                className="accent-signal"
                              />
                              <span className="min-w-0">
                                {breadcrumb && (
                                  <span className="block truncate font-mono text-[10px] uppercase tracking-widest text-ink-faint/70">
                                    {breadcrumb}
                                  </span>
                                )}
                                <span className="block truncate text-sm text-ink">{b.title}</span>
                              </span>
                            </span>
                            <span className="flex shrink-0 items-center gap-2">
                              <span className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">
                                {counts[b.id] ?? 0} total
                              </span>
                              <Link
                                href={`/admin/boards?edit=${b.id}`}
                                className="text-[10px] text-ink-faint underline decoration-dotted hover:text-signal"
                              >
                                manage board
                              </Link>
                            </span>
                          </label>
                        );
                      })
                    )}
                  </div>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button
                    onClick={saveChanges}
                    disabled={saving || changedIds.length === 0}
                    className="rounded-md bg-signal px-4 py-2 text-sm font-medium text-white transition hover:bg-signal-glow disabled:opacity-50"
                  >
                    {saving
                      ? 'Saving…'
                      : changedIds.length === 0
                        ? 'No changes'
                        : `Save ${changedIds.length} change${changedIds.length === 1 ? '' : 's'}`}
                  </button>
                  {saveResult && <span className="text-xs text-ok">{saveResult}</span>}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
