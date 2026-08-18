'use client';

import { useEffect, useState } from 'react';

type AuthorizedUser = {
  id: string;
  email: string;
  role: 'USER' | 'ADMIN';
  status: 'ACTIVE' | 'DISABLED';
  created_at: string;
};

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AuthorizedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<'USER' | 'ADMIN'>('USER');
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const res = await fetch('/api/admin/users');
    const data = await res.json();
    if (res.ok) setUsers(data.users);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function addUser(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: newEmail, role: newRole }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'Could not add user.');
      return;
    }
    setNewEmail('');
    setNewRole('USER');
    load();
  }

  async function updateUser(id: string, patch: Partial<Pick<AuthorizedUser, 'role' | 'status'>>) {
    setBusyId(id);
    setError(null);
    const res = await fetch(`/api/admin/users/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (!res.ok) setError(data.error ?? 'Could not update user.');
    setBusyId(null);
    load();
  }

  async function removeUser(id: string) {
    if (!confirm('Remove this user\'s access? This cannot be undone.')) return;
    setBusyId(id);
    const res = await fetch(`/api/admin/users/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) setError(data.error ?? 'Could not remove user.');
    setBusyId(null);
    load();
  }

  return (
    <div>
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-signal-glow">Admin</p>
      <h1 className="mt-2 font-display text-2xl font-semibold text-ink">Authorized users</h1>

      <form
        onSubmit={addUser}
        className="mt-6 flex flex-wrap items-end gap-3 rounded-xl border border-vault-border bg-vault-900 p-5"
      >
        <div className="min-w-[220px] flex-1">
          <label className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">
            Email
          </label>
          <input
            type="email"
            required
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="person@company.com"
            className="mt-1 w-full rounded-md border border-vault-border bg-vault-800 px-3 py-2 text-sm text-ink outline-none focus:border-signal"
          />
        </div>
        <div>
          <label className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">
            Role
          </label>
          <select
            value={newRole}
            onChange={(e) => setNewRole(e.target.value as 'USER' | 'ADMIN')}
            className="mt-1 rounded-md border border-vault-border bg-vault-800 px-3 py-2 text-sm text-ink outline-none focus:border-signal"
          >
            <option value="USER">USER</option>
            <option value="ADMIN">ADMIN</option>
          </select>
        </div>
        <button
          type="submit"
          className="rounded-md bg-signal px-4 py-2 text-sm font-medium text-white transition hover:bg-signal-glow"
        >
          Add user
        </button>
      </form>

      {error && <p className="mt-3 text-xs text-danger">{error}</p>}

      <div className="mt-6 overflow-hidden rounded-xl border border-vault-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-vault-900 font-mono text-[10px] uppercase tracking-widest text-ink-faint">
            <tr>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-ink-faint">
                  Loading…
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-ink-faint">
                  No authorized users yet.
                </td>
              </tr>
            ) : (
              users.map((u) => (
                <tr key={u.id} className="border-t border-vault-border bg-vault-900/50">
                  <td className="px-4 py-3 text-ink">{u.email}</td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-[10px] uppercase tracking-widest text-ink-dim">
                      {u.role}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`font-mono text-[10px] uppercase tracking-widest ${
                        u.status === 'ACTIVE' ? 'text-ok' : 'text-danger'
                      }`}
                    >
                      {u.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button
                        disabled={busyId === u.id}
                        onClick={() =>
                          updateUser(u.id, { role: u.role === 'ADMIN' ? 'USER' : 'ADMIN' })
                        }
                        className="rounded-md border border-vault-border px-2.5 py-1 text-xs text-ink-dim transition hover:border-signal hover:text-ink disabled:opacity-50"
                      >
                        {u.role === 'ADMIN' ? 'Make USER' : 'Make ADMIN'}
                      </button>
                      <button
                        disabled={busyId === u.id}
                        onClick={() =>
                          updateUser(u.id, {
                            status: u.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE',
                          })
                        }
                        className="rounded-md border border-vault-border px-2.5 py-1 text-xs text-ink-dim transition hover:border-signal hover:text-ink disabled:opacity-50"
                      >
                        {u.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        disabled={busyId === u.id}
                        onClick={() => removeUser(u.id)}
                        className="rounded-md border border-danger/30 px-2.5 py-1 text-xs text-danger transition hover:bg-danger/10 disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
