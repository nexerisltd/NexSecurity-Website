import { redirect } from 'next/navigation';
import { getAuth } from '@/lib/auth';

export default async function RootPage() {
  const auth = await getAuth();
  redirect(auth.state === 'AUTHORIZED' ? '/learn' : '/login');
}
