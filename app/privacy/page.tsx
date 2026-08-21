import type { Metadata } from 'next';
import { PublicNav } from '@/components/PublicNav';
import { PublicFooter } from '@/components/PublicFooter';

export const metadata: Metadata = {
  title: 'Privacy Policy — NexSecurity',
  description: 'How NexSecurity collects, uses, and protects your information.',
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-vault-950 bg-grid bg-[size:32px_32px]">
      <PublicNav />
      <main className="mx-auto max-w-3xl px-6 py-14">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-signal">Legal</p>
        <h1 className="mt-2 font-display text-3xl font-semibold text-ink">Privacy Policy</h1>
        <p className="mt-2 text-sm text-ink-faint">Last updated: August 21, 2026</p>

        <div className="glass-panel mt-8 space-y-8 rounded-2xl p-8 text-sm leading-relaxed text-ink-dim">
          <Section title="1. Who we are">
            <p>
              NexSecurity (&quot;we&quot;, &quot;us&quot;) operates a private, invite-only
              learning platform. This policy explains what information we collect when you use
              the platform and how we use it.
            </p>
          </Section>

          <Section title="2. Information we collect">
            <p>We keep the information we collect to the minimum needed to run the platform:</p>
            <ul className="mt-2 list-disc space-y-1.5 pl-5">
              <li>
                <strong className="text-ink">Google account information.</strong> When you sign
                in with Google, we receive your name, email address, and profile photo from
                Google. We use this only to identify you and check whether your account has been
                authorized by an administrator.
              </li>
              <li>
                <strong className="text-ink">Access and activity records.</strong> We keep a
                security log of admin actions and sign-ins (e.g. account created, board
                published) so access to the platform can be audited.
              </li>
              <li>
                <strong className="text-ink">Content you access.</strong> We record which
                classes and boards an authorized account has been granted access to, in order to
                enforce permissions.
              </li>
            </ul>
          </Section>

          <Section title="3. How we use your information">
            <ul className="list-disc space-y-1.5 pl-5">
              <li>To authenticate you and verify you&apos;re an authorized member.</li>
              <li>To enforce which boards, classes, and e-books your account can access.</li>
              <li>To maintain a security audit trail of administrative actions.</li>
              <li>To operate, maintain, and improve the platform.</li>
            </ul>
            <p className="mt-2">
              We do not use your information for advertising, and we do not sell or rent your
              personal information to third parties.
            </p>
          </Section>

          <Section title="4. Google user data & OAuth scopes">
            <p>
              We request only the minimum Google OAuth scopes needed to identify you (basic
              profile and email). We do not request access to your Gmail, Drive, Calendar, or
              any other Google service. Google account data we receive is used solely for
              authentication on this platform and is not shared with third parties, and is not
              used to train any AI or machine-learning model.
            </p>
          </Section>

          <Section title="5. Data retention">
            <p>
              We retain account and access-log data for as long as your account remains active,
              and for a limited period afterward for security auditing. You can request deletion
              of your account data at any time — see &quot;Contact&quot; below.
            </p>
          </Section>

          <Section title="6. Data sharing">
            <p>
              We do not sell your personal information. We may share information with service
              providers who help us operate the platform (e.g. hosting and database providers),
              strictly to provide the service, and only to the extent necessary. We may also
              disclose information if required by law.
            </p>
          </Section>

          <Section title="7. Security">
            <p>
              Access to platform content is enforced server-side for every request. Video and
              file sources are never exposed directly to the client — access is authorized on
              each request and short-lived, signed access is issued only after that check
              passes.
            </p>
          </Section>

          <Section title="8. Your choices">
            <p>
              You can revoke NexSecurity&apos;s access to your Google account at any time from
              your{' '}
              <a
                href="https://myaccount.google.com/permissions"
                target="_blank"
                rel="noopener noreferrer"
                className="text-signal underline-offset-2 hover:underline"
              >
                Google Account permissions page
              </a>
              . Revoking access will sign you out of NexSecurity.
            </p>
          </Section>

          <Section title="9. Children's privacy">
            <p>
              NexSecurity is invite-only and administered directly by the platform operator for
              its own students/members. It is not intended for open public sign-up.
            </p>
          </Section>

          <Section title="10. Changes to this policy">
            <p>
              We may update this policy from time to time. Material changes will be reflected by
              updating the &quot;Last updated&quot; date above.
            </p>
          </Section>

          <Section title="11. Contact">
            <p>
              Questions about this policy or your data can be directed to your platform
              administrator.
            </p>
          </Section>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="font-display text-base font-semibold text-ink">{title}</h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}
