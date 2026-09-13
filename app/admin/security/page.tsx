'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

type Incident = {
  id: number;
  event_type: string;
  actor_email: string | null;
  target: string | null;
  metadata: Record<string, unknown>;
  review_status: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
};

const STATUS_OPTIONS = ['pending', 'reviewed', 'false_positive', 'confirmed_abuse', 'action_taken'] as const;

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  reviewed: 'Reviewed',
  false_positive: 'False Positive',
  confirmed_abuse: 'Confirmed Abuse',
  action_taken: 'Action Taken',
};

const STATUS_COLOR: Record<string, string> = {
  pending: 'bg-warn/10 text-warn',
  reviewed: 'bg-signal/10 text-signal',
  false_positive: 'bg-ink-faint/10 text-ink-dim',
  confirmed_abuse: 'bg-danger/10 text-danger',
  action_taken: 'bg-ok/10 text-ok',
};

function metaString(meta: Record<string, unknown>, key: string): string {
  const v = meta[key];
  return typeof v === 'string' && v ? v : '—';
}

export default function AdminSecurityPage() {
  const searchParams = useSearchParams();
  const highlightId = searchParams.get('highlight');

  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const rowRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const hasScrolledToHighlight = useRef(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/security');
    const data = await res.json();
    if (res.ok) setIncidents(data.incidents);
    else setError(data.error ?? 'Could not load incidents.');
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Same pattern as app/admin/requests/page.tsx's own highlight-and-
  // scroll — a notification's url (see notifySecurityIncident in
  // lib/webPush.ts) links straight to ?highlight=<id> so clicking it
  // lands an admin on the exact incident instead of the top of a
  // 200-row list.
  useEffect(() => {
    if (!highlightId || hasScrolledToHighlight.current) return;
    const el = rowRefs.current[Number(highlightId)];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      hasScrolledToHighlight.current = true;
    }
  }, [highlightId, incidents]);

  async function updateStatus(id: number, review_status: string) {
    setBusyId(id);
    setError(null);
    const res = await fetch(`/api/admin/security/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ review_status }),
    });
    const data = await res.json();
    if (!res.ok) setError(data.error ?? 'Could not update incident.');
    setBusyId(null);
    load();
  }

  return (
    <div>
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-signal-glow">Admin</p>
      <h1 className="mt-2 font-display text-2xl font-semibold text-ink">Security Incidents</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-dim">
        Every DevTools-detection incident reported by a student's browser (see components/DevToolsGuard.tsx) — newest
        first. This is a frontend deterrent signal, not proof of anything on its own; use the information below to
        decide a review status for each incident.
      </p>

      {error && <p className="mt-3 text-xs text-danger">{error}</p>}

      <div className="mt-6 space-y-3">
        {loading ? (
          <p className="text-center text-sm text-ink-faint">Loading…</p>
        ) : incidents.length === 0 ? (
          <p className="rounded-xl border border-dashed border-vault-border p-10 text-center text-sm text-ink-faint">
            No security incidents recorded.
          </p>
        ) : (
          incidents.map((incident) => (
            <div
              key={incident.id}
              ref={(el) => {
                rowRefs.current[incident.id] = el;
              }}
              className={`glass-panel rounded-xl p-4 transition sm:p-5 ${
                String(incident.id) === highlightId ? 'ring-2 ring-signal' : ''
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-ink">{incident.actor_email ?? 'Unknown user'}</p>
                  <p className="text-xs text-ink-faint">{new Date(incident.created_at).toLocaleString()}</p>
                </div>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_COLOR[incident.review_status ?? 'pending']}`}
                >
                  {STATUS_LABEL[incident.review_status ?? 'pending']}
                </span>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-xs text-ink-dim sm:grid-cols-2">
                <p>Device: {metaString(incident.metadata, 'device_label')}</p>
                <p>Device ID: {metaString(incident.metadata, 'device_id')}</p>
                <p>Device status: {metaString(incident.metadata, 'device_status')}</p>
                <p>IP: {metaString(incident.metadata, 'ip')}</p>
                <p>OS: {metaString(incident.metadata, 'os')}</p>
                <p>Browser: {metaString(incident.metadata, 'browser')}</p>
                <p>Detection type: {incident.event_type.replace(/_/g, ' ')}</p>
                {incident.reviewed_by && (
                  <p>
                    Reviewed by {incident.reviewed_by} · {incident.reviewed_at ? new Date(incident.reviewed_at).toLocaleString() : ''}
                  </p>
                )}
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {STATUS_OPTIONS.map((status) => (
                  <button
                    key={status}
                    disabled={busyId === incident.id || incident.review_status === status}
                    onClick={() => updateStatus(incident.id, status)}
                    className="rounded-lg border border-vault-border px-2.5 py-1 text-xs text-ink-dim transition hover:border-signal hover:text-signal disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {STATUS_LABEL[status]}
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
