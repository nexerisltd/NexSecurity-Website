-- ---------------------------------------------------------------------------
-- 0018 — Concurrent stream session cap.
--
-- Tracks, per account, which devices currently have an actively-playing
-- stream (not "ever logged in" — that's user_devices/device_sightings,
-- a completely different, much longer-lived signal). A row here is kept
-- fresh by app/api/video/[id]/stream-token/route.ts re-upserting it on
-- every token refresh (see STREAM_TOKEN_REFRESH_MS in
-- components/VideoPlayer.tsx, ~10s) — a device that stops watching ages
-- out of the "active" window within seconds, without anything having to
-- explicitly clean up after it (a closed tab, a crashed browser, a dead
-- wifi connection all just stop refreshing and fall out on their own).
--
-- Deliberately NOT the same table as user_devices: that one is about
-- "is this device allowed to sign in as this account at all" (an
-- admin's own, indefinite decision — see restrict_devices). This one is
-- about "how many of an account's own approved devices are streaming
-- video RIGHT NOW", which is a completely different, short-lived
-- question with a different owner (the concurrency check in
-- stream-token/route.ts, not an admin).
-- ---------------------------------------------------------------------------

create table if not exists public.active_stream_sessions (
  user_id uuid not null references public.authorized_users (id) on delete cascade,
  device_id text not null,
  video_id uuid,
  last_seen_at timestamptz not null default now(),
  primary key (user_id, device_id)
);

create index if not exists idx_active_stream_sessions_user_last_seen
  on public.active_stream_sessions (user_id, last_seen_at desc);

alter table public.active_stream_sessions enable row level security;
-- No end-user-facing policy: only ever touched via the admin/service-role
-- client (createSupabaseAdminClient()) from stream-token/route.ts, same
-- as audit_logs and every other server-only table in this schema.
