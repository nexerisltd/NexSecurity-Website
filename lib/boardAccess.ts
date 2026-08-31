import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * "Restricted" boards cascade DOWN the tree: if any ancestor (inclusive
 * of the board itself) is restricted and the user has no explicit grant
 * for THAT SPECIFIC board, access is denied — regardless of whether the
 * board being checked is itself 'universal'. A locked parent locks
 * everything nested under it.
 *
 * Walks the parent_id chain upward (boards are typically 2-3 levels
 * deep, so this is a handful of sequential lookups, never a heavy
 * query). Call this with the admin client (bypasses RLS) so it always
 * sees the true board_type/visibility regardless of who's asking — the
 * caller is responsible for having already established the user is
 * authenticated + authorized before reaching this check.
 *
 * Admins always pass — this function is about student-facing visibility,
 * not the admin panel's own access model.
 */
export async function canAccessBoard(
  admin: SupabaseClient,
  userEmail: string,
  boardId: string,
  isAdmin: boolean
): Promise<boolean> {
  if (isAdmin) return true;

  let currentId: string | null = boardId;
  let depth = 0;
  const MAX_DEPTH = 20; // generous headroom over any real hierarchy depth

  while (currentId && depth < MAX_DEPTH) {
    const result = await admin.from('boards').select('id, parent_id, visibility').eq('id', currentId).maybeSingle();
    const board = result.data as { id: string; parent_id: string | null; visibility: string } | null;

    // A dangling/missing ancestor is treated as "can't verify it's safe"
    // — deny rather than silently skip past it.
    if (!board) return false;

    if (board.visibility === 'restricted') {
      const { data: grant } = await admin
        .from('board_user_access')
        .select('board_id')
        .eq('board_id', board.id)
        .eq('user_email', userEmail)
        .maybeSingle();
      if (!grant) return false;
    }

    currentId = board.parent_id;
    depth += 1;
  }

  return true;
}

/**
 * Filters a flat list of SIBLING boards (e.g. root boards, or the
 * immediate children shown on one board's page) down to the ones this
 * user may see — checking only each board's OWN visibility, not its
 * ancestors. Use this for listings where the caller has already
 * established (or doesn't need to establish) that the shared parent
 * context is itself accessible; use canAccessBoard for a single board a
 * user is navigating directly into (video page, board detail page),
 * where the full ancestor chain actually needs walking.
 *
 * One batched query instead of N — safe for listing-sized boards lists.
 */
export async function filterAccessibleBoards<T extends { id: string; visibility?: string | null }>(
  admin: SupabaseClient,
  userEmail: string,
  boards: T[],
  isAdmin: boolean
): Promise<T[]> {
  if (isAdmin) return boards;

  const restrictedIds = boards.filter((b) => b.visibility === 'restricted').map((b) => b.id);
  if (restrictedIds.length === 0) return boards;

  const { data: grants } = await admin
    .from('board_user_access')
    .select('board_id')
    .eq('user_email', userEmail)
    .in('board_id', restrictedIds);

  const grantedIds = new Set((grants ?? []).map((g) => g.board_id as string));
  return boards.filter((b) => b.visibility !== 'restricted' || grantedIds.has(b.id));
}
