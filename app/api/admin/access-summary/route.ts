import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Board-id -> granted-user-count for every restricted board, in one
 * query. Lets the boards list and the Access page show "3 users" inline
 * instead of making an admin open each board's editor just to see
 * whether anyone has access yet.
 *
 * With ?email=someone@x.com, also returns grantedBoardIds — every board
 * that specific person is explicitly granted on — in one extra query.
 * This is what makes the "by user" view on the Access page possible
 * without fetching every restricted board's grant list one at a time.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: 'Access denied.' }, { status: auth.status });

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.from('board_user_access').select('board_id');
  if (error) return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 });

  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    const id = row.board_id as string;
    counts[id] = (counts[id] ?? 0) + 1;
  }

  const email = request.nextUrl.searchParams.get('email')?.trim().toLowerCase();
  if (!email) return NextResponse.json({ counts });

  const { data: granted, error: grantedError } = await supabase
    .from('board_user_access')
    .select('board_id')
    .eq('user_email', email);
  if (grantedError) return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 });

  return NextResponse.json({ counts, grantedBoardIds: (granted ?? []).map((r) => r.board_id as string) });
}
