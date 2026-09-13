'use client';

export type SecurityIncidentInfo = {
  nsUserId: string;
  accountIdentifier: string;
  deviceName: string;
  deviceId: string;
  deviceApprovalStatus: string;
  ip: string;
  os: string;
  browser: string;
  detectionTime: string;
  detectionType: string;
  attemptNumber: number;
  remainingAttempts: number | null;
};

const CONTACT_EMAIL = 'mr.arx.me@gmail.com';
const CONTACT_PHONE_DISPLAY = '+880 1940860388';
const CONTACT_PHONE_TEL = '+8801940860388';
const CONTACT_WHATSAPP = 'https://wa.me/8801940860388';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-vault-border/60 py-2.5 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-2">
      <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">{label}</span>
      <span className="break-all text-sm text-ink sm:text-right">{value}</span>
    </div>
  );
}

/**
 * The full-page lock shown when components/DevToolsGuard.tsx's
 * heuristic fires — rendered directly (not routed to), since the whole
 * point is to cover whatever the person was looking at without a
 * navigation that DevTools-open network/console tabs would just show
 * anyway. Every value here comes from app/api/security/incident/
 * route.ts's response, itself pulled from the SAME auth/device-identity
 * system the rest of the app uses (lib/auth.ts, lib/requestInfo.ts,
 * user_devices) — nothing on this screen is invented client-side.
 */
export function SecurityIncidentScreen({ incident }: { incident: SecurityIncidentInfo }) {
  const detectionTimeLocal = new Date(incident.detectionTime).toLocaleString();

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center overflow-y-auto bg-vault-950/97 p-4 backdrop-blur-xl sm:p-6">
      <div className="glass-panel-solid w-full max-w-2xl rounded-2xl p-6 sm:p-8">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-danger/10 text-danger">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M12 3 3.5 7.5v5c0 5 3.6 8.7 8.5 10 4.9-1.3 8.5-5 8.5-10v-5L12 3Z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
              />
              <path d="M12 9v4.5M12 16.5h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </div>
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-danger">Security Incident</p>
            <h1 className="font-display text-xl font-semibold text-ink sm:text-2xl">Developer Tools Detected</h1>
          </div>
        </div>

        <p className="mt-5 text-sm leading-relaxed text-ink-dim">
          Your access to this page has been temporarily locked because Developer Tools activity was detected.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-ink-dim">
          For security and anti-piracy purposes, the available security information related to this incident has
          been recorded for security review.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-ink-dim">
          If unauthorized distribution, piracy, credential sharing, or other abuse is confirmed after review, your
          account may be permanently banned or blacklisted in accordance with NexSecurity&apos;s terms and applicable
          policy. Refund eligibility may also be affected where applicable.
        </p>

        <div className="mt-6 rounded-xl border border-vault-border bg-vault-900/60 px-4 py-1 sm:px-5">
          <Row label="NS User" value={incident.nsUserId} />
          <Row label="Account" value={incident.accountIdentifier} />
          <Row label="Device Name" value={incident.deviceName} />
          <Row label="Device ID" value={incident.deviceId} />
          <Row label="Device Approval Status" value={incident.deviceApprovalStatus} />
          <Row label="IP Address" value={incident.ip} />
          <Row label="Device / OS" value={incident.os} />
          <Row label="Browser" value={incident.browser} />
          <Row label="Detection Type" value={incident.detectionType.replace(/_/g, ' ')} />
          <Row label="Attempt" value={String(incident.attemptNumber)} />
          <Row
            label="Remaining Attempts"
            value={incident.remainingAttempts === null ? 'No limit configured' : String(incident.remainingAttempts)}
          />
          <Row label="Detection Time" value={detectionTimeLocal} />
        </div>

        <div className="mt-6 rounded-xl border border-vault-border bg-vault-800/40 p-4 text-sm text-ink-dim">
          If you believe this detection was incorrect or you have not engaged in unauthorized activity, please
          contact the NexSecurity administrator/security team.
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-4">
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-signal-glow underline underline-offset-2 hover:text-signal">
              {CONTACT_EMAIL}
            </a>
            <a href={`tel:${CONTACT_PHONE_TEL}`} className="text-signal-glow underline underline-offset-2 hover:text-signal">
              {CONTACT_PHONE_DISPLAY} (Call)
            </a>
            <a
              href={CONTACT_WHATSAPP}
              target="_blank"
              rel="noopener noreferrer"
              className="text-signal-glow underline underline-offset-2 hover:text-signal"
            >
              WhatsApp / Telegram
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
