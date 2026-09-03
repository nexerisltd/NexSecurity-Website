-- 1. Device approval provenance — who (or what) decided a device's
--    current status, so the admin panel can show "First device —
--    auto-approved" or "Approved by admin@x.com" directly on the row
--    instead of requiring a trip to audit_logs. approved_by is an admin's
--    email (set by the PATCH route in application code, never trusted
--    from the client) or left null for the system's own first-device
--    auto-approval.
alter table public.user_devices
  add column if not exists approved_by text,
  add column if not exists approved_at timestamptz;

-- 2. Site-wide popup/announcement, shown to authorized users on a
--    repeating interval rather than once ever. A SINGLETON settings row
--    (id is pinned to 1) — one announcement configuration for the whole
--    site, not a list of campaigns.
create table if not exists public.site_popup_settings (
  id integer primary key default 1,
  enabled boolean not null default false,
  title text not null default '',
  message text not null default '',
  button_label text not null default 'Got it',
  button_url text,
  -- How many hours must pass since a user last saw this popup before
  -- they're shown it again ("watch time" — e.g. 10 means once every 10
  -- hours, at most). Bumping `version` resets EVERY user's clock
  -- immediately, which the API does automatically on every save — so
  -- editing the message shows the new one right away instead of making
  -- everyone wait out the old interval first.
  interval_hours integer not null default 24 check (interval_hours > 0),
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  constraint site_popup_settings_singleton check (id = 1)
);

insert into public.site_popup_settings (id) values (1)
on conflict (id) do nothing;

-- One row per user: the last version they were shown, and when. A
-- version_seen that doesn't match the CURRENT settings.version counts as
-- "hasn't seen this one yet" regardless of last_shown_at.
create table if not exists public.user_popup_views (
  user_email text primary key,
  version_seen integer not null,
  last_shown_at timestamptz not null default now()
);

alter table public.site_popup_settings enable row level security;
alter table public.user_popup_views enable row level security;

drop policy if exists site_popup_settings_read on public.site_popup_settings;
create policy site_popup_settings_read on public.site_popup_settings
  for select using (public.is_authorized() or public.is_admin());

drop policy if exists site_popup_settings_admin_write on public.site_popup_settings;
create policy site_popup_settings_admin_write on public.site_popup_settings
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists user_popup_views_self on public.user_popup_views;
create policy user_popup_views_self on public.user_popup_views
  for all using (
    lower(user_email) = lower(coalesce(auth.jwt() ->> 'email', '')) or public.is_admin()
  )
  with check (
    lower(user_email) = lower(coalesce(auth.jwt() ->> 'email', '')) or public.is_admin()
  );
