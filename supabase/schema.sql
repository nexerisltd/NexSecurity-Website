-- ============================================================================
-- NexSecurity — Database Schema + Row-Level Security
-- Run this in the Supabase SQL Editor (or via `supabase db push`).
--
-- Design principle: every table that holds protected content is locked
-- down by default (RLS enabled, no policies = no access) and only opened
-- up by narrow, explicit policies. The app's ANON key + a user's session
-- is never enough on its own — Postgres itself checks the allowlist.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. authorized_users — the allowlist. auth.users (managed by Supabase Auth)
--    is where Google identities land after OAuth; a row here is what turns
--    an authenticated identity into an authorized one.
-- ---------------------------------------------------------------------------
create table if not exists public.authorized_users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  role text not null default 'USER' check (role in ('USER', 'ADMIN')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'DISABLED')),
  -- When true, this account may only sign in from an IP + device combo
  -- that an admin has explicitly approved in user_devices. Default false
  -- so adding this never locks anyone out until an admin opts an account in.
  restrict_devices boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_authorized_users_email on public.authorized_users (lower(email));

-- ---------------------------------------------------------------------------
-- 2. boards — hierarchical nodes. parent_id null = top-level ("Learn").
--    A board with a video is a "leaf" board.
-- ---------------------------------------------------------------------------
create table if not exists public.boards (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.boards (id) on delete cascade,
  title text not null,
  description text,
  thumbnail_url text,
  sort_order integer not null default 0,
  published boolean not null default false,
  -- 'routine' boards skip the board/video hierarchy entirely and just
  -- display routine_image_url (a class routine / timetable graphic).
  board_type text not null default 'normal' check (board_type in ('normal', 'routine')),
  routine_image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_boards_parent on public.boards (parent_id);

-- ---------------------------------------------------------------------------
-- 3. pages — an optional intermediate container a board can point to
--    (per the brief's nested Board -> Page -> Board structure).
-- ---------------------------------------------------------------------------
create table if not exists public.pages (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  thumbnail_url text,
  sort_order integer not null default 0,
  layout text not null default 'grid' check (layout in ('grid', 'list')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- a board's "destination" can be another board OR a page
alter table public.boards
  add column if not exists destination_page_id uuid references public.pages (id) on delete set null;

-- pages contain boards (many-to-many with explicit ordering)
create table if not exists public.page_boards (
  page_id uuid not null references public.pages (id) on delete cascade,
  board_id uuid not null references public.boards (id) on delete cascade,
  sort_order integer not null default 0,
  primary key (page_id, board_id)
);

-- ---------------------------------------------------------------------------
-- 4. videos — 1:1 with a leaf board. The raw URL/provider asset id NEVER
--    goes in an API response to a normal user — only the /api/video/:id/play
--    route (server-side) reads this table and returns a short-lived token.
-- ---------------------------------------------------------------------------
create table if not exists public.videos (
  id uuid primary key default gen_random_uuid(),
  -- No longer unique: a board (chapter) can hold multiple classes
  -- ("Part 1", "Part 2", ...), ordered by sort_order below.
  board_id uuid not null references public.boards (id) on delete cascade,
  title text not null,
  description text,
  thumbnail_url text,
  -- always 'bunny' — this app only integrates with Bunny Stream (see
  -- app/api/video/[id]/play/route.ts)
  provider text not null default 'bunny',
  -- "{libraryId}/{videoGuid}" from the Bunny embed URL — never exposed
  -- to the client; only used server-side to build a signed embed token.
  source_ref text not null,
  -- Ordering when a board has multiple parts (Part 1, Part 2, ...).
  sort_order integer not null default 0,
  -- A single dedicated download link for this class specifically —
  -- distinct from the many-per-class links in video_resources below.
  download_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_videos_board_sort on public.videos (board_id, sort_order);

-- ---------------------------------------------------------------------------
-- 5. audit_logs — append-only security/admin event trail.
-- ---------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  event_type text not null,
  actor_email text,
  target text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_logs_created on public.audit_logs (created_at desc);

-- ---------------------------------------------------------------------------
-- 6. video_playback_tokens — short-lived, single-purpose tokens issued
--    after a server-side authorization check. Used to rate-limit and
--    to make token issuance auditable/revocable.
-- ---------------------------------------------------------------------------
create table if not exists public.video_playback_tokens (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos (id) on delete cascade,
  user_email text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_playback_tokens_user_video on public.video_playback_tokens (user_email, video_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 7. video_resources — supplementary links attached to a class (lecture
--    sheet, exam, notes, etc). Generic title+URL rather than a fixed
--    "kind" enum, so admins aren't boxed into predefined categories.
--    Same access model as `videos`: no SELECT policy for regular users —
--    only reachable via the admin client, after the video page's normal
--    auth + board-published check has already passed (see
--    app/learn/video/[id]/page.tsx).
-- ---------------------------------------------------------------------------
create table if not exists public.video_resources (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos (id) on delete cascade,
  title text not null,
  url text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_video_resources_video on public.video_resources (video_id, sort_order);

-- ---------------------------------------------------------------------------
-- 8. e_books — downloadable books attached to a board (chapter/subject),
--    shown as their own section on that board's page. price is almost
--    always 0 ("Free"); kept numeric rather than boolean in case a paid
--    e-book is ever added. Same access model as video_resources: no
--    regular-user SELECT policy — reached via the admin client only,
--    after the board page's normal auth + published check already
--    passed (see app/learn/board/[id]/page.tsx).
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 9. user_devices — the actual allowlist for accounts with
--    restrict_devices = true on authorized_users. An admin adds rows here
--    (normally by "approving" a row from device_sightings below); a
--    request only passes the device check in lib/auth.ts if BOTH the IP
--    and device_label of the incoming request match a row here for that
--    user.
-- ---------------------------------------------------------------------------
create table if not exists public.user_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.authorized_users (id) on delete cascade,
  ip_address text not null,
  device_label text not null default 'Any device',
  -- 'authorized' = allowed to sign in; 'restricted' = explicitly denied.
  -- A row existing at all means an admin has made a decision about this
  -- IP+device combo; sightings with no matching row here are still
  -- pending ("Unauthorized IP request" in the admin UI).
  status text not null default 'authorized' check (status in ('authorized', 'restricted')),
  -- Admin-given friendly name, e.g. "Home WiFi", "College router" — pure
  -- label, plays no role in the auth check itself.
  label text,
  note text,
  created_at timestamptz not null default now(),
  unique (user_id, ip_address, device_label)
);

create index if not exists idx_user_devices_user on public.user_devices (user_id);
create index if not exists idx_user_devices_user_status on public.user_devices (user_id, status);

-- ---------------------------------------------------------------------------
-- 10. device_sightings — every distinct (ip_address, device_label) combo
--     ever seen for a user, deduped, with a running count and last-seen
--     time. Recorded on every authorized request regardless of whether
--     restrict_devices is on, so an admin has real data to review BEFORE
--     turning restriction on for a suspicious account. One row per combo
--     (upserted), not a full request log — this is bounded and cheap to
--     keep, unlike audit_logs.
-- ---------------------------------------------------------------------------
create table if not exists public.device_sightings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.authorized_users (id) on delete cascade,
  ip_address text not null,
  device_label text not null default 'Unknown device',
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  sighting_count integer not null default 1,
  unique (user_id, ip_address, device_label)
);

create index if not exists idx_device_sightings_user on public.device_sightings (user_id, last_seen desc);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

alter table public.authorized_users enable row level security;
alter table public.boards enable row level security;
alter table public.pages enable row level security;
alter table public.page_boards enable row level security;
alter table public.videos enable row level security;
alter table public.audit_logs enable row level security;
alter table public.video_playback_tokens enable row level security;
alter table public.video_resources enable row level security;
alter table public.e_books enable row level security;
alter table public.user_devices enable row level security;
alter table public.device_sightings enable row level security;

-- Helper: is the currently authenticated user an ACTIVE authorized user?
create or replace function public.is_authorized() returns boolean as $$
  select exists (
    select 1 from public.authorized_users au
    where lower(au.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and au.status = 'ACTIVE'
  );
$$ language sql stable security definer set search_path = public;

-- Helper: is the currently authenticated user an ACTIVE ADMIN?
create or replace function public.is_admin() returns boolean as $$
  select exists (
    select 1 from public.authorized_users au
    where lower(au.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and au.status = 'ACTIVE'
      and au.role = 'ADMIN'
  );
$$ language sql stable security definer set search_path = public;

-- authorized_users: a user may read only their OWN row (to learn their own
-- role/status). All writes and reading the full list are ADMIN-only.
drop policy if exists au_select_self on public.authorized_users;
create policy au_select_self on public.authorized_users
  for select using (
    lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')) or public.is_admin()
  );

drop policy if exists au_admin_write on public.authorized_users;
create policy au_admin_write on public.authorized_users
  for all using (public.is_admin()) with check (public.is_admin());

-- boards: authorized (active) users can read PUBLISHED boards.
-- Admins can read/write everything, including unpublished.
drop policy if exists boards_select_authorized on public.boards;
create policy boards_select_authorized on public.boards
  for select using (
    (public.is_authorized() and published = true) or public.is_admin()
  );

drop policy if exists boards_admin_write on public.boards;
create policy boards_admin_write on public.boards
  for all using (public.is_admin()) with check (public.is_admin());

-- pages: same shape as boards. Pages are only exposed via a published
-- board's destination, but we still gate read access directly.
drop policy if exists pages_select_authorized on public.pages;
create policy pages_select_authorized on public.pages
  for select using (public.is_authorized() or public.is_admin());

drop policy if exists pages_admin_write on public.pages;
create policy pages_admin_write on public.pages
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists page_boards_select_authorized on public.page_boards;
create policy page_boards_select_authorized on public.page_boards
  for select using (public.is_authorized() or public.is_admin());

drop policy if exists page_boards_admin_write on public.page_boards;
create policy page_boards_admin_write on public.page_boards
  for all using (public.is_admin()) with check (public.is_admin());

-- videos: intentionally NO select policy for normal users. Only admins
-- can read the videos table directly. Regular playback goes exclusively
-- through the /api/video/:id/play route using the service-role key
-- server-side, after an explicit authorization check in application code.
-- This guarantees the raw source_ref can never leak via a direct
-- PostgREST query, no matter what the client sends.
drop policy if exists videos_admin_all on public.videos;
create policy videos_admin_all on public.videos
  for all using (public.is_admin()) with check (public.is_admin());

-- video_resources: same reasoning as videos — no regular-user SELECT
-- policy. The video page reaches these through the admin client only
-- after its own auth + board-published check already passed.
drop policy if exists video_resources_admin_all on public.video_resources;
create policy video_resources_admin_all on public.video_resources
  for all using (public.is_admin()) with check (public.is_admin());

-- e_books: same reasoning as video_resources — no regular-user SELECT
-- policy. The board page reaches these through the admin client only
-- after its own auth + board-published check already passed.
drop policy if exists e_books_admin_all on public.e_books;
create policy e_books_admin_all on public.e_books
  for all using (public.is_admin()) with check (public.is_admin());

-- user_devices / device_sightings: admin-only, same as e_books. Read and
-- written from lib/auth.ts via the service-role admin client (this is a
-- security-check code path, consistent with how video authorization
-- already works), and from the admin API routes for the management UI.
drop policy if exists user_devices_admin_all on public.user_devices;
create policy user_devices_admin_all on public.user_devices
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists device_sightings_admin_all on public.device_sightings;
create policy device_sightings_admin_all on public.device_sightings
  for all using (public.is_admin()) with check (public.is_admin());

-- audit_logs: admins can read; inserts happen via service-role from
-- trusted server code only (no client-facing insert policy).
drop policy if exists audit_logs_admin_select on public.audit_logs;
create policy audit_logs_admin_select on public.audit_logs
  for select using (public.is_admin());

-- video_playback_tokens: a user may see their own issued tokens only
-- (useful for admin auditing / self-service "why did playback fail").
drop policy if exists playback_tokens_self_select on public.video_playback_tokens;
create policy playback_tokens_self_select on public.video_playback_tokens
  for select using (
    lower(user_email) = lower(coalesce(auth.jwt() ->> 'email', '')) or public.is_admin()
  );

-- ============================================================================
-- Seed: replace with your own admin email after first deploy, e.g.:
-- insert into public.authorized_users (email, role, status)
--   values ('you@example.com', 'ADMIN', 'ACTIVE');
-- ============================================================================
