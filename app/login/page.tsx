import { redirect } from 'next/navigation';
import { getAuth } from '@/lib/auth';
import { LoginCard } from '@/components/LoginCard';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const auth = await getAuth();
  if (auth.state === 'AUTHORIZED') {
    redirect('/learn');
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-vault-950 bg-grid bg-[size:32px_32px] px-6">
      <LoginCard
        accessDenied={searchParams.error === 'access_denied'}
        deviceBlocked={searchParams.error === 'device_blocked'}
      />
    </div>
  );
}
