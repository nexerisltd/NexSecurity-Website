'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

type Device = {
  id: string;
  ip_address: string;
  device_label: string;
  status: 'authorized' | 'restricted';
  label: string | null;
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
  const [authorized, setAuthorized] = useState<Device[]>([]);
  const [restricted, setRestricted] = useState<Device[]>([]);
  const [pending, setPending] = useState<Sighting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

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
      setAuthorized(devicesData.authorized);
      setRestricted(devicesData.restricted);
      setPending(devicesData.pending);
    }
    setLoading(false);
  }

  useEffect(() => {
    if (userId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  async function decide(ip: string, deviceLabel: string, status: 'authorized' | 'restricted') {
    const key = `${ip}|${deviceLabel}`;
    setBusy(key);
    setError(null);
    const res = await fetch(`/api/admin/users/${userId}/devices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip_address: ip, device_label: deviceLabel, status }),
    });
    const data = await res.json();
    if (!res.ok) setError(data.error ?? 'Could not save decision.');
    setBusy(null);
    load();
  }

  async function changeStatus(deviceId: string, status: 'authorized' | 'restricted') {
    setBusy(deviceId);
    setError(null);
    const res = await fetch(`/api/admin/users/${userId}/devices/${deviceId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    const data = await res.json();
    if (!res.ok) setError(data.error ?? 'Could not update device.');
    setBusy(null);
    load();
  }

  async function rename(deviceId: string, label: string) {
    setError(null);
    const res = await fetch(`/api/admin/users/${userId}/devices/${deviceId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: label || null }),
    });
    const data = await res.json();
    if (!res.ok) setError(data.error ?? 'Could not rename.');
    load();
  }

  async function clearDecision(deviceId: string) {
    setBusy(deviceId);
    setError(null);
    const res = await fetch(`/api/admin/users/${userId}/devices/${deviceId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) setError(data.error ?? 'Could not remove.');
    setBusy(null);
    load();
  }

  return (
    <div>
      <Link
        href="/admin/users"
        className="font-mono text-[11px] uppercase tracking-widest text-ink-dim transition hover:text-ink"
      >
        ← Users
      </Link>
      <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.2em] text-signal-glow">Admin</p>
      <h1 className="mt-2 font-display text-2xl font-semibold text-ink">
        {loading ? 'Loading…' : user?.email ?? 'User'}
      </h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-dim">
        Approving or restricting any IP below turns on device restriction for this account —
        after that, only <span className="text-ink">Authorized</span> combos can sign in. IP +
        browser/OS is used as "device" (browsers don't expose real hardware model info).
      </p>

      {!loading && user?.restrict_devices && (
        <p className="mt-4 inline-flex items-center gap-2 rounded-full border border-signal/30 bg-signal/10 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-signal">
          Restriction active
        </p>
      )}

      {error && <p className="mt-3 text-xs text-danger">{error}</p>}

      <Section title="Authorized IP's" emptyText="No authorized IPs yet.">
        {authorized.map((d) => (
          <DeviceRow
            key={d.id}
            device={d}
            busy={busy === d.id}
            onRename={(label) => rename(d.id, label)}
            actions={
              <button
                disabled={busy === d.id}
                onClick={() => changeStatus(d.id, 'restricted')}
                className="rounded-md border border-danger/30 px-2.5 py-1 text-xs text-danger transition hover:bg-danger/10 disabled:opacity-50"
              >
                Restrict
              </button>
            }
          />
        ))}
      </Section>

      <Section title="Unauthorized IP request" emptyText="No pending sign-in attempts.">
        {pending.map((s) => {
          const key = `${s.ip_address}|${s.device_label}`;
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
              <div className="flex shrink-0 gap-2">
                <button
                  disabled={busy === key}
                  onClick={() => decide(s.ip_address, s.device_label, 'authorized')}
                  className="rounded-md bg-signal px-3 py-1.5 text-xs font-medium text-white transition hover:bg-signal-glow disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  disabled={busy === key}
                  onClick={() => decide(s.ip_address, s.device_label, 'restricted')}
                  className="rounded-md border border-danger/30 px-2.5 py-1 text-xs text-danger transition hover:bg-danger/10 disabled:opacity-50"
                >
                  Restrict
                </button>
              </div>
            </div>
          );
        })}
      </Section>

      <Section title="Restricted IP's" emptyText="No restricted IPs.">
        {restricted.map((d) => (
          <DeviceRow
            key={d.id}
            device={d}
            busy={busy === d.id}
            onRename={(label) => rename(d.id, label)}
            actions={
              <div className="flex gap-2">
                <button
                  disabled={busy === d.id}
                  onClick={() => changeStatus(d.id, 'authorized')}
                  className="rounded-md bg-signal px-3 py-1.5 text-xs font-medium text-white transition hover:bg-signal-glow disabled:opacity-50"
                >
                  Un-restrict
                </button>
                <button
                  disabled={busy === d.id}
                  onClick={() => clearDecision(d.id)}
                  className="rounded-md border border-vault-border px-2.5 py-1 text-xs text-ink-dim transition hover:text-ink disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            }
          />
        ))}
      </Section>
    </div>
  );
}

function Section({
  title,
  emptyText,
  children,
}: {
  title: string;
  emptyText: string;
  children: React.ReactNode;
}) {
  const items = Array.isArray(children) ? children : [children];
  const isEmpty = items.flat().length === 0;
  return (
    <div className="mt-8">
      <p className="font-mono text-[11px] uppercase tracking-widest text-ink-faint">{title}</p>
      {isEmpty ? (
        <p className="mt-3 rounded-xl border border-dashed border-vault-border p-6 text-center text-sm text-ink-faint">
          {emptyText}
        </p>
      ) : (
        <div className="mt-3 space-y-2">{children}</div>
      )}
    </div>
  );
}

function DeviceRow({
  device,
  actions,
  onRename,
}: {
  device: Device;
  busy: boolean;
  actions: React.ReactNode;
  onRename: (label: string) => void;
}) {
  const [label, setLabel] = useState(device.label ?? '');
  const [editing, setEditing] = useState(false);

  function save() {
    setEditing(false);
    if (label !== (device.label ?? '')) onRename(label);
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-vault-border bg-vault-900 px-4 py-3 backdrop-blur-xl">
      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            autoFocus
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => e.key === 'Enter' && save()}
            placeholder="Name this IP (e.g. Home WiFi)"
            className="w-full rounded-md border border-vault-border bg-white/70 px-2 py-1 text-sm text-ink outline-none focus:border-signal"
          />
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="text-left text-sm text-ink hover:underline"
            title="Click to rename"
          >
            {device.label || <span className="text-ink-faint">+ Add name</span>}
          </button>
        )}
        <p className="mt-0.5 font-mono text-[10px] uppercase tracking-widest text-ink-faint">
          {device.ip_address} · {device.device_label}
        </p>
      </div>
      <div className="shrink-0">{actions}</div>
    </div>
  );
}
