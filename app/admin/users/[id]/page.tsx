'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

type ApprovedDevice = {
  id: string;
  ip_address: string;
  device_label: string;
  note: string | null;
  created_at: string;
};

type Sighting = {
  id: string;
  ip_address: string;
  device_label: string;
  first_seen: string;
  last_seen: string;
  sighting_count: number;
};

type UserRow = {
  id: string;
  email: string;
  role: 'USER' | 'ADMIN';
  status: 'ACTIVE' | 'DISABLED';
  restrict_devices: boolean;
};

export default function UserDevicesPage() {
  const params = useParams<{ id: string }>();
  const userId = params.id;

  const [user, setUser] = useState<UserRow | null>(null);
  const [approved, setApproved] = useState<ApprovedDevice[]>([]);
  const [sightings, setSightings] = useState<Sighting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [savingRestrict, setSavingRestrict] = useState(false);

  async function load() {
    setLoading(true);
    const [usersRes, devicesRes] = await Promise.all([
      fetch('/api/admin/users'),
      fetch(`/api/admin/users/${userId}/devices`),
    ]);
    const usersData = await usersRes.json();
    const devicesData = await devicesRes.json();
    if (usersRes.ok) {
      const found = (usersData.users as UserRow[]).find((u) => u.id === userId);
      setUser(found ?? null);
    }
    if (devicesRes.ok) {
      setApproved(devicesData.approved);
      setSightings(devicesData.sightings);
    }
    setLoading(false);
  }

  useEffect(() => {
    if (userId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  async function toggleRestrict() {
    if (!user) return;
    setSavingRestrict(true);
    setError(null);
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ restrict_devices: !user.restrict_devices }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'Could not update.');
    } else {
      setUser({ ...user, restrict_devices: !user.restrict_devices });
    }
    setSavingRestrict(false);
  }

  async function approve(ip: string, label: string) {
    setBusy(`${ip}|${label}`);
    setError(null);
    const res = await fetch(`/api/admin/users/${userId}/devices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip_address: ip, device_label: label }),
    });
    const data = await res.json();
    if (!res.ok) setError(data.error ?? 'Could not approve device.');
    setBusy(null);
    load();
  }

  async function revoke(deviceId: string) {
    setBusy(deviceId);
    setError(null);
    const res = await fetch(`/api/admin/users/${userId}/devices/${deviceId}`, {
      method: 'DELETE',
    });
    const data = await res.json();
    if (!res.ok) setError(data.error ?? 'Could not revoke device.');
    setBusy(null);
    load();
  }

  const isApproved = (ip: string, label: string) =>
    approved.some((a) => a.ip_address === ip && a.device_label === label);

  return (
    <div>
      <Link href="/admin/users" className="font-mono text-[11px] uppercase tracking-widest text-ink-dim transition hover:text-ink">
        ← Users
      </Link>
      <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.2em] text-signal-glow">Admin</p>
      <h1 className="mt-2 font-display text-2xl font-semibold text-ink">
        {loading ? 'Loading…' : user?.email ?? 'User'}
      </h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-dim">
        Control which IP address + device combos this account is allowed to sign in from. IP +
        browser/OS is a practical proxy for "device" — browsers don't expose real hardware
        model info to websites, so this can't distinguish two people on the exact same network
        and browser. Combined with the heartbeat check during video playback, this is enough to
        stop most account-sharing in practice.
      </p>

      {!loading && user && (
        <div className="glass-panel mt-6 flex items-center justify-between rounded-xl p-5">
          <div>
            <p className="text-sm font-medium text-ink">Restrict to approved devices</p>
            <p className="mt-1 text-xs text-ink-dim">
              {user.restrict_devices
                ? 'Only IP + device combos approved below will work for this account.'
                : 'Off — this account can sign in from anywhere. Approve at least one device below before turning this on.'}
            </p>
          </div>
          <button
            onClick={toggleRestrict}
            disabled={savingRestrict}
            className={`shrink-0 rounded-full px-4 py-2 text-xs font-medium transition disabled:opacity-60 ${
              user.restrict_devices
                ? 'bg-signal text-white hover:bg-signal-glow'
                : 'border border-vault-border bg-white/60 text-ink-dim hover:text-ink'
            }`}
          >
            {user.restrict_devices ? 'Restriction ON' : 'Restriction OFF'}
          </button>
        </div>
      )}

      {error && <p className="mt-3 text-xs text-danger">{error}</p>}

      <div className="mt-8">
        <p className="font-mono text-[11px] uppercase tracking-widest text-ink-faint">
          Approved devices ({approved.length})
        </p>
        {approved.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-vault-border p-6 text-center text-sm text-ink-faint">
            No approved devices yet.
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            {approved.map((d) => (
              <div
                key={d.id}
                className="flex items-center justify-between rounded-xl border border-vault-border bg-vault-900 px-4 py-3 backdrop-blur-xl"
              >
                <div>
                  <p className="text-sm text-ink">{d.device_label}</p>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">
                    {d.ip_address}
                  </p>
                </div>
                <button
                  disabled={busy === d.id}
                  onClick={() => revoke(d.id)}
                  className="rounded-md border border-danger/30 px-2.5 py-1 text-xs text-danger transition hover:bg-danger/10 disabled:opacity-50"
                >
                  Revoke
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-8">
        <p className="font-mono text-[11px] uppercase tracking-widest text-ink-faint">
          Recently seen (last {sightings.length})
        </p>
        {loading ? (
          <p className="mt-3 text-sm text-ink-faint">Loading…</p>
        ) : sightings.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-vault-border p-6 text-center text-sm text-ink-faint">
            No sign-ins recorded yet for this account.
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            {sightings.map((s) => {
              const key = `${s.ip_address}|${s.device_label}`;
              const approvedAlready = isApproved(s.ip_address, s.device_label);
              return (
                <div
                  key={s.id}
                  className="flex items-center justify-between rounded-xl border border-vault-border bg-vault-900 px-4 py-3 backdrop-blur-xl"
                >
                  <div>
                    <p className="text-sm text-ink">{s.device_label}</p>
                    <p className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">
                      {s.ip_address} · seen {s.sighting_count}× · last{' '}
                      {new Date(s.last_seen).toLocaleString()}
                    </p>
                  </div>
                  {approvedAlready ? (
                    <span className="rounded-full border border-ok/30 bg-ok/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-ok">
                      Approved
                    </span>
                  ) : (
                    <button
                      disabled={busy === key}
                      onClick={() => approve(s.ip_address, s.device_label)}
                      className="rounded-md bg-signal px-3 py-1.5 text-xs font-medium text-white transition hover:bg-signal-glow disabled:opacity-50"
                    >
                      Approve
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
