import { NextResponse } from 'next/server';
import { requireAuthorized } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireAuthorized();
  if (!auth.ok) {
    return NextResponse.json({ error: 'Access denied.' }, { status: auth.status });
  }

  const supabase = createSupabaseServerClient();
  // RLS still applies even though we already checked auth above — this
  // is defense in depth, not a substitute for the RLS policy.
  const { data, error } = await supabase
    .from('boards')
    .select('id, title, description, thumbnail_url, sort_order')
    .is('parent_id', null)
    .eq('published', true)
    .order('sort_order', { ascending: true });

  if (error) {
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 });
  }

  return NextResponse.json({ boards: data });
}
