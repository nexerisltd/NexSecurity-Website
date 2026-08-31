-- Per-board visibility: a board is either 'universal' (visible to every
-- authorized user, the existing default behavior — nothing changes for
-- boards that don't opt in) or 'restricted' (visible only to users
-- explicitly granted access via board_user_access).
--
-- Restriction cascades DOWN the tree: if a user lacks access to a board,
-- they also cannot see anything nested under it (child boards, pages,
-- videos) even if those child items are themselves 'universal' — the
-- ancestor chain is walked on every access check (see lib/boardAccess.ts).
--
-- Run this once against any existing project. Safe to run multiple times.

alter table public.boards
  add column if not exists visibility text not null default 'universal'
    check (visibility in ('universal', 'restricted'));

create table if not exists public.board_user_access (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards (id) on delete cascade,
  user_email text not null,
  created_at timestamptz not null default now(),
  unique (board_id, user_email)
);

create index if not exists idx_board_user_access_board on public.board_user_access (board_id);
create index if not exists idx_board_user_access_user on public.board_user_access (lower(user_email));

alter table public.board_user_access enable row level security;

-- A user may see their OWN grants (needed so lib/boardAccess.ts's checks
-- work under the normal RLS-bound server client, not just the
-- service-role admin client). Admins can see and manage everything.
drop policy if exists board_user_access_self_select on public.board_user_access;
create policy board_user_access_self_select on public.board_user_access
  for select using (
    lower(user_email) = lower(coalesce(auth.jwt() ->> 'email', '')) or public.is_admin()
  );

drop policy if exists board_user_access_admin_write on public.board_user_access;
create policy board_user_access_admin_write on public.board_user_access
  for all using (public.is_admin())
  with check (public.is_admin());
