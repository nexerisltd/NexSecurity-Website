import type { Metadata } from 'next';
import { PublicNav } from '@/components/PublicNav';
import { PublicFooter } from '@/components/PublicFooter';

export const metadata: Metadata = {
  title: 'Terms & Conditions — NexSecurity',
  description: 'The terms that govern use of the NexSecurity platform.',
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-vault-950 bg-grid bg-[size:32px_32px]">
      <PublicNav />
      <main className="mx-auto max-w-3xl px-6 py-14">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-signal">Legal</p>
        <h1 className="mt-2 font-display text-3xl font-semibold text-ink">Terms &amp; Conditions</h1>
        <p className="mt-2 text-sm text-ink-faint">Last updated: August 21, 2026</p>

        <div className="glass-panel mt-8 space-y-8 rounded-2xl p-8 text-sm leading-relaxed text-ink-dim">
          <Section title="1. Acceptance of terms">
            <p>
              By signing in to and using NexSecurity (&quot;the platform&quot;), you agree to
              these Terms &amp; Conditions. If you do not agree, do not use the platform.
            </p>
          </Section>

          <Section title="2. Invite-only access">
            <p>
              NexSecurity is a private, invite-only learning platform. Access is granted at the
              sole discretion of the platform administrator via an authorized-account allowlist.
              We may suspend or revoke access at any time, for any reason, including inactivity
              or a violation of these terms.
            </p>
          </Section>

          <Section title="3. Your account">
            <p>
              You sign in using your Google account. You&apos;re responsible for keeping that
              account secure. You agree not to share your access credentials or session with
              anyone who has not themselves been authorized.
            </p>
          </Section>

          <Section title="4. Acceptable use">
            <p>You agree not to:</p>
            <ul className="mt-2 list-disc space-y-1.5 pl-5">
              <li>Download, copy, redistribute, or re-upload platform content elsewhere.</li>
              <li>Attempt to bypass, probe, or circumvent access controls or authentication.</li>
              <li>Share your account access with unauthorized individuals.</li>
              <li>Use the platform for any unlawful purpose.</li>
            </ul>
          </Section>

          <Section title="5. Content ownership">
            <p>
              All classes, videos, e-books, lecture sheets, and other materials made available on
              NexSecurity are owned by NexSecurity and/or its instructors and are provided for
              the personal, non-commercial use of authorized members only. No license is granted
              to reproduce, distribute, or publicly display this content.
            </p>
          </Section>

          <Section title="6. Availability">
            <p>
              We aim to keep the platform available but do not guarantee uninterrupted access.
              Features, boards, classes, and e-books may be added, changed, or removed at any
              time.
            </p>
          </Section>

          <Section title="7. Disclaimer">
            <p>
              The platform and its content are provided &quot;as is&quot;, without warranties of
              any kind, express or implied. We do not guarantee that content is error-free or
              that it will meet any particular exam board, syllabus, or outcome.
            </p>
          </Section>

          <Section title="8. Limitation of liability">
            <p>
              To the fullest extent permitted by law, NexSecurity is not liable for any indirect,
              incidental, or consequential damages arising from your use of, or inability to use,
              the platform.
            </p>
          </Section>

          <Section title="9. Termination">
            <p>
              We may suspend or terminate your access at any time, with or without notice,
              including for a breach of these terms. You may stop using the platform at any time
              by revoking Google account access.
            </p>
          </Section>

          <Section title="10. Changes to these terms">
            <p>
              We may update these terms from time to time. Continued use of the platform after a
              change constitutes acceptance of the updated terms.
            </p>
          </Section>

          <Section title="11. Contact">
            <p>Questions about these terms can be directed to your platform administrator.</p>
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
