'use client';

import { useEffect, useState } from 'react';

const NEXAPP_URL = 'https://nexappog.vercel.app/shop/nexsecurity';

// Chrome/Edge/Android's install prompt event isn't in the standard DOM
// lib typings yet (it's a proposed spec, not finalized), so it's typed
// by hand here rather than pulled in from @types.
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    // iOS Safari's own (non-standard) flag — it never fires
    // beforeinstallprompt at all, so this is the only signal there.
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export default function DownloadsPage() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    setInstalled(isStandaloneDisplay());
    setIos(isIos());

    function onBeforeInstallPrompt(e: Event) {
      // Stops Chrome's own mini-infobar so the button below is the one
      // and only install entry point on this page.
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    }
    function onAppInstalled() {
      setInstalled(true);
      setInstallPrompt(null);
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  async function handleInstallClick() {
    if (!installPrompt) return;
    setInstalling(true);
    try {
      await installPrompt.prompt();
      await installPrompt.userChoice;
    } finally {
      // Each BeforeInstallPromptEvent is single-use regardless of outcome.
      setInstallPrompt(null);
      setInstalling(false);
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-signal-glow">Get the app</p>
      <h1 className="mt-2 font-display text-2xl font-semibold text-ink">Downloads</h1>
      <p className="mt-2 max-w-xl text-sm text-ink-dim">
        Use NexSecurity as an installed app instead of a browser tab — quicker to open, and it stays out of your
        browser's tab clutter.
      </p>

      <div className="mt-8 grid gap-6 sm:grid-cols-2">
        {/* PWA install */}
        <div className="glass-panel flex flex-col gap-4 rounded-2xl p-6">
          <div>
            <h2 className="font-display text-base font-semibold text-ink">Install as an app</h2>
            <p className="mt-1.5 text-sm text-ink-dim">
              Works on any device — Android, iOS, Windows, or macOS. Installs straight from your browser, no app
              store needed, and always stays on the latest version automatically.
            </p>
          </div>

          {installed ? (
            <div className="flex items-center gap-2 rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 text-xs font-medium text-ok">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="m5 12.5 4.5 4.5L19 7.5"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Already installed on this device
            </div>
          ) : installPrompt ? (
            <button
              onClick={handleInstallClick}
              disabled={installing}
              className="flex w-fit items-center gap-1.5 rounded-lg bg-signal px-4 py-2 text-xs font-medium text-white transition hover:bg-signal-glow disabled:opacity-60"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M12 3.5v11m0 0-3.8-3.8M12 14.5l3.8-3.8M5 17v1.5A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V17"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {installing ? 'Installing…' : 'Install App'}
            </button>
          ) : ios ? (
            <div className="rounded-lg border border-vault-border bg-vault-800/60 px-3 py-2.5 text-xs text-ink-dim">
              On iPhone/iPad: tap the <span className="font-medium text-ink">Share</span> icon in Safari, then{' '}
              <span className="font-medium text-ink">Add to Home Screen</span>.
            </div>
          ) : (
            <div className="rounded-lg border border-vault-border bg-vault-800/60 px-3 py-2.5 text-xs text-ink-dim">
              Open your browser's menu and look for{' '}
              <span className="font-medium text-ink">Install app</span> or{' '}
              <span className="font-medium text-ink">Add to Home screen</span>.
            </div>
          )}
        </div>

        {/* NexApp APK */}
        <div className="glass-panel flex flex-col gap-4 rounded-2xl p-6">
          <div>
            <h2 className="font-display text-base font-semibold text-ink">Download for Android (APK)</h2>
            <p className="mt-1.5 text-sm text-ink-dim">
              Prefer a standalone Android app instead? Get the NexSecurity APK from{' '}
              <span className="font-medium text-ink">NexApp</span> — an independent app store built for
              self-hosted developers, where every app is published through a verified developer account.
            </p>
          </div>
          <a
            href={NEXAPP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex w-fit items-center gap-1.5 rounded-lg border border-signal/40 bg-signal/10 px-4 py-2 text-xs font-medium text-signal-glow transition hover:bg-signal/20"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M12 3.5v11m0 0-3.8-3.8M12 14.5l3.8-3.8M5 17v1.5A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V17"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Get it on NexApp
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden className="ml-0.5">
              <path
                d="M7 17 17 7M9 7h8v8"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </a>
          <p className="text-[11px] text-ink-faint">
            You'll leave NexSecurity and land on the NexApp listing for this app.
          </p>
        </div>
      </div>
    </main>
  );
}
