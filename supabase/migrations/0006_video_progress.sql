-- "Resume playback" support: one row per (user, video) holding the last
-- watched position, so reopening a class auto-seeks back to where the
-- student left off instead of always restarting at 0:00. Works for both
-- providers (bunny + youtube) — VideoPlayer.tsx periodically reports the
-- current time via /api/video/[id]/progress while playing, and
-- /api/video/[id]/play returns the saved position on load.
--
-- Run this once against any existing project. Safe to run multiple times.

create table if not exists public.video_progress (
  id uuid primary key default gen_random_uuid(),
  user_email text not null,
  video_id uuid not null references public.videos (id) on delete cascade,
  position_seconds integer not null default 0,
  duration_seconds integer,
  updated_at timestamptz not null default now(),
  unique (user_email, video_id)
);

create index if not exists idx_video_progress_user_video on public.video_progress (lower(user_email), video_id);

alter table public.video_progress enable row level security;

-- A user may only read/write their OWN progress rows. All access in
-- practice goes through the service-role admin client from
-- app/api/video/[id]/play and app/api/video/[id]/progress (same pattern
-- as videos / video_playback_tokens), but this policy is still the real
-- backstop if that ever changes.
drop policy if exists video_progress_self on public.video_progress;
create policy video_progress_self on public.video_progress
  for all using (
    lower(user_email) = lower(coalesce(auth.jwt() ->> 'email', '')) or public.is_admin()
  )
  with check (
    lower(user_email) = lower(coalesce(auth.jwt() ->> 'email', '')) or public.is_admin()
  );
