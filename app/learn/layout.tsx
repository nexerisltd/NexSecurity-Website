import { redirect } from 'next/navigation';
import { getAuth } from '@/lib/auth';
import { TopNav } from '@/components/TopNav';
import { DisableRightClick } from '@/components/DisableRightClick';

export const dynamic = 'force-dynamic';

export default async function LearnLayout({ children }: { children: React.ReactNode }) {
  const auth = await getAuth();

  if (auth.state === 'UNAUTHENTICATED') redirect('/login');
  if (auth.state === 'UNAUTHORIZED') redirect('/login?error=access_denied');
  if (auth.state === 'DEVICE_BLOCKED') redirect('/login?error=device_blocked');

  return (
    <div className="min-h-screen bg-vault-950">
      <DisableRightClick />
      <TopNav email={auth.email} isAdmin={auth.user.role === 'ADMIN'} profile={auth.profile} />
      {children}
    </div>
  );
}
