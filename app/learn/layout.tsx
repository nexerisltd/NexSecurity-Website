import { redirect } from 'next/navigation';
import { getAuth } from '@/lib/auth';
import { TopNav } from '@/components/TopNav';
import { DisableRightClick } from '@/components/DisableRightClick';
import { DevToolsGuard } from '@/components/DevToolsGuard';

export const dynamic = 'force-dynamic';

export default async function LearnLayout({ children }: { children: React.ReactNode }) {
  const auth = await getAuth();

  if (auth.state === 'UNAUTHENTICATED') redirect('/login');
  if (auth.state === 'UNAUTHORIZED') redirect('/login?error=access_denied');
  if (auth.state === 'DEVICE_BLOCKED') redirect('/login?error=device_blocked');
  if (auth.state === 'TEMP_BLOCKED') redirect(`/login?error=temp_blocked&until=${encodeURIComponent(auth.blockedUntil)}`);

  return (
    <div className="min-h-screen bg-vault-950 protected-content">
      <DisableRightClick />
      <DevToolsGuard userName={auth.email} isAdmin={auth.user.role === 'ADMIN'} />
      <TopNav email={auth.email} isAdmin={auth.user.role === 'ADMIN'} profile={auth.profile} />
      {children}
    </div>
  );
}
