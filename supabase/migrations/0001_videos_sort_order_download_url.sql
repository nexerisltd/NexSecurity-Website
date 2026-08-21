-- Existing databases: `schema.sql` uses `create table if not exists`, so
-- re-running it after a column was added to an already-created table does
-- NOT add the new column, and it does NOT drop constraints that were
-- since removed from the CREATE TABLE definition either.
--
-- sort_order and download_url were added to public.videos after some
-- projects had already run an earlier version of schema.sql, causing
-- inserts from the admin "Add class" form to fail with a Postgres
-- "column does not exist" error (surfaced to the admin panel as the
-- generic "Could not create video.").
--
-- Separately, public.videos originally had `board_id uuid unique`
-- (one video per board). That was later relaxed to allow multiple
-- classes ("Part 1", "Part 2", ...) per board, ordered by sort_order.
-- Any project whose DB was created before that change still has the
-- old auto-named unique constraint (videos_board_id_key) sitting on
-- the live table, which causes the SECOND class added to any board to
-- fail with the same generic "Could not create video." error even
-- after sort_order/download_url exist.
--
-- Run this file (once) against any existing project to bring it in
-- sync with the current schema.sql. Safe to run multiple times.

alter table public.videos
  add column if not exists sort_order integer not null default 0;

alter table public.videos
  add column if not exists download_url text;

create index if not exists idx_videos_board_sort on public.videos (board_id, sort_order);

alter table public.videos
  drop constraint if exists videos_board_id_key;
