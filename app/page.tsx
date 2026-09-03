import Link from 'next/link';
import { PublicNav } from '@/components/PublicNav';
import { PublicFooter } from '@/components/PublicFooter';
import { TopNav } from '@/components/TopNav';
import { BoardsOverviewPanel, type OverviewBoard, type OverviewActivity } from '@/components/BoardsOverviewPanel';
import { getAuth } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { relativeTime } from '@/lib/relativeTime';

export const dynamic = 'force-dynamic';

const FEATURES = [
  {
    title: 'Structured Boards',
    description: "Organize topics in a clean hierarchy that's easy to navigate.",
    icon: (
      <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="m12 3 8 4-8 4-8-4 8-4Z" />
        <path d="m4 11 8 4 8-4" />
        <path d="m4 15 8 4 8-4" />
      </g>
    ),
    bg: 'bg-signal/10',
    fg: 'text-signal',
  },
  {
    title: 'Focused Classes',
    description: 'Each class is distraction-free and built for deep learning.',
    icon: (
      <path
        d="M6 4h9l3 3v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm8 0v4h4M8 12h8M8 15.5h8M8 8.5h3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
    bg: 'bg-ok/10',
    fg: 'text-ok',
  },
  {
    title: 'Private by Design',
    description: 'Server-verified allowlist ensures only members can access.',
    icon: (
      <path
        d="M12 3.5 5 6v5.4c0 4.4 2.9 7.7 7 9.1 4.1-1.4 7-4.7 7-9.1V6l-7-2.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
    bg: 'bg-violet-500/10',
    fg: 'text-violet-400',
  },
  {
    title: 'Fast & Simple',
    description: 'No clutter, no ads. Just the content that matters.',
    icon: (
      <path
        d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
    bg: 'bg-warn/10',
    fg: 'text-warn',
  },
];

/** 2-level ancestor lookup: a board's "subject" for stats/activity display
 * is itself if top-level, or its parent if nested one level deep. Boards
 * nest arbitrarily per the schema, but the reference design's grouping is
 * by subject, so this stays at 2 levels rather than a full recursive walk. */
function topLevelTitle(
  boardId: string,
  boardsById: Map<string, { title: string; parent_id: string | null }>
): string {
  const board = boardsById.get(boardId);
  if (!board) return 'Uncategorized';
  if (!board.parent_id) return board.title;
  return boardsById.get(board.parent_id)?.title ?? board.title;
}

export default async function HomePage() {
  const auth = await getAuth();
  const isMember = auth.state === 'AUTHORIZED';

  const supabase = createSupabaseServerClient();
  const adminClient = createSupabaseAdminClient();

  // Aggregate counts only (no member identities, no board/video content) —
  // safe to compute for both guests and members as marketing-style stats.
  // authorized_users and videos have no regular-user SELECT policy (see
  // supabase/schema.sql), so these go through the admin client — same
  // pattern used in app/learn/board/[id]/page.tsx for video reads, just
  // for counts here instead of content.
  const [{ count: instructors }, { data: publishedBoards }] = await Promise.all([
    // No "instructor" role exists in the schema — ADMIN is the closest
    // real concept (the people who publish/manage content), so that's
    // what this stat counts.
    adminClient
      .from('authorized_users')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'ACTIVE')
      .eq('role', 'ADMIN'),
    supabase.from('boards').select('id, title, parent_id').eq('published', true),
  ]);

  const boardsById = new Map((publishedBoards ?? []).map((b) => [b.id, { title: b.title, parent_id: b.parent_id }]));
  const topBoards = (publishedBoards ?? []).filter((b) => !b.parent_id);

  const { count: classesPublished } = publishedBoards?.length
    ? await adminClient
        .from('videos')
        .select('id', { count: 'exact', head: true })
        .eq('published', true)
        .in(
          'board_id',
          publishedBoards.map((b) => b.id)
        )
    : { count: 0 };

  const stats = [
    { label: 'Classes Published', value: classesPublished ?? 0 },
    { label: 'Instructors', value: instructors ?? 0 },
    { label: 'Boards', value: topBoards.length },
  ];

  let overviewBoards: OverviewBoard[] = [];
  let overviewActivity: OverviewActivity[] = [];

  if (isMember && publishedBoards?.length) {
    const { data: recentVideos } = await adminClient
      .from('videos')
      .select('id, title, board_id, created_at')
      .eq('published', true)
      .in(
        'board_id',
        publishedBoards.map((b) => b.id)
      )
      .order('created_at', { ascending: false })
      .limit(40);

    const videos = recentVideos ?? [];

    overviewBoards = topBoards.slice(0, 4).map((b, i) => {
      const childIds = (publishedBoards ?? []).filter((c) => c.parent_id === b.id).map((c) => c.id);
      const classCount = videos.filter((v) => v.board_id === b.id || childIds.includes(v.board_id)).length;
      return { id: b.id, title: b.title, classCount, icon: i };
    });

    overviewActivity = videos.slice(0, 4).map((v, i) => ({
      videoId: v.id,
      title: v.title,
      category: topLevelTitle(v.board_id, boardsById),
      timeAgo: relativeTime(v.created_at),
      icon: i,
    }));
  }

  return (
    <div className="min-h-screen bg-vault-950">
      {isMember && auth.state === 'AUTHORIZED' ? <TopNav email={auth.email} isAdmin={auth.user.role === 'ADMIN'} profile={auth.profile} /> : <PublicNav isMember={false} />}

      {/* Hero */}
      <section className="relative overflow-hidden bg-grid bg-[size:32px_32px]">
        {isMember ? (
          <div className="mx-auto grid max-w-screen-2xl gap-14 px-6 py-20 lg:grid-cols-2 lg:items-center">
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-signal/20 bg-signal/10 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.15em] text-signal">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <rect x="5" y="10" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="2" />
                  <path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                Private Learning Space
              </span>
              <h1 className="mt-5 font-display text-5xl font-semibold leading-tight text-ink sm:text-6xl">
                A learning platform built for one thing: keeping your{' '}
                <span className="text-signal">classes private.</span>
              </h1>
              <p className="mt-6 max-w-2xl text-base leading-relaxed text-ink-dim">
                Every board, page, and class here is behind a server-verified allowlist. No public
                links, no guessable URLs — if you&apos;re not an authorized member, there&apos;s
                nothing to see.
              </p>
              <div className="mt-9 flex items-center gap-3">
                <Link
                  href="/learn"
                  className="inline-flex items-center gap-2 rounded-lg bg-signal px-7 py-3.5 text-sm font-medium text-white transition hover:bg-signal-glow"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  Go to Learn
                </Link>
                <Link
                  href="/learn"
                  className="inline-flex items-center gap-2 rounded-lg border border-vault-border px-7 py-3.5 text-sm font-medium text-ink-dim transition hover:border-signal hover:text-ink"
                >
                  See learning paths
                </Link>
              </div>
            </div>

            <BoardsOverviewPanel boards={overviewBoards} activity={overviewActivity} />
          </div>
        ) : (
          <div className="mx-auto max-w-screen-2xl px-6 py-24 text-center">
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
              <Link
                href="/login"
                className="rounded-lg bg-signal px-6 py-3 text-sm font-medium text-white transition hover:bg-signal-glow"
              >
                Member sign in
              </Link>
              <Link
                href="/#paths"
                className="rounded-lg border border-vault-border px-6 py-3 text-sm font-medium text-ink-dim transition hover:border-signal hover:text-ink"
              >
                See learning paths
              </Link>
            </div>
          </div>
        )}
      </section>

      {/* Stats — an inset floating glass panel (matches the nav/hero-panel
          treatment) instead of a full-bleed border-y bar. A full-bleed
          opaque bg-vault-900 slab sat directly on top of the page glow and
          blocked it edge-to-edge, which is what turned this into a flat,
          disconnected band. Floating it as a card lets the glow show on
          both sides, the same way it does in the reference design. */}
      <section className="px-6 py-12">
        <div className="glass-panel-solid mx-auto grid max-w-screen-2xl grid-cols-3 gap-8 rounded-2xl px-8 py-10 sm:px-14 sm:py-12">
          {stats.map((stat) => (
            <div key={stat.label} className="flex items-center gap-3">
              <div>
                <p className="font-display text-3xl font-semibold text-ink sm:text-4xl">{stat.value}</p>
                <p className="mt-1 text-sm text-ink-faint">{stat.label}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* What's inside */}
      <section id="paths" className="mx-auto max-w-screen-2xl px-6 py-24">
        <p className="text-center font-mono text-[11px] uppercase tracking-[0.2em] text-signal-glow">
          What&apos;s inside
        </p>
        <h2 className="mt-2 text-center font-display text-2xl font-semibold text-ink sm:text-3xl">
          Organized learning paths, not a pile of links.
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-sm text-ink-dim">
          Boards nest into boards, so a topic can hold sub-topics and a full course can hold
          many, all the way down to the class itself.
        </p>

        <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((feature) => (
            <div
              key={feature.title}
              className="rounded-xl border border-vault-border bg-vault-900 p-7 transition hover:border-signal/50 backdrop-blur-xl shadow-glass"
            >
              <span className={`flex h-12 w-12 items-center justify-center rounded-lg ${feature.bg} ${feature.fg}`}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  {feature.icon}
                </svg>
              </span>
              <h3 className="mt-5 font-display text-base font-medium text-ink">{feature.title}</h3>
              <p className="mt-2 text-sm text-ink-dim">{feature.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Reviews — no more full-bleed bg-vault-900 slab (same flat-band
          issue as Stats above); the section now sits directly on the
          page's continuous glow, with only the individual review cards
          providing surface contrast. */}
      <section id="reviews" className="mx-auto max-w-screen-2xl px-6 py-24">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-signal-glow">
            From our members
          </p>
          <h2 className="mt-2 font-display text-2xl font-semibold text-ink sm:text-3xl">
            What it&apos;s like on the inside
          </h2>

          <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-3">
            {[
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
            ].map((review, i) => (
              <div key={i} className="rounded-xl border border-vault-border bg-vault-800 p-7">
                <p className="text-sm leading-relaxed text-ink-dim">&ldquo;{review.quote}&rdquo;</p>
                <p className="mt-5 font-mono text-[10px] uppercase tracking-widest text-ink-faint">
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
      <section id="faq" className="mx-auto max-w-3xl px-6 py-24">
        <p className="text-center font-mono text-[11px] uppercase tracking-[0.2em] text-signal-glow">
          Questions
        </p>
        <h2 className="mt-2 text-center font-display text-2xl font-semibold text-ink sm:text-3xl">
          Frequently asked
        </h2>

        <div className="mt-12 space-y-5">
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

      {/* CTA — a self-contained radial-glow panel (rounded, inset from the
          page edges) instead of a flat full-bleed strip, matching the
          reference design's closing "Welcome back" card. The glow here is
          its own stronger gradient rather than relying on the page-wide
          body::before, since this section is meant to read as the single
          brightest moment on the page. */}
      <section className="px-6 pb-24 pt-4">
        <div
          className="relative mx-auto max-w-screen-2xl overflow-hidden rounded-3xl border border-vault-border px-6 py-20 text-center shadow-glass"
          style={{
            background:
              'radial-gradient(700px circle at 50% 120%, rgba(65,122,248,0.55), transparent 60%), radial-gradient(500px circle at 15% -20%, rgba(122,89,255,0.35), transparent 60%), linear-gradient(180deg, rgba(20,45,110,0.55) 0%, rgba(10,25,70,0.75) 100%)',
          }}
        >
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-white/20 bg-white/10 text-signal-glow backdrop-blur-sm">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="m12 4 9 4-9 4-9-4 9-4Zm-6 6.2V16c0 1.1 2.7 3 6 3s6-1.9 6-3v-5.8"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <h2 className="mt-5 font-display text-2xl font-semibold text-ink sm:text-3xl">
            {isMember ? 'Welcome back.' : 'Already a member?'}
          </h2>
          <p className="mt-2 text-sm text-ink-dim">
            {isMember
              ? 'Jump back into your boards and classes.'
              : 'Sign in with the Google account on file.'}
          </p>
          <Link
            href={isMember ? '/learn' : '/login'}
            className="mt-7 inline-block rounded-lg bg-signal px-8 py-3.5 text-sm font-medium text-white shadow-glow transition hover:bg-signal-glow"
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
    <div className="rounded-xl border border-vault-border bg-vault-900 p-6 backdrop-blur-xl shadow-glass">
      <p className="font-display text-base font-medium text-ink">{q}</p>
      <p className="mt-2.5 text-sm leading-relaxed text-ink-dim">{a}</p>
    </div>
  );
}
