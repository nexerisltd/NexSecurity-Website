-- Adds per-account IP + device allowlisting.
--
-- authorized_users.restrict_devices (default false) is the per-account
-- switch. When true, a request must match a row in user_devices (exact
-- ip_address + device_label) for that user, or it's treated as
-- unauthorized (see lib/auth.ts). device_sightings records every combo
-- seen for every user regardless of the switch, so an admin has real
-- data to review before turning it on.
--
-- Run this once against any existing project. Safe to run multiple times.

alter table public.authorized_users
  add column if not exists restrict_devices boolean not null default false;

create table if not exists public.user_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.authorized_users (id) on delete cascade,
  ip_address text not null,
  device_label text not null default 'Any device',
  note text,
  created_at timestamptz not null default now(),
  unique (user_id, ip_address, device_label)
);

create index if not exists idx_user_devices_user on public.user_devices (user_id);

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

alter table public.user_devices enable row level security;
alter table public.device_sightings enable row level security;

drop policy if exists user_devices_admin_all on public.user_devices;
create policy user_devices_admin_all on public.user_devices
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists device_sightings_admin_all on public.device_sightings;
create policy device_sightings_admin_all on public.device_sightings
  for all using (public.is_admin()) with check (public.is_admin());
