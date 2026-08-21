-- Adds: (1) an e_books table — a downloadable-books section on a board's
-- page, alongside its classes; (2) board_type + routine_image_url on
-- boards, so a board can be marked 'routine' and just display a class
-- routine / timetable image (16:9) instead of the normal board/video
-- hierarchy.
--
-- Run this once against any existing project (SQL Editor, or
-- `supabase db push`). Safe to run multiple times.

alter table public.boards
  add column if not exists board_type text not null default 'normal'
  check (board_type in ('normal', 'routine'));

alter table public.boards
  add column if not exists routine_image_url text;

create table if not exists public.e_books (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards (id) on delete cascade,
  title text not null,
  description text,
  thumbnail_url text,
  download_url text,
  format text not null default 'PDF',
  price numeric(10, 2) not null default 0,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_e_books_board_sort on public.e_books (board_id, sort_order);

alter table public.e_books enable row level security;

drop policy if exists e_books_admin_all on public.e_books;
create policy e_books_admin_all on public.e_books
  for all using (public.is_admin()) with check (public.is_admin());
