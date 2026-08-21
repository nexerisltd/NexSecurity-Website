import Link from 'next/link';

export default function AuthCodeError() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-vault-950 px-6">
      <div className="w-full max-w-sm rounded-2xl border border-vault-border bg-vault-900 p-8 text-center backdrop-blur-xl shadow-glass">
        <p className="font-mono text-xs uppercase tracking-widest text-danger">
          SIGN-IN FAILED
        </p>
        <h1 className="mt-3 font-display text-xl text-ink">
          We couldn&apos;t complete sign-in
        </h1>
        <p className="mt-2 text-sm text-ink-dim">
          The link may have expired, or too many attempts were made. Try again.
        </p>
        <Link
          href="/login"
          className="mt-6 inline-block rounded-lg bg-signal px-5 py-2.5 text-sm font-medium text-white transition hover:bg-signal-glow"
        >
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
