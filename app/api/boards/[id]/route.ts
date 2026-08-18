import { NextResponse } from 'next/server';
import { requireAuthorized } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { uuidSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAuthorized();
  if (!auth.ok) {
    return NextResponse.json({ error: 'Access denied.' }, { status: auth.status });
  }

  const parsedId = uuidSchema.safeParse(params.id);
  if (!parsedId.success) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  const supabase = createSupabaseServerClient();
  const { data: board } = await supabase
    .from('boards')
    .select('id, title, description, thumbnail_url, published, destination_page_id, parent_id')
    .eq('id', parsedId.data)
    .maybeSingle();

  // RLS already means non-admins can never receive an unpublished board
  // here, so "not found" covers both "doesn't exist" and "not authorized"
  // — deliberately, so the response can't be used to enumerate content.
  if (!board) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  const { data: children } = await supabase
    .from('boards')
    .select('id, title, description, thumbnail_url, sort_order')
    .eq('parent_id', board.id)
    .eq('published', true)
    .order('sort_order', { ascending: true });

  return NextResponse.json({ board, children: children ?? [] });
}
