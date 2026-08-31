import { NextResponse } from 'next/server';
import { requireAuthorized } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { uuidSchema } from '@/lib/validation';
import { canAccessBoard, filterAccessibleBoards } from '@/lib/boardAccess';

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
    .select('id, title, description, thumbnail_url, published, destination_page_id, parent_id, visibility')
    .eq('id', parsedId.data)
    .maybeSingle();

  // RLS already means non-admins can never receive an unpublished board
  // here, so "not found" covers both "doesn't exist" and "not authorized"
  // — deliberately, so the response can't be used to enumerate content.
  if (!board) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  const adminClient = createSupabaseAdminClient();
  const isAdmin = auth.user.role === 'ADMIN';

  // Same cascading ancestor-chain visibility check as every other entry
  // point (learn pages, /play, /progress) — this board itself might be
  // 'universal' but still sit under a 'restricted' ancestor.
  if (!(await canAccessBoard(adminClient, auth.user.email, board.id, isAdmin))) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  const { data: childRows } = await supabase
    .from('boards')
    .select('id, title, description, thumbnail_url, sort_order, visibility')
    .eq('parent_id', board.id)
    .eq('published', true)
    .order('sort_order', { ascending: true });

  const children = await filterAccessibleBoards(adminClient, auth.user.email, childRows ?? [], isAdmin);

  return NextResponse.json({ board, children });
}
