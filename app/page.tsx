import Link from 'next/link';
import { PublicNav } from '@/components/PublicNav';
import { PublicFooter } from '@/components/PublicFooter';
import { getAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const STATS = [
  { label: 'Active members', value: '—' },
  { label: 'Classes published', value: '—' },
  { label: 'Instructors', value: '—' },
  { label: 'Boards', value: '—' },
];

const PATHS = [
  {
    title: 'Foundations',
    description: 'Core concepts, structured so nothing feels skipped.',
  },
  {
    title: 'Problem Solving',
    description: 'Worked examples and practice sets, board by board.',
  },
  {
    title: 'Exam Preparation',
    description: 'Focused revision tracks ahead of assessments.',
  },
  {
    title: 'Advanced Topics',
    description: 'Deeper material for members ready to go further.',
  },
];

const REVIEWS = [
  {
    quote:
      'Every class is exactly where I expect it to be. I stopped hunting through old links and just come here.',
    name: 'Member review',
  },
  {
    quote:
      'The boards are organized so well that revising before an exam actually feels manageable.',
    name: 'Member review',
  },
  {
    quote:
      "Knowing the content is private and only for us makes it feel like a real classroom, not a public feed.",
    name: 'Member review',
  },
];

export default async function HomePage() {
  const auth = await getAuth();
  const isMember = auth.state === 'AUTHORIZED';

  return (
    <div className="min-h-screen bg-vault-950">
      <PublicNav isMember={isMember} />

      {/* Hero */}
      <section className="relative overflow-hidden bg-grid bg-[size:32px_32px]">
        <div className="mx-auto max-w-6xl px-6 py-24 text-center">
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-signal-glow">
            Private Learning Space
          </p>
          <h1 className="mx-auto mt-4 max-w-2xl font-display text-4xl font-semibold leading-tight text-ink sm:text-5xl">
            A learning platform built for one thing: keeping your classes private.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-ink-dim">
            Every board, page, and class here is behind a server-verified allowlist. No public
            links, no guessable URLs — if you&apos;re not an authorized member, there&apos;s
            nothing to see.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            {isMember ? (
              <Link
                href="/learn"
                className="rounded-lg bg-signal px-6 py-3 text-sm font-medium text-white transition hover:bg-signal-glow"
              >
                Go to Learn
              </Link>
            ) : (
              <Link
                href="/login"
                className="rounded-lg bg-signal px-6 py-3 text-sm font-medium text-white transition hover:bg-signal-glow"
              >
                Member sign in
              </Link>
            )}
            <Link
              href="/#paths"
              className="rounded-lg border border-vault-border px-6 py-3 text-sm font-medium text-ink-dim transition hover:border-signal hover:text-ink"
            >
              See learning paths
            </Link>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="border-y border-vault-border bg-vault-900">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-6 px-6 py-10 sm:grid-cols-4">
          {STATS.map((stat) => (
            <div key={stat.label} className="text-center">
              <p className="font-display text-2xl font-semibold text-ink sm:text-3xl">
                {stat.value}
              </p>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-widest text-ink-faint">
                {stat.label}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Learning paths */}
      <section id="paths" className="mx-auto max-w-6xl px-6 py-20">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-signal-glow">
          What&apos;s inside
        </p>
        <h2 className="mt-2 font-display text-2xl font-semibold text-ink sm:text-3xl">
          Organized learning paths, not a pile of links
        </h2>
        <p className="mt-3 max-w-xl text-sm text-ink-dim">
          Boards nest into boards, so a topic can hold sub-topics and a full course can hold
          many, all the way down to the class itself.
        </p>

        <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {PATHS.map((path) => (
            <div
              key={path.title}
              className="rounded-xl border border-vault-border bg-vault-900 p-5 transition hover:border-signal/50 backdrop-blur-xl shadow-glass"
            >
              <div className="aspect-video w-full rounded-lg bg-gradient-to-br from-vault-800 to-vault-700" />
              <h3 className="mt-4 font-display text-sm font-medium text-ink">{path.title}</h3>
              <p className="mt-1 text-xs text-ink-dim">{path.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Reviews */}
      <section id="reviews" className="border-t border-vault-border bg-vault-900">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-signal-glow">
            From our members
          </p>
          <h2 className="mt-2 font-display text-2xl font-semibold text-ink sm:text-3xl">
            What it&apos;s like on the inside
          </h2>

          <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-3">
            {REVIEWS.map((review, i) => (
              <div key={i} className="rounded-xl border border-vault-border bg-vault-800 p-5">
                <p className="text-sm leading-relaxed text-ink-dim">&ldquo;{review.quote}&rdquo;</p>
                <p className="mt-4 font-mono text-[10px] uppercase tracking-widest text-ink-faint">
                  {review.name}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-6 text-xs text-ink-faint">
            Placeholder copy — replace with real member reviews once you have them.
          </p>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="mx-auto max-w-3xl px-6 py-20">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-signal-glow text-center">
          Questions
        </p>
        <h2 className="mt-2 text-center font-display text-2xl font-semibold text-ink sm:text-3xl">
          Frequently asked
        </h2>

        <div className="mt-10 space-y-4">
          <FaqItem
            q="How do I get access?"
            a="Membership is invite-only. An administrator adds your email to the allowlist, and you sign in with that same Google account."
          />
          <FaqItem
            q="I signed in but can't see anything — why?"
            a="Your Google account authenticated successfully, but access is a separate step. If your email hasn't been added by an administrator, or has been disabled, you'll see an access-denied message instead of content."
          />
          <FaqItem
            q="Can I share a class link with someone outside the platform?"
            a="Class pages only load for signed-in, authorized members — anyone else hits an access-denied screen, regardless of the link."
          />
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-vault-border">
        <div className="mx-auto max-w-6xl px-6 py-20 text-center">
          <h2 className="font-display text-2xl font-semibold text-ink sm:text-3xl">
            {isMember ? 'Welcome back.' : 'Already a member?'}
          </h2>
          <p className="mt-2 text-sm text-ink-dim">
            {isMember
              ? 'Jump back into your boards and classes.'
              : 'Sign in with the Google account on file.'}
          </p>
          <Link
            href={isMember ? '/learn' : '/login'}
            className="mt-6 inline-block rounded-lg bg-signal px-6 py-3 text-sm font-medium text-white transition hover:bg-signal-glow"
          >
            {isMember ? 'Go to Learn' : 'Member sign in'}
          </Link>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  return (
    <div className="rounded-xl border border-vault-border bg-vault-900 p-5 backdrop-blur-xl shadow-glass">
      <p className="font-display text-sm font-medium text-ink">{q}</p>
      <p className="mt-2 text-sm leading-relaxed text-ink-dim">{a}</p>
    </div>
  );
}
