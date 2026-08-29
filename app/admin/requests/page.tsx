'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { relativeTime } from '@/lib/relativeTime';

type PendingRequest = {
  id: string;
  device_id: string;
  ip_address: string;
  device_label: string;
  first_seen: string;
  user_id: string | null;
  user_email: string;
};

const POLL_MS = 15_000;

export default function AdminRequestsPage() {
  const searchParams = useSearchParams();
  const highlightId = searchParams.get('highlight');

  const [requests, setRequests] = useState<PendingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const hasScrolledToHighlight = useRef(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/requests');
    const data = await res.json();
    if (res.ok) setRequests(data.requests);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, POLL_MS);
    return () => clearInterval(interval);
  }, [load]);

  // Scroll the linked-to request into view and highlight it, once, the
  // first time it actually shows up in a loaded list — not on every poll
  // refresh, so scrolling doesn't fight anyone who's since scrolled away.
  useEffect(() => {
    if (!highlightId || hasScrolledToHighlight.current) return;
    const el = rowRefs.current[highlightId];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      hasScrolledToHighlight.current = true;
    }
  }, [highlightId, requests]);

  async function decide(req: PendingRequest, status: 'authorized' | 'restricted') {
    if (!req.user_id) return;
    setBusyId(req.id);
    setError(null);
    const res = await fetch(`/api/admin/users/${req.user_id}/devices/${req.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    const data = await res.json();
    if (!res.ok) setError(data.error ?? 'Could not save decision.');
    setBusyId(null);
    load();
  }

  return (
    <div>
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-signal-glow">Admin</p>
      <h1 className="mt-2 font-display text-2xl font-semibold text-ink">Requests</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-dim">
        Every device waiting on your approval before it can sign in, across every account —
        newest first. This list refreshes on its own every 15 seconds.
      </p>

      {error && <p className="mt-3 text-xs text-danger">{error}</p>}

      <div className="mt-6 space-y-2">
        {loading ? (
          <p className="text-center text-sm text-ink-faint">Loading…</p>
        ) : requests.length === 0 ? (
          <p className="rounded-xl border border-dashed border-vault-border p-10 text-center text-sm text-ink-faint">
            No pending sign-in requests right now.
          </p>
        ) : (
          requests.map((req) => (
            <div
              key={req.id}
              ref={(el) => {
                rowRefs.current[req.id] = el;
              }}
              className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 backdrop-blur-xl transition-colors ${
                req.id === highlightId
                  ? 'border-signal bg-signal/10 shadow-glow'
                  : 'border-vault-border bg-vault-900'
              }`}
            >
              <div className="min-w-0 flex-1">
                {req.user_id ? (
                  <Link
                    href={`/admin/users/${req.user_id}`}
                    className="text-sm text-ink hover:underline"
                  >
                    {req.user_email}
                  </Link>
                ) : (
                  <p className="text-sm text-ink">{req.user_email}</p>
                )}
                <p className="mt-0.5 font-mono text-[10px] uppercase tracking-widest text-ink-faint">
                  {req.device_label} · {req.ip_address} · requested {relativeTime(req.first_seen)}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  disabled={busyId === req.id || !req.user_id}
                  onClick={() => decide(req, 'authorized')}
                  className="rounded-md bg-signal px-3 py-1.5 text-xs font-medium text-white transition hover:bg-signal-glow disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  disabled={busyId === req.id || !req.user_id}
                  onClick={() => decide(req, 'restricted')}
                  className="rounded-md border border-danger/30 px-2.5 py-1 text-xs text-danger transition hover:bg-danger/10 disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
