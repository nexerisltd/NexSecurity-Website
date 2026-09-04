'use client';

import { useEffect, useState } from 'react';

type PopupSettings = {
  enabled: boolean;
  title: string;
  message: string;
  button_label: string;
  button_url: string | null;
  interval_hours: number;
  version: number;
  updated_at: string;
};

export default function AdminPopupPage() {
  const [settings, setSettings] = useState<PopupSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [enabled, setEnabled] = useState(false);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [buttonLabel, setButtonLabel] = useState('Got it');
  const [buttonUrl, setButtonUrl] = useState('');
  const [intervalValue, setIntervalValue] = useState(10);
  const [intervalUnit, setIntervalUnit] = useState<'hours' | 'days'>('hours');

  useEffect(() => {
    (async () => {
      setLoading(true);
      const res = await fetch('/api/admin/popup');
      const data = await res.json();
      if (res.ok && data.settings) {
        const s = data.settings as PopupSettings;
        setSettings(s);
        setEnabled(s.enabled);
        setTitle(s.title);
        setMessage(s.message);
        setButtonLabel(s.button_label || 'Got it');
        setButtonUrl(s.button_url ?? '');
        // Show whichever unit divides evenly, so an admin who set "10
        // days" doesn't come back to see "240 hours".
        if (s.interval_hours % 24 === 0) {
          setIntervalValue(s.interval_hours / 24);
          setIntervalUnit('days');
        } else {
          setIntervalValue(s.interval_hours);
          setIntervalUnit('hours');
        }
      }
      setLoading(false);
    })();
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    const safeInterval = Number.isFinite(intervalValue) && intervalValue > 0 ? intervalValue : 1;
    const interval_hours = intervalUnit === 'days' ? safeInterval * 24 : safeInterval;
    const trimmedUrl = buttonUrl.trim();
    const res = await fetch('/api/admin/popup', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enabled,
        title,
        message,
        button_label: buttonLabel.trim() || 'Got it',
        button_url: trimmedUrl || null,
        interval_hours,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'Could not save popup settings.');
    } else {
      setSettings(data.settings);
      setSaved(true);
    }
    setSaving(false);
  }

  return (
    <div>
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-signal-glow">Admin</p>
      <h1 className="mt-2 font-display text-2xl font-semibold text-ink">Announcement popup</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-dim">
        One site-wide popup, shown to every authorized user (not on the admin panel itself). Set
        how often the SAME person is shown it again — they only see it once per interval, not
        every time they visit.
      </p>

      {loading ? (
        <p className="mt-8 text-center text-sm text-ink-faint">Loading…</p>
      ) : (
        <form onSubmit={save} className="mt-6 grid grid-cols-1 gap-4 rounded-xl border border-vault-border bg-vault-900 p-5 backdrop-blur-xl shadow-glass sm:grid-cols-2">
          <label className="flex items-center gap-2 sm:col-span-2">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="accent-signal" />
            <span className="text-sm text-ink">Popup is on</span>
          </label>

          <Field label="Title">
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="input" placeholder="e.g. New batch enrollment open" />
          </Field>
          <Field label="Button label">
            <input value={buttonLabel} onChange={(e) => setButtonLabel(e.target.value)} className="input" placeholder="Got it" />
          </Field>

          <div className="sm:col-span-2">
            <Field label="Message">
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={4}
                maxLength={8000}
                className="input resize-y"
                placeholder="What you want every user to see…"
              />
              <p className="mt-1 text-right font-mono text-[10px] text-ink-faint">{message.length} / 8000</p>
            </Field>
          </div>

          <Field label="Button link (optional — must start with https://, opens in a new tab)">
            <input value={buttonUrl} onChange={(e) => setButtonUrl(e.target.value)} className="input" placeholder="https://..." />
          </Field>

          <Field label="Show again every…">
            <div className="flex gap-2">
              <input
                type="number"
                min={1}
                value={intervalValue}
                onChange={(e) => setIntervalValue(Math.max(1, Number(e.target.value) || 1))}
                className="input w-24"
              />
              <select value={intervalUnit} onChange={(e) => setIntervalUnit(e.target.value as 'hours' | 'days')} className="input">
                <option value="hours">Hours</option>
                <option value="days">Days</option>
              </select>
            </div>
            <p className="mt-1 text-xs text-ink-faint">
              e.g. 10 hours: a user who sees it now won&rsquo;t see it again until 10 hours have
              passed, even if they visit many times in between.
            </p>
          </Field>

          <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-signal px-4 py-2 text-sm font-medium text-white transition hover:bg-signal-glow disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            {saved && <span className="text-xs text-ok">Saved — everyone will see the update next time they&rsquo;re due.</span>}
            {error && <span className="text-xs text-danger">{error}</span>}
          </div>

          {settings && (
            <p className="sm:col-span-2 font-mono text-[10px] uppercase tracking-widest text-ink-faint">
              Version {settings.version} · last saved {new Date(settings.updated_at).toLocaleString()}
            </p>
          )}
        </form>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
