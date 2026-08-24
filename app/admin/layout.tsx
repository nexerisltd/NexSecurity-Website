import { redirect } from 'next/navigation';
import { getAuth } from '@/lib/auth';
import { TopNav } from '@/components/TopNav';
import { AdminSidebar } from '@/components/AdminSidebar';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const auth = await getAuth();

  if (auth.state === 'UNAUTHENTICATED') redirect('/login');
  if (auth.state === 'UNAUTHORIZED') redirect('/login?error=access_denied');
  if (auth.state === 'DEVICE_BLOCKED') redirect('/login?error=device_blocked');
  // This is the actual gate — being an authorized USER is not enough.
  // Every admin page and every /api/admin/* route re-checks this
  // independently; nothing here is inherited or cached client-side.
  if (auth.user.role !== 'ADMIN') redirect('/learn');

  return (
    <div className="min-h-screen bg-vault-950">
      <TopNav email={auth.email} isAdmin backHref="/learn" />
      <div className="mx-auto flex max-w-6xl gap-8 px-6 py-8">
        <AdminSidebar />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
