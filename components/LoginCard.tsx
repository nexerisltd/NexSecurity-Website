'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export function LoginCard({
  accessDenied,
  deviceBlocked,
}: {
  accessDenied: boolean;
  deviceBlocked?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);

  async function handleSignIn() {
    setLoading(true);
    setOauthError(null);
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: { prompt: 'select_account' },
      },
    });
    // If this succeeds, the browser navigates away to Google immediately
    // and this line never runs. Reaching here means it failed — most
    // often because the Google provider isn't enabled/configured in
    // Supabase yet, or this origin isn't in Supabase's allowed redirect
    // URLs (Authentication → URL Configuration).
    if (error) {
      setOauthError(error.message);
      setLoading(false);
    }
  }

  return (
    <div className="relative w-full max-w-sm">
      <div className="glass-panel relative overflow-hidden rounded-3xl">
        <div className="flex flex-col items-center px-8 pt-10">
          <div className="relative h-20 w-20 overflow-hidden rounded-2xl border border-vault-border bg-vault-800 shadow-glass">
            <Image src="/logo.png" alt="NexSecurity" fill className="object-cover" priority />
          </div>
          <p className="mt-5 font-mono text-[11px] uppercase tracking-[0.2em] text-signal">
            Private Learning Space
          </p>
          <h1 className="mt-2 text-center font-display text-2xl font-semibold text-ink">
            Authorized members only
          </h1>
          <p className="mt-2 text-center text-sm leading-relaxed text-ink-dim">
            Sign in with the Google account your administrator has granted access to.
          </p>
        </div>

        <div className="px-8 pb-8 pt-6 text-center">
          {oauthError && (
            <div className="mb-5 rounded-xl border border-danger/25 bg-danger/5 px-4 py-3 text-left backdrop-blur-sm">
              <p className="font-mono text-[11px] uppercase tracking-widest text-danger">
                Sign-in failed
              </p>
              <p className="mt-1 text-xs text-ink-dim">{oauthError}</p>
            </div>
          )}

          {accessDenied && (
            <div className="mb-5 rounded-xl border border-danger/25 bg-danger/5 px-4 py-3 text-left backdrop-blur-sm">
              <p className="font-mono text-[11px] uppercase tracking-widest text-danger">
                Access denied
              </p>
              <p className="mt-1 text-xs text-ink-dim">
                This account isn&apos;t authorized. Contact your administrator if you
                believe this is a mistake.
              </p>
            </div>
          )}

          {deviceBlocked && (
            <div className="mb-5 rounded-xl border border-danger/25 bg-danger/5 px-4 py-3 text-left backdrop-blur-sm">
              <p className="font-mono text-[11px] uppercase tracking-widest text-danger">
                Device not approved
              </p>
              <p className="mt-1 text-xs text-ink-dim">
                This account only works from approved devices. Ask your administrator to
                approve this device, or sign in from an approved one.
              </p>
            </div>
          )}

          <button
            onClick={handleSignIn}
            disabled={loading}
            className="flex w-full items-center justify-center gap-3 rounded-xl border border-vault-border bg-white/95 px-5 py-3 text-sm font-medium text-slate-800 shadow-glass transition hover:bg-white disabled:opacity-60"
          >
            <GoogleMark />
            {loading ? 'Redirecting…' : 'Continue with Google'}
          </button>

          <p className="mt-5 text-[11px] leading-relaxed text-ink-faint">
            By continuing, you agree to our{' '}
            <Link href="/terms" className="text-signal underline-offset-2 hover:underline">
              Terms
            </Link>{' '}
            and{' '}
            <Link href="/privacy" className="text-signal underline-offset-2 hover:underline">
              Privacy Policy
            </Link>
            .
          </p>
          <p className="mt-3 font-mono text-[10px] uppercase tracking-widest text-ink-faint">
            Session verified server-side · No public content
          </p>
        </div>
      </div>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.85.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  );
}
